import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const result = Bun.spawnSync([
  'uv', 'run', '--python', '3.12', '--no-project',
  '--with-requirements', 'packages/starters/requirements.txt',
  'python', '-m', 'unittest', 'discover', '-s', 'tests/python',
], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
process.exit(result.exitCode);
