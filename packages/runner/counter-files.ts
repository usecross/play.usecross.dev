/// <reference path="./raw.d.ts" />
/**
 * Single source of truth: ship the actual example sources into Pyodide's VFS,
 * with their frontend bundled at build time into Vite-shaped build paths.
 */
import app from '../../examples/counter/app.py?raw';
import pyproject from '../../examples/counter/pyproject.toml?raw';
import template from '../../examples/counter/templates/app.html?raw';
import frontend from '../../examples/counter/frontend/app.tsx?raw';
import styles from '../../examples/counter/frontend/app.css?raw';
import starterBuild from 'virtual:starter-build';
import browserInertia from './browser_inertia.py?raw';
import type { VirtualFileSystem } from './types';

/** The starter's own files, by path inside the project, as the editor shows them. */
export const counterSources: Record<string, string> = {
  'app.py': app,
  'templates/app.html': template,
  'frontend/app.tsx': frontend,
  'frontend/app.css': styles,
  'pyproject.toml': pyproject,
};

/** Where counterSources live in Pyodide's file system. */
export const STARTER_DIR = '/examples/counter';

/** Sources the playground can apply edits to; the rest come in later steps. */
export const editableSources = ['app.py', 'templates/app.html', 'frontend/app.tsx', 'frontend/app.css'];

/** The starter's frontend build, by path inside the project. */
export const starterBuildFiles = starterBuild.files;

export const counterFiles: VirtualFileSystem = {
  '/browser_inertia.py': browserInertia,
  '/examples/counter/app.py': app,
  '/examples/counter/pyproject.toml': pyproject,
  '/examples/counter/templates/app.html': template,
  ...Object.fromEntries(Object.entries(starterBuild.files).map(([path, content]) => [`${STARTER_DIR}/${path}`, content])),
};
