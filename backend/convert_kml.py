import os
from osgeo import ogr
from osgeo import gdal

# Setup paths
input_kml = "300_WARDS_21-12-25.kml"
output_geojson = "wards.geojson"

# Enable exceptions
gdal.UseExceptions()
ogr.UseExceptions()

print(f"Opening {input_kml}...")
# Open the KML file
driver = ogr.GetDriverByName("KML")
data_source = driver.Open(input_kml, 0) # 0 means read-only

if data_source is None:
    print("Error: Could not open the KML file. Check the filename.")
    exit(1)

# Get the GeoJSON driver
geojson_driver = ogr.GetDriverByName("GeoJSON")

# Delete output file if it already exists
if os.path.exists(output_geojson):
    geojson_driver.DeleteDataSource(output_geojson)

print(f"Converting to {output_geojson}...")
# Create the new GeoJSON file
out_ds = geojson_driver.CreateDataSource(output_geojson)

# Copy the layers from KML to GeoJSON
for i in range(data_source.GetLayerCount()):
    layer = data_source.GetLayerByIndex(i)
    out_layer = out_ds.CopyLayer(layer, layer.GetName())

# Close the files to save
data_source = None
out_ds = None

print(f"Successfully created {output_geojson}!")