import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Built output is served by server/serve.py (which also owns /api).
// `npm run dev` proxies /api to that same python server on 7840.
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5273,
    proxy: { '/api': 'http://127.0.0.1:7840' },
  },
});
