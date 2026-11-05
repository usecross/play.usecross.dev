/**
 * TEMPORARY: build the real upstream wheel with PR #146's thread-free sync
 * resolution. This is not the PyPI 0.22.1 wheel. No source patches are applied.
 * Replace with a published pin once that fix is released.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import runtime from '../packages/starters/runtime.json';

const root = resolve(import.meta.dir, '..');
const source = runtime.crossInertia;
const destination = join(root, 'apps/shell/public', source.wheelPath);
const stampPath = destination + '.source.json';
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

async function cachedWheelIsValid() {
  try {
    const stamp = JSON.parse(await readFile(stampPath, 'utf8'));
    return stamp.revision === source.revision
      && stamp.archiveSha256 === source.archiveSha256
      && stamp.wheelSha256 === hash(await readFile(destination));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return false;
    throw error;
  }
}

function run(args: string[]) {
  const result = Bun.spawnSync(args, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) throw new Error(`Command failed: ${args.join(' ')} (requires uv and tar on PATH)`);
}

if (await cachedWheelIsValid()) {
  console.log(`Using CrossInertia upstream ${source.revision.slice(0, 7)} (PR #146 candidate)`);
} else {
  const temporary = await mkdtemp(join(tmpdir(), 'play-cross-inertia-'));
  try {
    const url = `https://codeload.github.com/usecross/cross-inertia/tar.gz/${source.revision}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Upstream download failed: HTTP ${response.status}`);
    const archive = new Uint8Array(await response.arrayBuffer());
    if (hash(archive) !== source.archiveSha256) throw new Error('Upstream source SHA256 mismatch');

    const archivePath = join(temporary, 'source.tar.gz');
    const sourcePath = join(temporary, 'source');
    const wheelDirectory = join(temporary, 'wheels');
    await writeFile(archivePath, archive);
    await mkdir(sourcePath);
    run(['tar', '-xzf', archivePath, '--strip-components=1', '-C', sourcePath]);
    run(['uv', 'build', '--wheel', sourcePath, '--out-dir', wheelDirectory]);
    const wheel = await readFile(join(wheelDirectory, source.wheelPath.split('/').at(-1)!));

    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination + '.tmp', wheel);
    await rename(destination + '.tmp', destination);
    await writeFile(stampPath, JSON.stringify({
      revision: source.revision,
      archiveSha256: source.archiveSha256,
      wheelSha256: hash(wheel),
      pullRequest: source.pullRequest,
    }, null, 2) + '\n');
    console.log(`Built CrossInertia from upstream ${source.revision} (unreleased PR #146)`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
