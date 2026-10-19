/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Sub-path hosting (GitHub Pages serves the app at /EG-Laundry/): set VITE_BASE_PATH=/EG-Laundry/ at build time.
// Root hosting (Cloudflare Pages, Netlify, Vercel, own domain) leaves it unset.
const base = (process.env.VITE_BASE_PATH ?? '/').replace(/\/?$/, '/')

// Pages of builds with registerType 'autoUpdate' reload only when a new service worker activates by itself. Until a
// 'prompt' worker has been active once on this device, a new worker therefore takes over at once (so those pages still
// update themselves); after that it waits until main.tsx applies it.
const SW_HANDOVER = `const MARKER = 'eg-laundry-sw-prompt'
self.addEventListener('install', (event) => {
  event.waitUntil(caches.has(MARKER).then((prompt) => (prompt ? undefined : self.skipWaiting())))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.open(MARKER))
})
`

function swHandover(): Plugin {
  return {
    name: 'eg-laundry-sw-handover',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sw-handover.js', source: SW_HANDOVER })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    swHandover(),
    VitePWA({
      // 'prompt': main.tsx applies a new version itself, and waits for a tap while a reload would lose work
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'EG Laundry',
        short_name: 'EG Laundry',
        description: 'Aplikasi kasir dan pelanggan laundry: pesanan, pelanggan, harga, dan laporan.',
        lang: 'id',
        theme_color: '#0369a1',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/node_modules/**/*', 'sw-handover.js'],
        importScripts: ['sw-handover.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'cdn-cache', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
