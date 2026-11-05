import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sw: resolve(__dirname, 'sw.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Service Worker needs to be at /sw.js for proper scope
          if (chunkInfo.name === 'sw') {
            return 'sw.js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    // Serve the SW from the runner package in dev mode
    fs: {
      allow: ['../..'],
    },
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@play.usecross.dev/runner': resolve(__dirname, '../../packages/runner'),
    },
  },
});
