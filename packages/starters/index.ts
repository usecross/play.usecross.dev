/**
 * The starter the playground runs, read from `examples/` at build time by the
 * shell's Vite config, `bun run test:python` and the browser tests.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The default starter's folder in `examples/`. */
export const STARTER = 'tasks';

/** Where a starter's files live in Pyodide's file system. */
export const starterDir = (name: string) => `/examples/${name}`;

/**
 * A starter's source files by path inside it, as the editor shows them:
 * everything but its frontend build, caches and local databases.
 */
export function readStarter(root: string, name = STARTER): Record<string, string> {
  const dir = resolve(root, 'examples', name);
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name).slice(dir.length + 1);
    if (/^static\/|(^|\/)__pycache__\/|\.sqlite3$/.test(path)) continue;
    files[path] = readFileSync(resolve(dir, path), 'utf8');
  }
  return files;
}

/** The files `bundleFrontend` takes: the starter's frontend/ folder. */
export const frontendSources = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith('frontend/')));
