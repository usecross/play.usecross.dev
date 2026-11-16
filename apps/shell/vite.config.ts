import { defineConfig, type Plugin } from 'vite';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as esbuild from 'esbuild-wasm';
import { bundleFrontend } from '../../packages/bundler/index.ts';

/**
 * `virtual:starter-build`: the starter's frontend, bundled at build time by
 * the same function the browser uses after an edit, so a first visit needs no
 * esbuild download.
 */
function starterBuild(): Plugin {
  const id = 'virtual:starter-build';
  const frontend = resolve(__dirname, '../../examples/counter/frontend');
  return {
    name: 'starter-build',
    resolveId: source => (source === id ? `\0${id}` : undefined),
    async load(moduleId) {
      if (moduleId !== `\0${id}`) return;
      const sources: Record<string, string> = {};
      for (const name of readdirSync(frontend)) {
        this.addWatchFile(resolve(frontend, name));
        sources[`frontend/${name}`] = readFileSync(resolve(frontend, name), 'utf8');
      }
      return `export default ${JSON.stringify(await bundleFrontend(esbuild, sources))};`;
    },
  };
}

export default defineConfig({
  plugins: [starterBuild()],
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
    },
  },
});
