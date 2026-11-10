import os
import django
import pandas as pd

# 1. Setup Django FIRST before importing GIS modules
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

# 2. Now we can safely import GeoDjango modules
from django.contrib.gis.geos import Point
from api.models import Shop

# 3. Load the Excel file
print("Loading Excel...")
file_path = r'C:\ghmc-wet-market-routing\data\Selected Zones Non-Veg with coordinates V1.xlsx'
df = pd.read_excel(file_path, sheet_name='Linelist-Nonveg')
df['Title'] = df['Title'].astype(str).str.strip().str.upper()

# 4. Get missing shops
missing_shops = list(Shop.objects.filter(location__isnull=True))
print(f"Found {len(missing_shops)} shops with missing coordinates.")

# 5. Loop and prepare bulk updates
shops_to_update = []
for shop in missing_shops:
    match = df[(df['Title'] == shop.title) & (df['Circle'] == shop.circle)]
    
    if not match.empty:
        row = match.iloc[0]
        lat = row.get('Latitude')
        lng = row.get('Longitude')
        
        if pd.notna(lat) and pd.notna(lng):
            shop.location = Point(float(lng), float(lat), srid=4326)
            shop.geocode_state = 'has_coords'
            shops_to_update.append(shop)

# 6. Bulk save!
if shops_to_update:
    print(f"Saving {len(shops_to_update)} shops in bulk...")
    Shop.objects.bulk_update(shops_to_update, ['location', 'geocode_state'])
    print("Success!")
else:
    print("No shops matched.")