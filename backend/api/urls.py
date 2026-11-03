from django.urls import path
from api.views import ShopViewportAPIView, kobo_webhook, complete_survey_api, submit_full_survey

urlpatterns = [
    path('shops/', ShopViewportAPIView.as_view(), name='shop-viewport'),
    path('kobo-webhook/', kobo_webhook, name='kobo-webhook'),
    path('shops/<uuid:shop_id>/survey/', complete_survey_api, name='complete-survey'),
    path('shops/<uuid:shop_id>/full-survey/', submit_full_survey, name='submit-full-survey'),
]