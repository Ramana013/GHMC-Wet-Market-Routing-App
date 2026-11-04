#!/usr/bin/env bash
set -o errexit

# Install system-level GDAL and GEOS libraries for GeoDjango
apt-get update && apt-get install -y gdal-bin libgdal-dev libgeos-dev libproj-dev

# Install Python dependencies
pip install -r requirements.txt

# Run Django commands
python manage.py collectstatic --no-input
python manage.py migrate