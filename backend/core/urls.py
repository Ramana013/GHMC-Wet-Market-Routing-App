"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from api.views import ShopViewportAPIView
from django.conf.urls.static import static
from django.conf import settings
from api.views import dashboard_view, results_view, shop_detail_view
urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/shops/', ShopViewportAPIView.as_view(), name='shops-api'),
    path('api/', include('api.urls')),
    path('', dashboard_view, name='dashboard'),
    # 2. Results Page (When you filter by risk)
    path('results/', results_view, name='results'),

    # 3. Individual Shop Page (When you click 'View Details')
    path('shop/<uuid:shop_id>/', shop_detail_view, name='shop_detail'),

]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)