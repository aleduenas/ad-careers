import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { root as repositoryRoot } from '../src/lib/root.mjs';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => ({
  root: webRoot,
  // The page carries the time it was built so it can tell when the running service is older.
  define: {
    __BUILD_STAMP__: JSON.stringify(command === 'build' ? new Date().toISOString() : 'dev'),
  },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['127.0.0.1'],
    fs: {
      strict: true,
      allow: [webRoot, resolve(repositoryRoot, 'node_modules')],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        changeOrigin: true,
        xfwd: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
