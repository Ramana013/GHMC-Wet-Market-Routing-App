#!/usr/bin/env bash
set -o errexit

# Install GDAL system libraries for GeoDjango on Linux
apt-get update && apt-get install -y gdal-bin libgdal-dev

pip install -r requirements.txt
python manage.py collectstatic --no-input
python manage.py migrate