import { join, resolve } from 'node:path';
import runtime from '../packages/starters/runtime.json';

const root = resolve(import.meta.dir, '..');
const result = Bun.spawnSync([
  'uv', 'run', '--python', '3.12', '--no-project',
  '--with-requirements', 'packages/starters/requirements.txt',
  '--with', join(root, 'apps/shell/public', runtime.crossInertia.wheelPath),
  'python', '-m', 'unittest', 'discover', '-s', 'tests/python',
], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
process.exit(result.exitCode);
