import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2021',
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        settings: resolve(import.meta.dirname, 'settings.html'),
      },
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
