from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.gis.geos import Polygon
from .models import Shop, ShopSurvey, WardsBoundary
from .serializers import ShopGeoSerializer
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.db import transaction
import logging
from django.views.decorators.http import require_POST
from rest_framework.decorators import api_view, permission_classes
from rest_framework import status
from django.contrib.gis.geos import Point
from rest_framework.permissions import IsAdminUser
from .storage import upload_photo
from django.shortcuts import render, get_object_or_404, redirect
from django.db.models import Count, Q

class ShopViewportAPIView(APIView):
    def get(self, request, *args, **kwargs):
        bbox_str = request.query_params.get('bbox')
        search_query = request.query_params.get('search')

        # 1. IF SEARCHING BY NAME: Search the whole database (ignore bbox)
        if search_query:
            shops = Shop.objects.filter(title__icontains=search_query, is_active=True)[:50]
            serializer = ShopGeoSerializer(shops, many=True)
            return Response(serializer.data)

        # 2. IF NO SEARCH: Use the BBOX for the map viewport
        if not bbox_str:
            return Response({"error": "bbox or search parameter required"}, status=400)

        try:
            min_lng, min_lat, max_lng, max_lat = map(float, bbox_str.split(','))
            bbox = Polygon.from_bbox((min_lng, min_lat, max_lng, max_lat))
            shops = Shop.objects.filter(location__within=bbox, is_active=True)
            serializer = ShopGeoSerializer(shops, many=True)
            return Response(serializer.data)
        except ValueError:
            return Response({"error": "Invalid bbox format"}, status=400)

logger = logging.getLogger(__name__)


@csrf_exempt
@require_POST
def kobo_webhook(request):
    try:
        payload = json.loads(request.body)
        data = payload.get("submission", payload)
    except Exception as e:
        logger.error(f"[KOBO] Invalid JSON: {e}")
        return JsonResponse({"error": "invalid json"}, status=400)

    # 1. Extract GPS (Crucial for calculating boundaries)
    gps_string = data.get("general/site_geotag")
    if not gps_string:
        logger.warning("[KOBO] No GPS provided.")
        return JsonResponse({"error": "GPS (site_geotag) is required to calculate Zone/Ward."}, status=400)

    try:
        # Kobo sends GPS as: "17.342411 78.485992 0 0"
        coords = gps_string.split()
        lat = float(coords[0])
        lng = float(coords[1])
        point = Point(lng, lat, srid=4326)
    except (ValueError, IndexError):
        return JsonResponse({"error": "Invalid GPS format"}, status=400)

    # 2. Calculate Boundaries via PostGIS
    matches = WardsBoundary.objects.filter(geom__contains=point)

    if not matches.exists():
        return JsonResponse({"error": "Location is outside GHMC boundaries"}, status=400)

    if matches.count() > 1:
        # Handle edge cases where point falls exactly on a boundary
        return JsonResponse({"error": "Location is on a boundary. Please move a few meters and retry."}, status=400)

    ward = matches.first()

    # 3. Find or Create the Shop
    # Check both ID (from React app) and Name (from manual WhatsApp link)
    shop_id = data.get("general/shop_id")
    shop_name = data.get("general/market_shop_name")

    with transaction.atomic():
        shop = None

        # Priority A: React app passed a shop_id
        if shop_id:
            try:
                shop = Shop.objects.select_for_update().get(id=shop_id)
            except Shop.DoesNotExist:
                logger.warning(f"[KOBO] Shop ID {shop_id} not found. Falling back to name.")

        # Priority B: Manual entry (WhatsApp link) - Look up by name
        if not shop and shop_name:
            # Use iexact to ignore case differences (Reddy vs REDDY)
            shop = Shop.objects.select_for_update().filter(title__iexact=shop_name.strip()).first()

            # If the shop truly doesn't exist, create it
            if not shop:
                logger.info(f"[KOBO] Creating new shop from webhook: {shop_name}")
                shop = Shop.objects.create(
                    title=shop_name.strip(),
                    location=point,
                    zone=ward.zone_name,
                    circle=ward.circle_name,
                    ward=ward.ward_name,
                    survey_completed=True,  # Mark as completed immediately
                    surveyed_at=timezone.now(),
                    geocode_state='has_coords'
                )
                return JsonResponse({"status": "ok", "message": "New shop created and surveyed."})

        if not shop:
            return JsonResponse({"error": "Could not identify shop by ID or Name"}, status=400)

        # 4. Update Existing Shop (if it was found, not created)
        shop.location = point
        shop.zone = ward.zone_name
        shop.circle = ward.circle_name
        shop.ward = ward.ward_name
        shop.survey_completed = True
        shop.surveyed_at = timezone.now()

        # Optional: Calculate risk level from the overall score
        overall_score = data.get("overall_summary/overall_site_pct")
        if overall_score:
            try:
                score = float(overall_score)
                if score >= 75:
                    shop.risk_level = "Critical"
                elif score >= 50:
                    shop.risk_level = "High"
                elif score >= 25:
                    shop.risk_level = "Moderate"
                else:
                    shop.risk_level = "Low"
            except ValueError:
                pass

        shop.save()

    return JsonResponse({"status": "ok", "message": "Survey saved and boundaries updated."})

