import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_BASE_URL;

export default function AddShopModal({ onClose }) {
  // GPS state
  const [gpsStatus, setGpsStatus] = useState('capturing'); // capturing | captured | error
  const [latitude, setLatitude] = useState(null);
  const [longitude, setLongitude] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [gpsError, setGpsError] = useState('');

  // Admin resolution state
  const [adminStatus, setAdminStatus] = useState('idle'); // idle | resolving | ok | error
  const [resolvedAdmin, setResolvedAdmin] = useState({ zone: '', circle: '', ward: '' });
  const [adminError, setAdminError] = useState('');

  // Shop details form
  const [title, setTitle] = useState('');
  const [mobile, setMobile] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [category, setCategory] = useState('Chicken');

  // Photo
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  // Save submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // --- Capture GPS on mount ---
  const captureGps = () => {
    setGpsStatus('capturing');
    setGpsError('');
    setAdminStatus('idle');

    if (!navigator.geolocation) {
      setGpsStatus('error');
      setGpsError('Geolocation not supported in this browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setAccuracy(pos.coords.accuracy);
        setGpsStatus('captured');
      },
      (err) => {
        setGpsStatus('error');
        setGpsError(err.message || 'Failed to capture GPS.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    captureGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- When GPS is captured, call preview-location ---
  useEffect(() => {
    if (gpsStatus !== 'captured' || latitude === null || longitude === null) return;

    setAdminStatus('resolving');
    axios
      .post(`${API_URL}/api/shops/preview-location/`, {
        latitude,
        longitude,
      })
      .then((res) => {
        const data = res.data;
        if (data.status === 'ok') {
          setResolvedAdmin({
            zone: data.zone,
            circle: data.circle,
            ward: data.ward,
          });
          setAdminStatus('ok');
        } else {
          setAdminError(data.error || 'Could not resolve boundaries.');
          setAdminStatus('error');
        }
      })
      .catch((err) => {
        setAdminError(
          err.response?.data?.error || 'Network error resolving boundaries.'
        );
        setAdminStatus('error');
      });
  }, [gpsStatus, latitude, longitude]);

  // --- Photo selection ---
  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  // --- Submit ---
  const handleSubmit = async () => {
    setSubmitError('');

    if (adminStatus !== 'ok') {
      setSubmitError('Wait for boundary verification to complete.');
      return;
    }
    if (!title.trim()) {
      setSubmitError('Shop name is required.');
      return;
    }
    if (!photo) {
      setSubmitError('Photo is required.');
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('latitude', latitude);
      formData.append('longitude', longitude);
      formData.append('title', title.trim());
      if (mobile.trim()) formData.append('mobile', mobile.trim());
      if (ownerName.trim()) formData.append('owner_name', ownerName.trim());
      if (category) formData.append('category', category);
      formData.append('photo', photo);

      const res = await axios.post(
        `${API_URL}/api/shops/manual-add/`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      if (res.data.status === 'ok') {
        // Open Kobo in a new tab
        window.open(res.data.kobo_url, '_blank');
        onClose(true); // notify parent of success
      } else {
        setSubmitError(res.data.error || 'Failed to create shop.');
      }
    } catch (err) {
      setSubmitError(
        err.response?.data?.error || 'Network error creating shop.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render ---
  const canSubmit =
    adminStatus === 'ok' && title.trim() && photo && !submitting;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 5000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '20px', color: '#1e293b' }}>
            Add New Shop
          </h2>
          <button
            onClick={() => onClose(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            ×
          </button>
        </div>

        {/* SECTION 1: GPS */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>
            📍 Location
          </label>
          {gpsStatus === 'capturing' && (
            <div style={{ fontSize: '14px', color: '#64748b', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
              Capturing GPS...
            </div>
          )}
          {gpsStatus === 'captured' && (
            <div style={{ fontSize: '13px', color: '#334155', padding: '12px', backgroundColor: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
              <div>Latitude: <strong>{latitude.toFixed(6)}</strong></div>
              <div>Longitude: <strong>{longitude.toFixed(6)}</strong></div>
              <div>Accuracy: <strong>± {accuracy?.toFixed(1)}m</strong></div>
            </div>
          )}
          {gpsStatus === 'error' && (
            <div style={{ fontSize: '13px', color: '#991b1b', padding: '12px', backgroundColor: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
              {gpsError}
            </div>
          )}
          <button
            onClick={captureGps}
            disabled={gpsStatus === 'capturing'}
            style={{
              marginTop: '8px',
              padding: '6px 12px',
              fontSize: '12px',
              background: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              borderRadius: '4px',
              cursor: gpsStatus === 'capturing' ? 'not-allowed' : 'pointer',
            }}
          >
            🔄 Retry GPS
          </button>
        </div>

        {/* SECTION 2: Admin (read-only) */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '8px' }}>
            🔒 GHMC Boundaries (auto-verified)
          </label>
          {adminStatus === 'resolving' && (
            <div style={{ fontSize: '13px', color: '#64748b', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
              Verifying boundaries...
            </div>
          )}
          {adminStatus === 'ok' && (
            <div style={{ fontSize: '13px', color: '#334155', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
              <div style={{ marginBottom: '4px' }}>Zone: <strong>{resolvedAdmin.zone}</strong></div>
              <div style={{ marginBottom: '4px' }}>Circle: <strong>{resolvedAdmin.circle}</strong></div>
              <div>Ward: <strong>{resolvedAdmin.ward}</strong></div>
            </div>
          )}
          {adminStatus === 'error' && (
            <div style={{ fontSize: '13px', color: '#991b1b', padding: '12px', backgroundColor: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
              {adminError}
            </div>
          )}
        </div>

        {/* SECTION 3: Shop details */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
            Shop Name *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., D Chicken Center"
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
            Phone
          </label>
          <input
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="10-digit mobile number"
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
            Owner Name
          </label>
          <input
            type="text"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Owner's name"
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '14px' }}
          >
            <option>Chicken</option>
            <option>Mutton</option>
            <option>Beef</option>
            <option>Fish</option>
            <option>Pork</option>
            <option>Mixed Meat</option>
          </select>
        </div>

        {/* SECTION 4: Photo */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#334155', marginBottom: '6px' }}>
            Photo *
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            style={{ width: '100%', fontSize: '13px' }}
          />
          {photoPreview && (
            <img
              src={photoPreview}
              alt="Preview"
              style={{ marginTop: '8px', maxWidth: '100%', maxHeight: '150px', borderRadius: '6px', border: '1px solid #e2e8f0' }}
            />
          )}
        </div>

        {/* Error */}
        {submitError && (
          <div style={{ padding: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '6px', fontSize: '13px', marginBottom: '16px' }}>
            {submitError}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={() => onClose(false)}
            disabled={submitting}
            style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: '10px 20px',
              background: canSubmit ? '#3b82f6' : '#cbd5e1',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Saving...' : 'Save & Start Survey →'}
          </button>
        </div>
      </div>
    </div>
  );
}