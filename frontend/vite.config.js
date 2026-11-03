import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'wards.geojson'],
      manifest: {
        name: 'GHMC Wet Market Routing',
        short_name: 'GHMC Routing',
        description: 'Field Survey App for GHMC Wet Markets',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // This makes it open without the browser bar
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  server: {
    host: true // Allows you to test the app on your phone via local Wi-Fi
  }
});