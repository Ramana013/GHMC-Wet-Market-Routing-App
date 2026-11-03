import axios from 'axios';

const API_URL = import.meta.env.VITE_API_BASE_URL;

export const fetchShopsInBBox = async (bbox) => {
  // bbox format: minLng, minLat, maxLng, maxLat
  const response = await axios.get(`${API_URL}/api/shops/`, {
    params: { bbox: bbox }
  });
  return response.data.features; // GeoJSON returns an array of features
};