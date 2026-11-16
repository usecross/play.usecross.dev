/**
 * Bundle the starter's frontend the way `vite build` would, with esbuild.
 *
 * The same function runs at deploy time (esbuild-wasm in Node, through the
 * shell's Vite config) and in the browser after a frontend edit, so both
 * produce the same files and manifest. Packages the page imports, such as
 * React and Inertia, stay external: the template's import map loads them.
 */
import type * as esbuild from 'esbuild-wasm';

/** The frontend's entry, as Vite names it in the manifest and app.py names it. */
export const FRONTEND_ENTRY = 'frontend/app.tsx';

export interface BundleResult {
  /** Built files by path inside the project, including `static/build/.vite/manifest.json`. */
  files: Record<string, string>;
  manifest: Record<string, { file: string; src: string; isEntry: true; css?: string[] }>;
}

/**
 * Bundle `sources` (project path → contents, such as `frontend/app.tsx`).
 * Rejects with esbuild's formatted errors, which name the file and line.
 */
export async function bundleFrontend(
  api: Pick<typeof esbuild, 'build' | 'formatMessages'>,
  sources: Record<string, string>,
): Promise<BundleResult> {
  const result = await api.build({
    entryPoints: [FRONTEND_ENTRY],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    jsx: 'automatic',
    target: 'es2020',
    outdir: 'static/build',
    entryNames: 'assets/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    absWorkingDir: '/',
    logLevel: 'silent',
    plugins: [projectFiles(sources)],
  }).catch(async (error: esbuild.BuildFailure) => {
    if (!error.errors) throw error;
    const messages = await api.formatMessages(error.errors, { kind: 'error' });
    throw new Error(messages.join('').trimEnd());
  });

  const files: Record<string, string> = {};
  for (const output of result.outputFiles) files[output.path.slice(1)] = output.text;
  const [js, meta] = Object.entries(result.metafile.outputs)
    .find(([, output]) => output.entryPoint === FRONTEND_ENTRY)!;
  const entry = { file: js.slice('static/build/'.length), src: FRONTEND_ENTRY, isEntry: true as const };
  const manifest = {
    [FRONTEND_ENTRY]: meta.cssBundle ? { ...entry, css: [meta.cssBundle.slice('static/build/'.length)] } : entry,
  };
  files['static/build/.vite/manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
  return { files, manifest };
}

/** Resolve relative imports to `sources`, and bare package imports to the import map. */
function projectFiles(sources: Record<string, string>): esbuild.Plugin {
  const loaders: Record<string, esbuild.Loader> = { tsx: 'tsx', ts: 'ts', jsx: 'jsx', js: 'js', css: 'css' };
  return {
    name: 'project-files',
    setup(build) {
      // Project files get absolute paths under '/', so errors show them as `frontend/app.tsx`.
      build.onResolve({ filter: /^[^./]/ }, args =>
        args.kind === 'entry-point' ? { path: `/${args.path}` } : { path: args.path, external: true });
      build.onResolve({ filter: /^\./ }, args => ({ path: new URL(args.path, `file://${args.importer}`).pathname }));
      build.onLoad({ filter: /.*/ }, args => {
        const path = args.path.slice(1);
        const loader = loaders[path.split('.').pop()!];
        if (!(path in sources) || !loader) return { errors: [{ text: `Cannot find ${path}` }] };
        return { contents: sources[path], loader };
      });
    },
  };
}