@api_view(['POST'])
def complete_survey_api(request, shop_id):
    try:
        shop = Shop.objects.get(id=shop_id)
    except Shop.DoesNotExist:
        return Response({"error": "Shop not found"}, status=status.HTTP_404_NOT_FOUND)

    risk_level = request.data.get('risk_level')
    valid_risks = ['low', 'moderate', 'high', 'critical']
    if risk_level and risk_level.lower() not in valid_risks:
        return Response({"error": "Invalid risk level"}, status=status.HTTP_400_BAD_REQUEST)

    shop.survey_completed = True
    if risk_level:
        shop.risk_level = risk_level.capitalize()  # Match your model choices
    shop.surveyed_at = timezone.now()
    market_shop_name = request.data.get('market_shop_name')
    market_shop_owner_contact = request.data.get('market_shop_owner_contact')
    shop.save()

    return Response({"status": "success", "shop_id": shop.id, "risk_level": shop.risk_level}, status=status.HTTP_200_OK)


# NEW VIEW: Receives the full 100+ question form from React
@api_view(['POST'])
def submit_full_survey(request, shop_id):
    try:
        shop = Shop.objects.get(id=shop_id)
    except Shop.DoesNotExist:
        return Response({"error": "Shop not found"}, status=status.HTTP_404_NOT_FOUND)

    data = request.data

    # Save the detailed survey
    survey = ShopSurvey.objects.create(
        shop=shop,
        enumerator_name=data.get('enumerator_name', 'Unknown'),
        assessment_date=data.get('assessment_date', timezone.now().date()),
        overall_risk_score=data.get('overall_risk_score', 0),
        overall_risk_level=data.get('overall_risk_level', 'Low').capitalize(),
        survey_data=data.get('survey_data', {})
    )

    # Update the map marker color
    shop.survey_completed = True
    shop.risk_level = survey.overall_risk_level
    shop.surveyed_at = timezone.now()
    shop.save()

    return Response({"status": "success", "survey_id": survey.id})


