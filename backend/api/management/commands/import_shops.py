import pandas as pd
from django.core.management.base import BaseCommand
from django.contrib.gis.geos import Point
from api.models import Shop


class Command(BaseCommand):
    help = 'Import and clean shops from Excel'

    def handle(self, *args, **kwargs):
        # Ensure this path is correct for your computer!
        file_path = r'C:\ghmc-wet-market-routing\data\Selected Zones Non-Veg with coordinates V1.xlsx'

        self.stdout.write("Loading Excel file...")

        # Load the specific sheet
        df = pd.read_excel(file_path, sheet_name='Linelist-Nonveg')

        # 1. Basic Cleaning
        df['Title'] = df['Title'].astype(str).str.strip().str.upper()
        df['Zone'] = df['Zone'].astype(str).str.strip()
        df['Circle'] = df['Circle'].astype(str).str.strip()
        df['Category_Rev'] = df['Category_Rev'].astype(str).str.strip()

        # Remove duplicates based on Title, Circle, and Mobile
        initial_count = len(df)
        df = df.drop_duplicates(subset=['Title', 'Circle', 'Mobile No'], keep='first')
        self.stdout.write(f"Deduplicated: {initial_count} -> {len(df)} rows")

        # 2. Identify False Geocodes (5+ shops sharing exact coordinate)
        df['lat_round'] = df['Latitude'].round(4)
        df['lng_round'] = df['Longitude'].round(4)

        coord_counts = df.groupby(['lat_round', 'lng_round']).size().reset_index(name='count')
        false_coords = coord_counts[coord_counts['count'] >= 5]
        false_coord_set = set(zip(false_coords['lat_round'], false_coords['lng_round']))

        shops_to_create = []

        for index, row in df.iterrows():
            lat = row.get('Latitude')
            lng = row.get('Longitude')

            # 3. Coordinate Bounding Box & False Geocode Rule
            has_valid_coords = False

            if pd.notna(lat) and pd.notna(lng):
                # Bounding box for Hyderabad
                if 17.0 <= lat <= 17.6 and 78.2 <= lng <= 78.7:
                    if (round(lat, 4), round(lng, 4)) not in false_coord_set:
                        has_valid_coords = True

            # Create the Shop object
            shop = Shop(
                title=row['Title'],
                owner_name=str(row.get('Owner Name')) if pd.notna(row.get('Owner Name')) else None,
                mobile=str(row.get('Mobile No')) if pd.notna(row.get('Mobile No')) else None,
                zone=row['Zone'],
                circle=row['Circle'],
                category=row['Category_Rev'],
                geocode_state='has_coords' if has_valid_coords else 'pending_geocode'
            )

            if has_valid_coords:
                # PointField requires (Longitude, Latitude)
                shop.location = Point(lng, lat, srid=4326)

            shops_to_create.append(shop)

        # Bulk insert for speed
        self.stdout.write("Inserting into database...")
        Shop.objects.bulk_create(shops_to_create)

        self.stdout.write(self.style.SUCCESS(f"Successfully imported {len(shops_to_create)} shops!"))