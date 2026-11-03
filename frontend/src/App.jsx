import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import useSupercluster from 'use-supercluster';
import { fetchShopsInBBox } from './api';

setWorkerUrl(workerUrl);

const getCircleColor = (circle) => {
  const colors = {
    'Charminar': '#ef4444', 'Golconda': '#f59e0b', 'Khairatabad': '#10b981',
    'Rajendranagar': '#3b82f6', 'Secunderabad': '#8b5cf6', 'Shamshabad': '#ec4899',
  };
  return colors[circle] || '#64748b';
};

const getRiskColor = (risk) => {
  if (!risk) return '#64748b';
  const r = risk.toLowerCase();
  if (r === 'critical') return '#8b5cf6';
  if (r === 'high') return '#ef4444';
  if (r === 'moderate') return '#f59e0b';
  if (r === 'low') return '#10b981';
  return '#64748b';
};

export default function App() {
  const mapRef = useRef(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [zoom, setZoom] = useState(11);
  const [shops, setShops] = useState([]);
  const clusterLayerRef = useRef(L.layerGroup());

  const [wardsGeoJson, setWardsGeoJson] = useState(null);
  const geoJsonLayerRef = useRef(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  // 1. Fetch GeoJSON Boundaries
  useEffect(() => {
    fetch('/wards.geojson')
      .then(res => res.json())
      .then(data => setWardsGeoJson(data))
      .catch(err => console.error("Could not load wards.geojson:", err));
  }, []);

  const loadShops = useCallback(async (currentBounds) => {
    if (!currentBounds) return;
    const sw = currentBounds.getSouthWest();
    const ne = currentBounds.getNorthEast();
    const bboxString = `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`;

    try {
      const features = await fetchShopsInBBox(bboxString);
      setShops(features);
    } catch (error) {
      console.error("Failed to fetch shops", error);
    }
  }, []);

  // 2. Initialize Map
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('map', {
        center: [17.3850, 78.4867],
        zoom: 11,
        preferCanvas: true,
        zoomControl: false,
      });

      maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty' }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const updateViewport = () => {
        setBounds(map.getBounds());
        setZoom(map.getZoom());
      };

      map.on('moveend', updateViewport);
      updateViewport();

      setMapInstance(map);
      mapRef.current = map;

      setTimeout(() => { map.invalidateSize(); }, 300);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => { loadShops(bounds); }, [bounds, loadShops]);

  // Refresh when returning from Kobo
  useEffect(() => {
    const handleFocus = () => { if (bounds) loadShops(bounds); };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [bounds, loadShops]);

  // 3. Render Zone Boundaries
  useEffect(() => {
    if (!mapInstance || !wardsGeoJson) return;
    if (geoJsonLayerRef.current) mapInstance.removeLayer(geoJsonLayerRef.current);

    const layer = L.geoJSON(wardsGeoJson, {
      style: { color: '#3b82f6', weight: 1, fillOpacity: 0.03, fillColor: '#3b82f6' }
    }).addTo(mapInstance);
    geoJsonLayerRef.current = layer;
  }, [mapInstance, wardsGeoJson]);

  // 4. Search Logic
  useEffect(() => {
    if (!wardsGeoJson || !searchQuery.trim()) { setSuggestions([]); return; }
    const q = searchQuery.toLowerCase();
    const matches = wardsGeoJson.features.filter(f => {
      const name = f.properties.Name || f.properties.name || '';
      return name.toLowerCase().includes(q);
    }).slice(0, 8);
    setSuggestions(matches);
  }, [searchQuery, wardsGeoJson]);

  const handleSelectWard = (feature) => {
    if (!mapInstance || !geoJsonLayerRef.current) return;
    const layer = geoJsonLayerRef.current;
    layer.eachLayer(l => { l.setStyle({ color: '#3b82f6', weight: 1, fillOpacity: 0.03, fillColor: '#3b82f6' }); });
    layer.eachLayer(l => {
      if (l.feature === feature) {
        l.setStyle({ color: '#ff7800', weight: 3, fillOpacity: 0.2, fillColor: '#ff7800' });
        mapInstance.fitBounds(l.getBounds(), { padding: [20, 20] });
        if (l.bringToFront) l.bringToFront();
      }
    });
    setSearchQuery(feature.properties.Name || '');
    setSuggestions([]);
  };

  // 5. Setup Supercluster
  const points = shops.map(shop => ({
    type: 'Feature',
    properties: { cluster: false, shopId: shop.properties.id, ...shop.properties },
    geometry: shop.geometry
  }));

  const { clusters, supercluster } = useSupercluster({
    points,
    bounds: bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : undefined,
    zoom,
    options: { radius: 75, maxZoom: 17 }
  });

  // 6. Render Markers
  useEffect(() => {
    if (!mapInstance) return;
    const layer = clusterLayerRef.current;
    layer.clearLayers();

    mapInstance.on('popupopen', (e) => {
      const popupEl = e.popup.getElement();

      const surveyBtn = popupEl.querySelector('#survey-btn');
      if (surveyBtn && !surveyBtn.disabled) {
        surveyBtn.onclick = () => {
          const shopName = surveyBtn.getAttribute('data-shop-name');
          const koboUrl = `https://ee.kobotoolbox.org/x/gNGx65mT?d[general/market_shop_name]=${encodeURIComponent(shopName)}`;
          window.open(koboUrl, '_blank');
        };
      }

      const navBtn = popupEl.querySelector('#navigate-btn');
      if (navBtn) {
        navBtn.onclick = () => {
          const shopLat = navBtn.getAttribute('data-lat');
          const shopLng = navBtn.getAttribute('data-lng');
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${shopLat},${shopLng}`, '_blank');
        };
      }
    });

    clusters.forEach(cluster => {
      const [lng, lat] = cluster.geometry.coordinates;
      const { cluster: isCluster, point_count: pointCount } = cluster.properties;

      if (isCluster) {
        const marker = L.circleMarker([lat, lng], {
          radius: 15 + (pointCount / shops.length) * 20,
          fillColor: '#3b82f6', color: '#ffffff', weight: 2, opacity: 1, fillOpacity: 0.8
        });
        marker.bindTooltip(`${pointCount} shops`, { direction: 'top' });
        marker.on('click', () => {
          const expansionZoom = Math.min(supercluster.getClusterExpansionZoom(cluster.id), 20);
          mapInstance.setView([lat, lng], expansionZoom, { animate: true });
        });
        layer.addLayer(marker);
      } else {
        const props = cluster.properties;
        const isSurveyed = props.survey_completed || false;
        const dotColor = isSurveyed ? getRiskColor(props.risk_level) : getCircleColor(props.circle);

        const marker = L.circleMarker([lat, lng], {
          radius: 6, fillColor: dotColor, color: '#ffffff', weight: 1.5, opacity: 1, fillOpacity: 1
        });

        const riskLevel = props.risk_level || 'Unknown';
        const safeShopName = (props.title || '').replace(/'/g, "&#39;");

        const popupHTML = `
          <div style="padding: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; line-height: 1.3;">${props.title || 'Unknown Shop'}</h3>
              ${isSurveyed ? `<span style="background: ${dotColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: bold;">${riskLevel} Risk</span>` : ''}
            </div>
            <div style="font-size: 13px; color: #334155;">
              <div style="margin-bottom: 6px;"><span style="color: #64748b;">Phone:</span> <strong>${props.mobile || 'N/A'}</strong></div>
              <div style="margin-bottom: 6px;"><span style="color: #64748b;">Circle:</span> <strong>${props.circle || 'N/A'}</strong></div>
              <div style="margin-bottom: 6px;"><span style="color: #64748b;">Ward:</span> <strong>${props.ward || 'N/A'}</strong></div>

              <div style="display: flex; gap: 8px; margin-top: 12px;">
                <button id="navigate-btn" data-lat="${lat}" data-lng="${lng}" style="flex: 1; padding: 9px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">Navigate</button>
                <button id="survey-btn" ${isSurveyed ? 'disabled' : ''} data-shop-name="${safeShopName}" style="flex: 2; padding: 9px; background: ${isSurveyed ? '#e2e8f0' : '#3b82f6'}; color: ${isSurveyed ? '#94a3b8' : 'white'}; border: none; border-radius: 6px; font-weight: 600; cursor: ${isSurveyed ? 'not-allowed' : 'pointer'};">
                  ${isSurveyed ? 'Survey Completed' : 'Complete Survey'}
                </button>
              </div>
            </div>
          </div>
        `;
        marker.bindPopup(popupHTML, { minWidth: 260 });
        layer.addLayer(marker);
      }
    });
    layer.addTo(mapInstance);
  }, [clusters, mapInstance, supercluster, shops.length]);

  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: '50px', boxSizing: 'border-box', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column', gap: '5px' }}>

      {/* SEARCH CARD */}
      <div style={{ height: '60px', background: 'white', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', zIndex: 1000, display: 'flex', alignItems: 'center', padding: '0 20px', flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: '18px', color: '#1e293b', marginRight: '30px' }}>GHMC Routing</h2>
        <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
          <input
            type="text" placeholder="Search Ward/Zone..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '8px 15px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none' }}
          />
          {suggestions.length > 0 && (
            <ul style={{ position: 'absolute', top: '40px', left: 0, right: 0, listStyle: 'none', margin: 0, padding: 0, background: 'white', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden', zIndex: 1001, maxHeight: '300px', overflowY: 'auto' }}>
              {suggestions.map((s, i) => (
                <li key={i} onClick={() => handleSelectWard(s)} style={{ padding: '10px 15px', cursor: 'pointer', borderBottom: i < suggestions.length -1 ? '1px solid #eee' : 'none', fontSize: '14px', color: '#1e293b' }} onMouseEnter={(e) => e.target.style.background = '#f8fafc'} onMouseLeave={(e) => e.target.style.background = 'white'}>
                  {s.properties.Name || 'Unknown Zone'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* MAP CARD */}
      <div style={{ flex: 1, position: 'relative', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <div id="map" style={{ width: '100%', height: '100%' }}></div>
      </div>

    </div>
  );
}