import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as esbuild from 'esbuild-wasm';
import { bundleFrontend } from '../packages/bundler/index.ts';
import { STARTER, frontendSources, readStarter } from '../packages/starters/index.ts';

const root = resolve(import.meta.dir, '..');
const starter = Bun.TOML.parse(readStarter(root)['pyproject.toml']) as { project: { dependencies: string[] } };

// Build the starter's frontend into static/build, as `vite build` would in a real project.
const project = resolve(root, 'examples', STARTER);
rmSync(resolve(project, 'static/build'), { recursive: true, force: true });
for (const [path, content] of Object.entries((await bundleFrontend(esbuild, frontendSources(readStarter(root)))).files)) {
  mkdirSync(dirname(resolve(project, path)), { recursive: true });
  writeFileSync(resolve(project, path), content);
}

const result = Bun.spawnSync([
  'uv', 'run', '--python', '3.13', '--no-project',
  ...starter.project.dependencies.flatMap(dependency => ['--with', dependency]),
  'python', '-m', 'unittest', 'discover', '-s', 'tests/python',
], { cwd: root, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, PLAYGROUND_STARTER: STARTER } });
process.exit(result.exitCode);