@api_view(['POST'])
def preview_location_api(request):
    """
    Given a GPS coordinate, return the GHMC Zone/Circle/Ward it falls inside.
    Used by the 'Add New Shop' modal to show auto-filled, read-only admin fields.
    """
    lat_raw = request.data.get('latitude')
    lng_raw = request.data.get('longitude')

    if lat_raw is None or lng_raw is None:
        return Response(
            {"status": "error", "error": "latitude and longitude are required."},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        latitude = float(lat_raw)
        longitude = float(lng_raw)
    except (TypeError, ValueError):
        return Response(
            {"status": "error", "error": "latitude and longitude must be numbers."},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Fast bounding-box sanity check (Hyderabad GHMC extent, roughly)
    if not (17.0 <= latitude <= 17.6 and 78.2 <= longitude <= 78.7):
        return Response({
            "status": "outside_ghmc",
            "error": "Location is outside the GHMC area (coordinates out of range)."
        })

    from django.contrib.gis.geos import Point
    point = Point(longitude, latitude, srid=4326)

    # ST_Covers returns true for points on the boundary edge too.
    # Query all matching wards; decide based on count.
    matches = WardsBoundary.objects.filter(geom__intersects=point)

    match_count = matches.count()

    if match_count == 0:
        return Response({
            "status": "outside_ghmc",
            "error": "Location is outside all GHMC zones."
        })

    if match_count > 1:
        return Response({
            "status": "on_boundary",
            "error": "Location is on a boundary between two wards. Please move a few meters and re-capture."
        })

    ward = matches.first()
    return Response({
        "status": "ok",
        "zone": ward.zone_name,
        "circle": ward.circle_name,
        "ward": ward.ward_name,
    })

@api_view(['POST'])
def manual_add_shop_api(request):
    """
    Create a new Shop row from the "Add New Shop" form.

    Expected multipart form fields:
        latitude, longitude, title, mobile, owner_name, category, photo (file)

    Returns:
        200 with { status, shop_id, kobo_url } on success
        400 with { status: "error", error: "..." } on validation failure
    """
    # 1. Read all fields
    lat_raw = request.data.get('latitude')
    lng_raw = request.data.get('longitude')
    title = (request.data.get('title') or '').strip()
    mobile = (request.data.get('mobile') or '').strip() or None
    owner_name = (request.data.get('owner_name') or '').strip() or None
    category = (request.data.get('category') or '').strip() or None
    photo_file = request.FILES.get('photo')

    # 2. Validate required fields
    if not (lat_raw and lng_raw):
        return Response(
            {"status": "error", "error": "latitude and longitude are required."},
            status=status.HTTP_400_BAD_REQUEST
        )
    if not title:
        return Response(
            {"status": "error", "error": "title is required."},
            status=status.HTTP_400_BAD_REQUEST
        )
    if not photo_file:
        return Response(
            {"status": "error", "error": "photo is required."},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        latitude = float(lat_raw)
        longitude = float(lng_raw)
    except (TypeError, ValueError):
        return Response(
            {"status": "error", "error": "latitude and longitude must be numbers."},
            status=status.HTTP_400_BAD_REQUEST
        )

    # 3. Fast bounding-box sanity check
    if not (17.0 <= latitude <= 17.6 and 78.2 <= longitude <= 78.7):
        return Response(
            {"status": "error", "error": "Location is outside the GHMC area."},
            status=status.HTTP_400_BAD_REQUEST
        )

    # 4. Resolve Zone/Circle/Ward via ST_Intersects
    point = Point(longitude, latitude, srid=4326)
    matches = WardsBoundary.objects.filter(geom__intersects=point)
    match_count = matches.count()

    if match_count == 0:
        return Response(
            {"status": "error", "error": "Location is outside all GHMC zones."},
            status=status.HTTP_400_BAD_REQUEST
        )
    if match_count > 1:
        return Response(
            {"status": "error",
             "error": "Location is on a boundary between two wards. Please move a few meters and re-capture."},
            status=status.HTTP_400_BAD_REQUEST
        )

    ward = matches.first()

    # 5. Upload photo (transaction wrapped — if this fails, no shop row is created)
    try:
        with transaction.atomic():
            photo_url = upload_photo(photo_file)

            # 6. Create the Shop row
            new_shop = Shop.objects.create(
                title=title,
                mobile=mobile,
                owner_name=owner_name,
                category=category or 'Chicken',
                location=point,
                zone=ward.zone_name,
                circle=ward.circle_name,
                ward=ward.ward_name,
                photo_url=photo_url,
                geocode_state='has_coords',
                survey_completed=False,
                risk_level=None,
            )

            # 7. Build Kobo URL with prefilled shop_id
            base_kobo_url = "https://ee.kobotoolbox.org/x/gctPhd30"
            kobo_url = f"{base_kobo_url}?d[general/shop_id]={new_shop.id}"

            logger.info(f"[MANUAL ADD] Created shop {new_shop.id} '{new_shop.title}' "
                        f"in {new_shop.zone}/{new_shop.circle}/{new_shop.ward}")

            return Response({
                "status": "ok",
                "shop_id": new_shop.id,
                "kobo_url": kobo_url,
            }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.error(f"[MANUAL ADD] Failed: {e}")
        return Response(
            {"status": "error", "error": f"Failed to create shop: {str(e)}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

@api_view(['PATCH'])
def snap_location_api(request, shop_id):
    """
    Update an existing shop's GPS coordinates.
    Re-resolves Zone/Circle/Ward from the new coordinate.
    """
    try:
        shop = Shop.objects.get(id=shop_id)
    except Shop.DoesNotExist:
        return Response({"status": "error", "error": "Shop not found."},
                        status=status.HTTP_404_NOT_FOUND)

    lat_raw = request.data.get('latitude')
    lng_raw = request.data.get('longitude')

    if lat_raw is None or lng_raw is None:
        return Response({"status": "error", "error": "latitude and longitude are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        latitude = float(lat_raw)
        longitude = float(lng_raw)
    except (TypeError, ValueError):
        return Response({"status": "error", "error": "latitude and longitude must be numbers."},
                        status=status.HTTP_400_BAD_REQUEST)

    if not (17.0 <= latitude <= 17.6 and 78.2 <= longitude <= 78.7):
        return Response({"status": "error", "error": "Location is outside the GHMC area."},
                        status=status.HTTP_400_BAD_REQUEST)

    point = Point(longitude, latitude, srid=4326)
    matches = WardsBoundary.objects.filter(geom__intersects=point)
    count = matches.count()

    if count == 0:
        return Response({"status": "error", "error": "Location is outside all GHMC zones."},
                        status=status.HTTP_400_BAD_REQUEST)
    if count > 1:
        return Response({"status": "error", "error": "Location is on a boundary. Please move a few meters and retry."},
                        status=status.HTTP_400_BAD_REQUEST)

    ward = matches.first()

    shop.location = point
    shop.zone = ward.zone_name
    shop.circle = ward.circle_name
    shop.ward = ward.ward_name
    shop.geocode_state = 'has_coords'
    shop.save()

    logger.info(f"[SNAP] Shop {shop.id} snapped to ({latitude}, {longitude}) "
                f"→ {ward.zone_name}/{ward.circle_name}/{ward.ward_name}")

    return Response({
        "status": "ok",
        "shop_id": shop.id,
        "zone": shop.zone,
        "circle": shop.circle,
        "ward": shop.ward,
    })

@api_view(['GET'])
def nearby_unmapped_api(request):
    """
    Returns shops with location IS NULL whose circle is near the given point.
    Uses pure-Python haversine distance — no PostGIS geography casts, no ORM
    coordinate extractions. This is slower than a spatial index but works on
    every Django+Neon+Windows setup without any special configuration.
    """
    import math

    lat_raw = request.query_params.get('lat')
    lng_raw = request.query_params.get('lng')
    radius_m = float(request.query_params.get('radius', 1000))

    if not (lat_raw and lng_raw):
        return Response({"status": "error", "error": "lat and lng are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        user_lat = float(lat_raw)
        user_lng = float(lng_raw)
    except (TypeError, ValueError):
        return Response({"status": "error", "error": "lat and lng must be numbers."},
                        status=status.HTTP_400_BAD_REQUEST)

    def haversine_m(lat1, lng1, lat2, lng2):
        """Distance in meters between two lat/lng points on Earth's surface."""
        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lng2 - lng1)
        a = (
            math.sin(dphi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        )
        return 2 * R * math.asin(math.sqrt(a))

    # Build a circle -> centroid lookup from WardsBoundary rows.
    # Each ward has a MultiPolygon; we take its centroid (a Point) and use
    # its .x (lng) and .y (lat) properties directly in Python.
    circle_centroids = {}
    for w in WardsBoundary.objects.exclude(circle_name__isnull=True):
        if w.circle_name and w.circle_name not in circle_centroids:
            centroid = w.geom.centroid
            circle_centroids[w.circle_name] = (centroid.y, centroid.x)

    # Find circles within radius of the user's position
    nearby_circles = [
        circle for circle, (lat_c, lng_c) in circle_centroids.items()
        if haversine_m(user_lat, user_lng, lat_c, lng_c) <= radius_m
    ]

    # Return unmapped shops in those circles
    unmapped = Shop.objects.filter(
        location__isnull=True,
        circle__in=nearby_circles,
    ).values('id', 'title', 'circle', 'zone', 'mobile')[:200]

    shops_list = list(unmapped)

    return Response({
        "status": "ok",
        "circles_nearby": nearby_circles,
        "count": len(shops_list),
        "shops": shops_list,
    })


# 1. The Dashboard View
def dashboard_view(request):
    selected_zone = request.GET.get('zone', '')
    selected_risk = request.GET.get('risk', '')

    # If a risk is selected on the dashboard, redirect to the results page
    if selected_risk:
        return redirect(f'/results/?risk={selected_risk}&zone={selected_zone}')

    shops = Shop.objects.all()
    if selected_zone:
        shops = shops.filter(zone=selected_zone)

    total_shops = shops.count()
    completed_surveys = shops.filter(survey_completed=True).count()
    pending_surveys = total_shops - completed_surveys

    risk_counts = shops.filter(survey_completed=True).values('risk_level').annotate(count=Count('risk_level'))

    chart_data = {'Low': 0, 'Moderate': 0, 'High': 0, 'Critical': 0, 'Unknown': 0}
    for r in risk_counts:
        level = r['risk_level'] or 'Unknown'
        if level in chart_data:
            chart_data[level] = r['count']

    global_zone_counts = Shop.objects.values('zone').annotate(count=Count('zone')).order_by('-count')

    context = {
        'total_shops': total_shops,
        'completed_surveys': completed_surveys,
        'pending_surveys': pending_surveys,
        'zone_counts': global_zone_counts,
        'selected_zone': selected_zone,
        'chart_labels': list(chart_data.keys()),
        'chart_values': list(chart_data.values()),
    }
    return render(request, 'dashboard.html', context)


# 2. The Risk Results Table View
def results_view(request):
    selected_risk = request.GET.get('risk', '')
    selected_zone = request.GET.get('zone', '')

    shops = Shop.objects.filter(survey_completed=True)

    if selected_risk:
        shops = shops.filter(risk_level=selected_risk)
    if selected_zone:
        shops = shops.filter(zone=selected_zone)

    context = {
        'shops': shops,
        'selected_risk': selected_risk,
        'selected_zone': selected_zone,
    }
    return render(request, 'results.html', context)


# 3. The Individual Shop Detail View
def shop_detail_view(request, shop_id):
    shop = get_object_or_404(Shop, id=shop_id)
    return render(request, 'shop_detail.html', {'shop': shop})

#To del Test surveys
# @api_view(['POST'])
# @permission_classes([IsAdminUser])
# def reset_shop_survey(request, shop_id):
#     try:
#         shop = Shop.objects.get(id=shop_id)
#     except Shop.DoesNotExist:
#         return Response({"error": "Shop not found"}, status=404)
#
#     shop.survey_completed = False
#     shop.risk_level = None
#     shop.surveyed_at = None
#     shop.save()
#
#     return Response({"status": "reset", "shop_id": shop_id})