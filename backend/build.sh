#!/usr/bin/env bash
set -o errexit

# Install system-level GDAL/GEOS for Linux
apt-get update && apt-get install -y gdal-bin libgdal-dev libgeos-dev libproj-dev

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate