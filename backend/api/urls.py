from django.urls import path
from api.views import ShopViewportAPIView, kobo_webhook, complete_survey_api, submit_full_survey, preview_location_api, manual_add_shop_api, snap_location_api, nearby_unmapped_api

urlpatterns = [
    path('shops/', ShopViewportAPIView.as_view(), name='shop-viewport'),
    path('kobo-webhook/', kobo_webhook, name='kobo-webhook'),
    path('shops/<int:shop_id>/survey/', complete_survey_api, name='complete-survey'),
    path('shops/<int:shop_id>/snap-location/', snap_location_api, name='snap-location'),
    path('shops/nearby-unmapped/', nearby_unmapped_api, name='nearby-unmapped'),
    path('shops/<int:shop_id>/full-survey/', submit_full_survey, name='submit-full-survey'),
    path('shops/preview-location/', preview_location_api, name='preview-location'),
    path('shops/manual-add/', manual_add_shop_api, name='manual-add'),


    #To del Test Survey
    # path('shops/<uuid:shop_id>/reset-survey/', reset_shop_survey, name='reset-survey'),
]