import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser Geolocation API only works in a secure context. localhost counts
// as secure; to test on a phone over the LAN run `npm run dev:https`, which
// serves a self-signed certificate (VITE_HTTPS=1).
const https = process.env.VITE_HTTPS === '1'

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(https ? [basicSsl()] : [])],
  server: {
    host: https ? true : 'localhost',
    // Same-origin API in development, so phones on the LAN reach the API through Vite.
    proxy: { '/api': { target: process.env.VITE_API_PROXY || 'http://localhost:4000', changeOrigin: true } },
  },
  test: { environment: 'node' },
})
