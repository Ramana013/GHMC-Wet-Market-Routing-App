# GHMC Wet Market Routing

A field survey application for GHMC Wet Markets in Hyderabad. 

## Tech Stack
- **Frontend:** React (Vite), Leaflet, MapLibre, Supercluster
- **Backend:** Django REST Framework, PostgreSQL (Neon), PostGIS
- **Survey Engine:** KoboToolbox (via Webhook integration)
- **Mobile Packaging:** Capacitor (Android APK)

## Features
- Viewport-based loading of 50,000+ shops.
- Supercluster map clustering for performance.
- 300 Ward/Zone boundary rendering and search.
- Direct integration with KoboToolbox for risk assessment surveys.
- Webhook integration to update shop risk colors (Red/Orange/Green) instantly.
- One-click Google Maps navigation to shop locations.

## How to Run
1. Backend: `python manage.py runserver`
2. Frontend: `npm run dev`
3. Mobile: `npx cap sync && npx cap open android`
