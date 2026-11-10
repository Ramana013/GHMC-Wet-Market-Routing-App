from django.contrib.gis.db import models


class Shop(models.Model):
    title = models.CharField(max_length=255)
    owner_name = models.CharField(max_length=255, blank=True, null=True)
    mobile = models.CharField(max_length=15, blank=True, null=True)
    zone = models.CharField(max_length=100, null=True, blank=True, db_index=True)
    circle = models.CharField(max_length=100, null=True, blank=True)
    category = models.CharField(max_length=100)
    ward = models.CharField(max_length=100, blank=True, null=True)
    photo_url = models.URLField(null=True, blank=True)

    # This PointField uses PostGIS to store exact map coordinates
    location = models.PointField(geography=True, null=True, blank=True)

    # This tracks if we know the exact location or if it's a gray pin
    geocode_state = models.CharField(
        max_length=20,
        choices=[('has_coords', 'Has Coords'), ('pending_geocode', 'Pending Geocode')],
        default='pending_geocode'
    )
    is_active = models.BooleanField(default=True)

    survey_completed = models.BooleanField(default=False)
    risk_level = models.CharField(
        max_length=20,
        choices=[('Low', 'Low'), ('Moderate', 'Moderate'), ('High', 'High'), ('Critical', 'Critical')],
        null=True,
        blank=True
    )
    surveyed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.title} - {self.circle}"


# NEW MODEL FOR THE DETAILED 100+ QUESTION SURVEY
class ShopSurvey(models.Model):
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name='surveys')
    enumerator_name = models.CharField(max_length=255)
    assessment_date = models.DateField()

    # Store the calculated risk
    overall_risk_score = models.FloatField(default=0)
    overall_risk_level = models.CharField(max_length=20, default='low')

    # Store the 100+ answers in a flexible JSON field
    survey_data = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Survey for {self.shop.title} - {self.overall_risk_level}"

class WardsBoundary(models.Model):
    ward_name = models.CharField(max_length=100)
    circle_name = models.CharField(max_length=100, null=True, blank=True)
    zone_name = models.CharField(max_length=100, null=True, blank=True)
    geom = models.MultiPolygonField(srid=4326, geography=False)

    class Meta:
        indexes = [
            models.Index(fields=['geom'], name='wards_geom_idx'),
        ]

    def __str__(self):
        return self.ward_name