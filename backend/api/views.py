from rest_framework.views import APIView
from rest_framework.response import Response
from django.contrib.gis.geos import Polygon
from .models import Shop, ShopSurvey  # Added ShopSurvey
from .serializers import ShopGeoSerializer
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.db import transaction
import logging
from django.views.decorators.http import require_POST
from rest_framework.decorators import api_view
from rest_framework import status
from django.contrib.gis.geos import Point

class ShopViewportAPIView(APIView):
    def get(self, request, *args, **kwargs):
        bbox_str = request.query_params.get('bbox')
        if not bbox_str:
            return Response({"error": "bbox parameter required"}, status=400)

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

    # 1. Extract using the EXACT names from the Kobo JSON
    shop_name = data.get("general/market_shop_name")
    overall_score = data.get("overall_summary/overall_site_pct", 0)

    if not shop_name:
        logger.warning(f"[KOBO] No shop name found in payload.")
        return JsonResponse({"error": "shop_name missing"}, status=400)

    try:
        with transaction.atomic():
            # 2. Find the shop
            shop = Shop.objects.select_for_update().filter(title__iexact=shop_name.strip()).first()

            if not shop:
                logger.warning(f"[KOBO] Shop not found by name: '{shop_name}'")
                return JsonResponse({"error": "shop not found"}, status=404)

            # 3. Calculate Risk Level
            risk_level = "High"
            try:
                score = float(overall_score)
                if score >= 75:
                    risk_level = "Critical"
                elif score >= 50:
                    risk_level = "High"
                elif score >= 25:
                    risk_level = "Moderate"
                else:
                    risk_level = "Low"
            except:
                pass

                # 4. Update the Shop in Neon DB
            shop.survey_completed = True
            shop.risk_level = risk_level
            shop.surveyed_at = timezone.now()
            shop.save()

            logger.info(f"[KOBO] SUCCESS: Updated '{shop.title}' -> {risk_level} ({overall_score}%)")
            return JsonResponse({"status": "ok"})

    except Exception as e:
        logger.error(f"[KOBO] DB Error: {e}")
        return JsonResponse({"error": "db error"}, status=500)

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


