import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    // When the Bobcatch server exists, requests to /api are forwarded to it
    // so the browser only ever talks to one origin during development.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Bobcatch',
        short_name: 'Bobcatch',
        description: 'Unofficial live NYU bus tracker, built by students.',
        theme_color: '#111716',
        background_color: '#111716',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
