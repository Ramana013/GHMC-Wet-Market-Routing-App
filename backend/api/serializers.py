from rest_framework_gis.serializers import GeoFeatureModelSerializer
from .models import Shop

class ShopGeoSerializer(GeoFeatureModelSerializer):
    class Meta:
        model = Shop
        geo_field = "location"
        # We only send what the map needs to draw the pin
        fields = ('id', 'title', 'mobile', 'circle', 'ward', 'survey_completed', 'risk_level')
