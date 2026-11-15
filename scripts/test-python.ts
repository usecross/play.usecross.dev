import { resolve } from 'node:path';
import starter from '../examples/counter/pyproject.toml';

const root = resolve(import.meta.dir, '..');
const result = Bun.spawnSync([
  'uv', 'run', '--python', '3.12', '--no-project',
  ...starter.project.dependencies.flatMap((dependency: string) => ['--with', dependency]),
  'python', '-m', 'unittest', 'discover', '-s', 'tests/python',
], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
process.exit(result.exitCode);
