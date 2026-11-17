/// <reference path="./raw.d.ts" />
/**
 * Single source of truth: ship the actual starter's sources into Pyodide's
 * VFS, with their frontend bundled at build time into Vite-shaped build paths.
 */
import starter from 'virtual:starter';
import browserInertia from './browser_inertia.py?raw';
import type { VirtualFileSystem } from './types';

/** The starter's own files, by path inside the project, as the editor shows them. */
export const starterSources: Record<string, string> = starter.sources;

/** Where starterSources live in Pyodide's file system. */
export const STARTER_DIR = `/examples/${starter.name}`;

/** Sources the playground can apply edits to. pyproject.toml applies by restarting Python. */
export const editableSources = Object.keys(starterSources);

/** The starter's frontend build, by path inside the project. */
export const starterBuildFiles = starter.build.files;

/** What a new Python worker starts with: the runtime's module, the starter and its build. */
export const starterFiles: VirtualFileSystem = {
  '/browser_inertia.py': browserInertia,
  ...Object.fromEntries(Object.entries({ ...starterSources, ...starterBuildFiles })
    .filter(([path]) => !path.startsWith('frontend/'))
    .map(([path, content]) => [`${STARTER_DIR}/${path}`, content])),
};
