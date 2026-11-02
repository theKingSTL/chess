import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: { alias: { '@engine': path.resolve('src/three-isometric-engine') } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
  preview: { host: '127.0.0.1', port: 5180, strictPort: true },
});
