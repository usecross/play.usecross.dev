/**
 * Runs first in every preview page and reports its uncaught errors to the
 * shell, like Vite's dev client. The Service Worker inlines this function's
 * source into preview HTML, so it must not use anything from outside it.
 */
export function reportPreviewErrors() {
  // The shell's window. The runner's types are a worker's, which have no `parent`.
  const shell = (globalThis as unknown as { parent: { postMessage(message: object, origin: string): void } }).parent;
  const post = (message: object) => shell.postMessage(message, location.origin);
  // Keep the app's own frames, without the origin and mount: assets/app-[hash].js:12:5.
  const bundle = location.origin + '/preview/static/build/';
  const describe = (error: unknown, fallback: string) => {
    if (!(error instanceof Error)) return fallback;
    const frames = (error.stack ?? '').split('\n')
      .filter(line => line.includes(bundle))
      .map(line => '    ' + line.trim().split(bundle).join(''));
    return [`${error.name}: ${error.message}`, ...frames].join('\n');
  };

  post({ type: 'preview:start' });
  addEventListener('error', (event: ErrorEvent) => {
    // A page element, typed here for the same reason.
    const target = event.target as { tagName?: string; src?: string; href?: string } | null;
    if (target?.tagName) {
      // A script or stylesheet failed to load; these don't bubble, hence capture.
      post({ type: 'preview:error', error: `Failed to load ${target.src || target.href}` });
    } else {
      post({ type: 'preview:error', error: describe(event.error, event.message) });
    }
  }, true);
  addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    post({ type: 'preview:error', error: describe(event.reason, `Unhandled rejection: ${String(event.reason)}`) });
  });
}
