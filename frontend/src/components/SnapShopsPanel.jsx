import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_BASE_URL;

export default function SnapShopsPanel({ onClose, onSuccess }) {
  const [gpsStatus, setGpsStatus] = useState('capturing');
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snappingId, setSnappingId] = useState(null);

  const captureAndLoad = () => {
    setGpsStatus('capturing');
    setError('');

    if (!navigator.geolocation) {
      setGpsStatus('error');
      setError('Geolocation not supported.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setLatitude(lat);
        setLongitude(lng);
        setGpsStatus('captured');

        try {
          const res = await axios.get(`${API_URL}/api/shops/nearby-unmapped/`, {
            params: { lat, lng, radius: 5000 },
          });
          setShops(res.data.shops || []);
        } catch (err) {
          setError('Failed to load nearby shops.');
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setGpsStatus('error');
        setError(err.message || 'GPS capture failed.');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    captureAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSnap = (shop) => {
    if (!navigator.geolocation) {
      alert('Geolocation not supported.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        const confirmed = window.confirm(
          `Snap "${shop.title}" to your current location?\n\n` +
          `Latitude: ${lat.toFixed(6)}\n` +
          `Longitude: ${lng.toFixed(6)}\n\n` +
          `This will place the shop on the map permanently.`
        );

        if (!confirmed) return;

        setSnappingId(shop.id);
        try {
          await axios.patch(`${API_URL}/api/shops/${shop.id}/snap-location/`, {
            latitude: lat,
            longitude: lng,
          });
          setShops(prev => prev.filter(s => s.id !== shop.id));
          if (onSuccess) onSuccess();
        } catch (err) {
          alert(err.response?.data?.error || 'Failed to snap shop.');
        } finally {
          setSnappingId(null);
        }
      },
      (err) => alert(err.message || 'GPS capture failed.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
      zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div style={{
        backgroundColor: 'white', borderRadius: '12px', maxWidth: '560px', width: '100%',
        maxHeight: '90vh', overflowY: 'auto', padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#1e293b' }}>📍 Snap Nearby Shops</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#64748b' }}>×</button>
        </div>

        {gpsStatus === 'capturing' && (
          <div style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '6px', marginBottom: '16px' }}>
            Capturing your location...
          </div>
        )}

        {gpsStatus === 'captured' && latitude !== null && (
          <div style={{ padding: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
            📍 Your position: {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </div>
        )}

        {error && (
          <div style={{ padding: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '6px', marginBottom: '16px', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <button onClick={captureAndLoad} disabled={loading} style={{ marginBottom: '16px', padding: '6px 12px', fontSize: '12px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer' }}>
          🔄 Refresh Nearby
        </button>

        {loading && <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>Loading unmapped shops...</div>}

        {!loading && shops.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '14px' }}>
            No unmapped shops found within 1 km. Either all shops in this area are already on the map, or you need to move closer to the market center.
          </div>
        )}

        {shops.map((shop) => (
          <div key={shop.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '6px', marginBottom: '8px' }}>
            <div>
              <div style={{ fontWeight: '600', fontSize: '14px', color: '#1e293b' }}>{shop.title}</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>{shop.circle} · {shop.zone} {shop.mobile && `· ${shop.mobile}`}</div>
            </div>
            <button
              onClick={() => handleSnap(shop)}
              disabled={snappingId === shop.id}
              style={{ padding: '8px 16px', background: snappingId === shop.id ? '#cbd5e1' : '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: snappingId === shop.id ? 'not-allowed' : 'pointer', flexShrink: 0 }}
            >
              {snappingId === shop.id ? 'Snapping...' : '📍 Snap'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}