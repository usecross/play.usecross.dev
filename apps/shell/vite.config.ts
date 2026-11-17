import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import * as esbuild from 'esbuild-wasm';
import { bundleFrontend } from '../../packages/bundler/index.ts';
import { STARTER, frontendSources, readStarter } from '../../packages/starters/index.ts';

/**
 * `virtual:starter`: the starter's files, and its frontend bundled at build
 * time by the same function the browser uses after an edit, so a first visit
 * needs no esbuild download.
 */
function starter(): Plugin {
  const id = 'virtual:starter';
  const root = resolve(__dirname, '../..');
  return {
    name: 'starter',
    resolveId: source => (source === id ? `\0${id}` : undefined),
    async load(moduleId) {
      if (moduleId !== `\0${id}`) return;
      const sources = readStarter(root);
      for (const path of Object.keys(sources)) this.addWatchFile(resolve(root, 'examples', STARTER, path));
      const build = await bundleFrontend(esbuild, frontendSources(sources));
      return `export default ${JSON.stringify({ name: STARTER, sources, build })};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), starter()],
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
      '@play.usecross.dev/bundler': resolve(__dirname, '../../packages/bundler'),
      '@': resolve(__dirname, 'src'),
    },
  },
});
