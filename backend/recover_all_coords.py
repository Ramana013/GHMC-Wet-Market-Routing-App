import os
import django
import pandas as pd

# 1. Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from django.contrib.gis.geos import Point
from api.models import Shop

# 2. Load Excel
print("Loading Excel...")
file_path = r'C:\ghmc-wet-market-routing\data\Selected Zones Non-Veg with coordinates V1.xlsx'
df = pd.read_excel(file_path, sheet_name='Linelist-Nonveg')

# Clean titles in Excel to match DB
df['Title'] = df['Title'].astype(str).str.strip().str.upper()

# 3. Get ALL shops missing coordinates
missing_shops = list(Shop.objects.filter(location__isnull=True))
print(f"Found {len(missing_shops)} shops in DB with missing coordinates.")

shops_to_update = []

# 4. Loop and match
for shop in missing_shops:
    # Match by Title and Circle (Case insensitive)
    match = df[(df['Title'] == shop.title) & (df['Circle'].str.upper() == shop.circle.upper())]
    
    if not match.empty:
        # Take the first match from Excel
        row = match.iloc[0]
        lat = row.get('Latitude')
        lng = row.get('Longitude')
        
        # If the Excel has valid coordinates, restore them!
        if pd.notna(lat) and pd.notna(lng):
            shop.location = Point(float(lng), float(lat), srid=4326)
            shop.geocode_state = 'has_coords'
            shops_to_update.append(shop)

# 5. Bulk save
if shops_to_update:
    print(f"Saving {len(shops_to_update)} shops in bulk...")
    Shop.objects.bulk_update(shops_to_update, ['location', 'geocode_state'])
    print("Success! Coordinates restored.")
else:
    print("No matching shops found in Excel with valid coordinates.")