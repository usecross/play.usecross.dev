/**
 * esbuild-wasm in the browser. The shell imports this lazily, on the first
 * frontend edit, so the 12 MB wasm never delays a visit that doesn't need it.
 * esbuild runs the wasm in its own Web Worker.
 */
import * as esbuild from 'esbuild-wasm';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import { bundleFrontend } from './index.ts';

let ready: Promise<void> | undefined;

export async function bundle(sources: Record<string, string>) {
  // A failed load, such as a network error, is retried on the next bundle.
  ready ??= esbuild.initialize({ wasmURL, worker: true }).catch(error => {
    ready = undefined;
    throw error;
  });
  await ready;
  return bundleFrontend(esbuild, sources);
}
