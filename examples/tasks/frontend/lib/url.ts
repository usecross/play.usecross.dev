import { usePage } from '@inertiajs/react';

/**
 * Build links to the app's routes. The app can be served under a path, such
 * as /preview in the playground, so the server shares it as root_path.
 */
export function useUrl() {
  const { root_path } = usePage<{ root_path: string }>().props;
  return (path: string) => root_path + path;
}
