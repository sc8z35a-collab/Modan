import { defineConfig } from 'vite';
export default defineConfig({
  // relative base: the site is served from a sub-path (GitHub Pages: /Modan/). Absolute '/...' URLs 404'd there.
  base: './',
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
