/**
 * Single source of truth: ship the actual example sources into Pyodide's VFS.
 * The fixed ESM/CSS starter is mapped to Vite-shaped build paths until the
 * in-browser bundler is implemented.
 */
import app from '../../examples/counter/app.py?raw';
import pyproject from '../../examples/counter/pyproject.toml?raw';
import template from '../../examples/counter/templates/app.html?raw';
import frontend from '../../examples/counter/frontend/app.js?raw';
import styles from '../../examples/counter/frontend/app.css?raw';
import manifest from '../../examples/counter/static/build/.vite/manifest.json?raw';
import browserInertia from './browser_inertia.py?raw';
import type { VirtualFileSystem } from './types';

/** The starter's own files, by path inside the project, as the editor shows them. */
export const counterSources: Record<string, string> = {
  'app.py': app,
  'templates/app.html': template,
  'frontend/app.js': frontend,
  'frontend/app.css': styles,
  'pyproject.toml': pyproject,
};

export const counterFiles: VirtualFileSystem = {
  '/browser_inertia.py': browserInertia,
  '/examples/counter/app.py': app,
  '/examples/counter/pyproject.toml': pyproject,
  '/examples/counter/templates/app.html': template,
  '/examples/counter/static/build/.vite/manifest.json': manifest,
  '/examples/counter/static/build/assets/app.js': frontend,
  '/examples/counter/static/build/assets/app.css': styles,
};
