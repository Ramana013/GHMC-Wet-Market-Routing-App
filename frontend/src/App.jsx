import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import useSupercluster from 'use-supercluster';
import { fetchShopsInBBox } from './api';
import AddShopModal from './components/AddShopModal';
import SnapShopsPanel from './components/SnapShopsPanel';

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

const BrandLetters = ({ letters, colors, size = '16px', weight = '800' }) => {
  return (
    <span style={{ fontSize: size, fontWeight: weight, letterSpacing: '0.5px', whiteSpace: 'nowrap', lineHeight: '1.1' }}>
      {letters.split('').map((char, idx) => (
        <span key={idx} style={{ color: colors[idx % colors.length] }}>{char}</span>
      ))}
    </span>
  );
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

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]); // Zones & Wards
  const [shopResults, setShopResults] = useState([]); // Shops from DB

  const [showAddModal, setShowAddModal] = useState(false);
  const [showSnapPanel, setShowSnapPanel] = useState(false);

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

  // 4. Search Logic (Zones, Wards, and Shops)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      setShopResults([]);
      return;
    }

    const q = searchQuery.toLowerCase();

    // A. Fetch Shops from Backend (Debounced)
    const timer = setTimeout(async () => {
      try {
        // Note: Ensure your local API URL matches this
        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
        const res = await fetch(`${apiBaseUrl}/api/shops/?search=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setShopResults(data.features || []);
        }
      } catch (err) {
        console.error("Shop search failed", err);
      }
    }, 500);

    // B. Fetch Zones and Wards Locally (Instant)
    if (wardsGeoJson) {
      const allZones = [...new Set(wardsGeoJson.features.map(f => {
        const match = f.properties.Description?.match(/<td>Zone_Name<\/td>\s*<td>([^<]+)<\/td>/i);
        return match ? match[1].trim() : null;
      }).filter(Boolean))];

      const zoneMatches = allZones
        .filter(z => z.toLowerCase().includes(q))
        .map(z => ({ type: 'ZONE', name: z }));

      const wardMatches = wardsGeoJson.features.filter(f => {
        const name = f.properties.Name || f.properties.name || '';
        return name.toLowerCase().includes(q);
      }).map(f => ({ type: 'WARD', name: f.properties.Name, feature: f }));

      setSuggestions([...zoneMatches, ...wardMatches].slice(0, 5));
    }

    return () => clearTimeout(timer);
  }, [searchQuery, wardsGeoJson]);

  // Handle Clicking a Zone/Ward
  const handleSelectWard = (item) => {
    if (!mapInstance || !geoJsonLayerRef.current) return;
    const layer = geoJsonLayerRef.current;

    layer.eachLayer(l => { l.setStyle({ color: '#3b82f6', weight: 1, fillOpacity: 0.03, fillColor: '#3b82f6' }); });

    if (item.type === 'WARD') {
      layer.eachLayer(l => {
        if (l.feature === item.feature) {
          l.setStyle({ color: '#ff7800', weight: 3, fillOpacity: 0.2, fillColor: '#ff7800' });
          mapInstance.fitBounds(l.getBounds(), { padding: [20, 20] });
          if (l.bringToFront) l.bringToFront();
        }
      });
      setSearchQuery(item.name);
    }
    else if (item.type === 'ZONE') {
      const bounds = L.latLngBounds();
      layer.eachLayer(l => {
        const match = l.feature.properties.Description?.match(/<td>Zone_Name<\/td>\s*<td>([^<]+)<\/td>/i);
        const wardZone = match ? match[1].trim() : '';
        if (wardZone === item.name) {
          l.setStyle({ color: '#ff7800', weight: 3, fillOpacity: 0.2, fillColor: '#ff7800' });
          bounds.extend(l.getBounds());
          if (l.bringToFront) l.bringToFront();
        }
      });
      if (bounds.isValid()) {
        mapInstance.fitBounds(bounds, { padding: [20, 20] });
      }
      setSearchQuery(item.name);
    }

    // Clear dropdowns
    setSuggestions([]);
    setShopResults([]);
  };

  // Handle Clicking a Shop
  const handleSelectShop = (shopFeature) => {
    const [lng, lat] = shopFeature.geometry.coordinates;
    setSearchQuery(shopFeature.properties.title);
    setSuggestions([]);
    setShopResults([]);

    if (mapInstance) {
      // Fly to the shop and zoom in heavily
      mapInstance.flyTo([lat, lng], 18);
    }
  };

  // 5. Setup Supercluster
  const points = shops.map(shop => ({
    type: 'Feature',
    properties: {
        cluster: false,
        shopId: shop.id || shop.properties?.id,
        ...shop.properties
    },
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
          const koboUrl = surveyBtn.getAttribute('data-url');
          if (koboUrl) window.open(koboUrl, '_blank');
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
        const shopId = props.shopId || props.id || '';
        const rawTitle = (props.title || '').trim();
        const rawOwner = (props.owner_name || '').trim();
        const rawMobile = (props.mobile || '').trim();
        const rawZone = (props.zone || '').trim();
        const rawCircle = (props.circle || '').trim();
        const rawWard = (props.ward || '').trim();

        const baseUrl = "https://ee.kobotoolbox.org/x/gNGx65mT";
        const koboUrl = `${baseUrl}` +
          `?d[general/shop_id]=${encodeURIComponent(shopId)}` +
          `&d[general/market_shop_name]=${encodeURIComponent(rawTitle)}` +
          `&d[general/market_shop_owner_name]=${encodeURIComponent(rawOwner)}` +
          `&d[general/market_shop_owner_contact]=${encodeURIComponent(rawMobile)}` +
          `&d[general/old_zone]=${encodeURIComponent(rawZone)}` +
          `&d[general/circle]=${encodeURIComponent(rawCircle)}` +
          `&d[general/ward_number_name]=${encodeURIComponent(rawWard)}` +
          `&d[general/lat]=${lat}` +
          `&d[general/lng]=${lng}`;

        const popupHTML = `
          <div style="padding: 4px; min-width: 240px; max-width: 300px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
              <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; line-height: 1.3;">${rawTitle || 'Unknown Shop'}</h3>
              ${isSurveyed ? `<span style="background: ${dotColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; white-space: nowrap;">${riskLevel} Risk</span>` : ''}
            </div>

            <div style="font-size: 13px; color: #334155; display: flex; flex-direction: column; gap: 6px;">
              <div><span style="color: #64748b; display: inline-block; width: 70px;">Owner:</span> <strong>${rawOwner || 'N/A'}</strong></div>
              <div><span style="color: #64748b; display: inline-block; width: 70px;">Phone:</span> <strong>${rawMobile || 'N/A'}</strong></div>
              <div><span style="color: #64748b; display: inline-block; width: 70px;">Zone:</span> <strong>${rawZone || 'N/A'}</strong></div>
              <div><span style="color: #64748b; display: inline-block; width: 70px;">Circle:</span> <strong>${rawCircle || 'N/A'}</strong></div>
              <div><span style="color: #64748b; display: inline-block; width: 70px;">Ward:</span> <strong>${rawWard || 'N/A'}</strong></div>
            </div>

            <div style="display: flex; gap: 8px; margin-top: 14px;">
              <button id="navigate-btn" data-lat="${lat}" data-lng="${lng}" style="flex: 1; padding: 10px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px;">Navigate</button>
              <button id="survey-btn" ${isSurveyed ? 'disabled' : ''}
                data-url="${koboUrl}"
                style="flex: 2; padding: 10px; background: ${isSurveyed ? '#e2e8f0' : '#3b82f6'}; color: ${isSurveyed ? '#94a3b8' : 'white'}; border: none; border-radius: 6px; font-weight: 600; cursor: ${isSurveyed ? 'not-allowed' : 'pointer'}; font-size: 13px;">
                ${isSurveyed ? 'Survey Completed' : 'Complete Survey'}
              </button>
            </div>
          </div>
        `;
        marker.bindPopup(popupHTML);
        layer.addLayer(marker);
      }
    });
    layer.addTo(mapInstance);
  }, [clusters, mapInstance, supercluster, shops.length]);

  return (
    <div style={{ width: '100vw', height: '100dvh', margin: 0, padding: '12px', boxSizing: 'border-box', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column', gap: '8px' }}>

      {/* SEARCH + ACTION BAR */}
      <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', zIndex: 1000, padding: '10px 12px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 'auto' }}>
            <BrandLetters letters="GHMC" colors={['#0c9126', '#dec83a', '#a51ca6', '#f55187']} size="16px" weight="800" />
            <span style={{ margin: 0, fontSize: '9px', fontWeight: '600', color: '#64748b', lineHeight: '1.1', letterSpacing: '1.8px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Routing</span>
          </div>

          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <input
              type="text" placeholder="Search Shop, Ward, or Zone..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
            />

            {/* Combined Suggestions Dropdown */}
            {(suggestions.length > 0 || shopResults.length > 0) && (
              <ul style={{ position: 'absolute', top: '40px', left: 0, right: 0, listStyle: 'none', margin: 0, padding: 0, background: 'white', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden', zIndex: 1001, maxHeight: '300px', overflowY: 'auto' }}>

                {/* 1. Render Shops First */}
                {shopResults.map((shop, i) => (
                  <li key={`shop-${i}`} onClick={() => handleSelectShop(shop)} style={{ padding: '10px 15px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: '14px', color: '#1e293b' }} onMouseEnter={(e) => e.target.style.background = '#f8fafc'} onMouseLeave={(e) => e.target.style.background = 'white'}>
                    🏪 Shop: <strong>{shop.properties.title}</strong> <span style={{ fontSize: '12px', color: '#64748b' }}>({shop.properties.circle || 'Unknown'})</span>
                  </li>
                ))}

                {/* 2. Render Wards/Zones Next */}
                {suggestions.map((s, i) => (
                  <li key={`zone-${i}`} onClick={() => handleSelectWard(s)} style={{ padding: '10px 15px', cursor: 'pointer', borderBottom: (i < suggestions.length - 1 || shopResults.length > 0) ? '1px solid #eee' : 'none', fontSize: '14px', color: '#1e293b' }} onMouseEnter={(e) => e.target.style.background = '#f8fafc'} onMouseLeave={(e) => e.target.style.background = 'white'}>
                    {s.type === 'ZONE' ? `📍 Zone: ${s.name}` : `🔹 Ward: ${s.name}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Row 2: Action buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowAddModal(true)} style={{ flex: 1, padding: '10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', touchAction: 'manipulation' }}>
            ➕ Add New Shop
          </button>
          <button onClick={() => setShowSnapPanel(true)} style={{ flex: 1, padding: '10px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap', touchAction: 'manipulation' }}>
            📍 Snap Nearby
          </button>
        </div>
      </div>

      {/* MAP CARD */}
      <div style={{ flex: 1, position: 'relative', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', minHeight: 0 }}>
        <div id="map" style={{ width: '100%', height: '100%' }}></div>
      </div>

      {/* ADD SHOP MODAL */}
      {showAddModal && (
        <AddShopModal onClose={(success) => { setShowAddModal(false); if (success) loadShops(bounds); }} />
      )}

      {/* SNAP SHOPS PANEL */}
      {showSnapPanel && (
        <SnapShopsPanel onClose={() => setShowSnapPanel(false)} onSuccess={() => loadShops(bounds)} />
      )}

    </div>
  );
}