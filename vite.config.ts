import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Cuentas de la familia',
        short_name: 'Cuentas',
        description: 'Plan del mes, pagos, cobros y gastos de la casa.',
        lang: 'es-AR',
        start_url: '/',
        display: 'standalone',
        background_color: '#F2F4F1',
        theme_color: '#1E6B4E',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: { navigateFallbackDenylist: [/^\/auth/] },
    }),
  ],
})
