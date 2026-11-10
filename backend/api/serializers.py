from rest_framework_gis.serializers import GeoFeatureModelSerializer
from rest_framework import serializers
from .models import Shop


class ShopGeoSerializer(GeoFeatureModelSerializer):
    can_survey = serializers.SerializerMethodField()
    is_admin_resolved = serializers.SerializerMethodField()

    class Meta:
        model = Shop
        geo_field = "location"
        fields = (
            'id', 'title', 'mobile', 'circle', 'ward', 'zone',
            'survey_completed', 'risk_level',
            'can_survey', 'is_admin_resolved',
        )

    def get_can_survey(self, obj):
        return bool(obj.zone and obj.circle and obj.ward)

    def get_is_admin_resolved(self, obj):
        return bool(obj.zone and obj.circle and obj.ward)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # GeoFeatureModelSerializer puts model fields inside data['properties']
        props = data.get('properties', {})
        mobile = props.get('mobile')
        if mobile:
            mobile = str(mobile).strip()
            if mobile.endswith('.0'):
                mobile = mobile[:-2]
            props['mobile'] = mobile
        return data