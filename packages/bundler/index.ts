/**
 * Bundler package - esbuild-wasm integration
 * 
 * Phase 0: Stub - Monaco editor and dynamic bundling come in Phase 1+
 * Phase 1: Full implementation with esbuild-wasm worker and virtual FS plugin
 * 
 * For Phase 0, frontend assets are pre-built or referenced directly.
 * The Service Worker serves /static/build/... from synthetic manifest.
 */

export interface BundleResult {
  files: Record<string, Uint8Array>;
  manifest: Record<string, { file: string; css?: string[] }>;
}

export async function bundleFrontend(
  files: Record<string, string>
): Promise<BundleResult> {
  throw new Error('Bundler not implemented in Phase 0. Monaco and dynamic bundling planned for Phase 1.');
}

export async function initializeBundler(): Promise<void> {
  console.log('[Bundler] Phase 0 stub - no dynamic bundling yet');
}
