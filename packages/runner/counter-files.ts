/**
 * Single source of truth: ship the actual example sources into Pyodide's VFS.
 * The fixed ESM/CSS starter is mapped to Vite-shaped build paths until the
 * in-browser bundler is implemented.
 */
import app from '../../examples/counter/app.py?raw';
import template from '../../examples/counter/templates/app.html?raw';
import frontend from '../../examples/counter/frontend/app.js?raw';
import styles from '../../examples/counter/frontend/app.css?raw';
import manifest from '../../examples/counter/static/build/.vite/manifest.json?raw';
import browserInertia from './browser_inertia.py?raw';
import type { VirtualFileSystem } from './types';

export const counterFiles: VirtualFileSystem = {
  '/browser_inertia.py': browserInertia,
  '/examples/counter/app.py': app,
  '/examples/counter/templates/app.html': template,
  '/examples/counter/static/build/.vite/manifest.json': manifest,
  '/examples/counter/static/build/assets/app.js': frontend,
  '/examples/counter/static/build/assets/app.css': styles,
};
