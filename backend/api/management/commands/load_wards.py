"""
Management command to load GHMC ward boundaries from GeoJSON into WardsBoundary.

Usage:
    python manage.py load_wards
    python manage.py load_wards --dry-run
    python manage.py load_wards --clear
"""
import json
import re
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Polygon

from api.models import WardsBoundary


# Regex to pull `<td>key</td><td>value</td>` pairs from the HTML Description
TD_PAIR_RE = re.compile(r'<td>([\w_]+)</td>\s*<td>([^<]+)</td>', re.IGNORECASE)


class Command(BaseCommand):
    help = "Load GHMC ward boundaries from backend/data/wards.geojson into WardsBoundary table."

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Parse and validate but do not write to the database.',
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Delete all existing WardsBoundary rows before loading.',
        )
        parser.add_argument(
            '--path',
            type=str,
            default=None,
            help='Path to wards.geojson (default: backend/data/wards.geojson).',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        clear = options['clear']

        # Resolve path
        if options['path']:
            geojson_path = Path(options['path'])
        else:
            geojson_path = Path(settings.BASE_DIR) / 'data' / 'wards.geojson'

        if not geojson_path.exists():
            raise CommandError(f"GeoJSON file not found: {geojson_path}")

        self.stdout.write(f"Reading {geojson_path} ({geojson_path.stat().st_size / 1e6:.1f} MB)...")

        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        features = data.get('features', [])
        if not features:
            raise CommandError("No features found in GeoJSON.")

        self.stdout.write(f"Parsing {len(features)} features...")

        # Clear existing rows if requested
        if clear and not dry_run:
            deleted, _ = WardsBoundary.objects.all().delete()
            self.stdout.write(f"Cleared {deleted} existing WardsBoundary rows.")

        loaded = 0
        skipped = 0
        errors = []
        zone_counts = {}

        for idx, feature in enumerate(features):
            try:
                props = feature.get('properties', {})
                desc = props.get('Description', '')

                if not desc:
                    errors.append(f"Feature {idx}: no Description field.")
                    skipped += 1
                    continue

                # Parse HTML <td>key</td><td>value</td> pairs
                pairs = dict(TD_PAIR_RE.findall(desc))

                ward_name = (pairs.get('Ward_Name') or props.get('Name') or '').strip()
                zone_name = (pairs.get('Zone_Name') or '').strip()
                circle_name = (pairs.get('Circle_Nam') or pairs.get('Circle_Name') or '').strip()

                if not ward_name:
                    errors.append(f"Feature {idx}: no Ward_Name found.")
                    skipped += 1
                    continue

                # Parse geometry
                geom_data = feature.get('geometry')
                if not geom_data:
                    errors.append(f"Feature {idx}: no geometry.")
                    skipped += 1
                    continue

                                # Parse geometry using GEOSGeometry — handles Polygon and MultiPolygon cleanly
                geom = GEOSGeometry(json.dumps(geom_data), srid=4326)

                # WardsBoundary.geom is MultiPolygonField.
                # If the source is a Polygon, wrap it in a MultiPolygon so the field accepts it.
                if geom.geom_type == 'Polygon':
                    geom = MultiPolygon(geom, srid=4326)
                elif geom.geom_type != 'MultiPolygon':
                    errors.append(f"Feature {idx}: unexpected geometry type {geom.geom_type}.")
                    skipped += 1
                    continue

                # Dry-run: just count
                if dry_run:
                    loaded += 1
                    zone_counts[zone_name] = zone_counts.get(zone_name, 0) + 1
                    continue

                # Upsert by ward_name
                obj, created = WardsBoundary.objects.update_or_create(
                    ward_name=ward_name,
                    defaults={
                        'zone_name': zone_name or None,
                        'circle_name': circle_name or None,
                        'geom': geom,
                    },
                )
                loaded += 1
                zone_counts[zone_name] = zone_counts.get(zone_name, 0) + 1

            except Exception as e:
                errors.append(f"Feature {idx}: {type(e).__name__}: {e}")
                skipped += 1

        # Summary
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"{'[DRY RUN] ' if dry_run else ''}Loaded: {loaded} | Skipped: {skipped} | Errors: {len(errors)}"))
        self.stdout.write("")
        self.stdout.write("Zone distribution:")
        for zone in sorted(zone_counts.keys()):
            self.stdout.write(f"  {zone or '(blank)'}: {zone_counts[zone]}")

        if errors:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(f"{len(errors)} errors:"))
            for e in errors[:10]:
                self.stdout.write(f"  {e}")
            if len(errors) > 10:
                self.stdout.write(f"  ... and {len(errors) - 10} more.")

        if not dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.SUCCESS(f"Total rows in WardsBoundary now: {WardsBoundary.objects.count()}"))