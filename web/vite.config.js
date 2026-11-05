import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    // Same-origin socket in dev too, so `ngrok http 5173` also works (with hot reload).
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
