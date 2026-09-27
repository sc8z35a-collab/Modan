import { defineConfig } from 'vite';

// GitHub Pages publishes this repository's root as-is (https://<user>.github.io/Modan/), so the root
// index.html carries a tiny redirect to the pre-built site in ./site/. Vite strips that block, so
// dev / preview / normal builds are unaffected.
const stripPagesRedirect = {
  name: 'strip-pages-redirect',
  transformIndexHtml: (html) => html.replace(/<!--pages-redirect-->[\s\S]*?<!--\/pages-redirect-->\s*/, ''),
};

export default defineConfig({
  // relative base: the site is served from a sub-path (/Modan/site/). Absolute '/...' URLs 404'd there.
  base: './',
  plugins: [stripPagesRedirect],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
