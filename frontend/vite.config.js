import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Signed email links are opened from the public tunnel/domain, which is a
    // different Host header than localhost. Vite blocks unknown hosts by default.
    allowedHosts: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true }
    }
  },
  preview: {
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true }
    }
  }
});
