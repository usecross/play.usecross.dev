import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as esbuild from 'esbuild-wasm';
import { bundleFrontend } from '../packages/bundler/index.ts';
import starter from '../examples/counter/pyproject.toml';

const root = resolve(import.meta.dir, '..');

// Build the starter's frontend into static/build, as `vite build` would in a real project.
const project = resolve(root, 'examples/counter');
const sources = Object.fromEntries(readdirSync(resolve(project, 'frontend'))
  .map(name => [`frontend/${name}`, readFileSync(resolve(project, 'frontend', name), 'utf8')]));
rmSync(resolve(project, 'static/build'), { recursive: true, force: true });
for (const [path, content] of Object.entries((await bundleFrontend(esbuild, sources)).files)) {
  mkdirSync(dirname(resolve(project, path)), { recursive: true });
  writeFileSync(resolve(project, path), content);
}

const result = Bun.spawnSync([
  'uv', 'run', '--python', '3.12', '--no-project',
  ...starter.project.dependencies.flatMap((dependency: string) => ['--with', dependency]),
  'python', '-m', 'unittest', 'discover', '-s', 'tests/python',
], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
process.exit(result.exitCode);
