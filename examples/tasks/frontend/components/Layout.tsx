import type { ReactNode } from 'react';
import { Link, usePage } from '@inertiajs/react';
import { useUrl } from '../lib/url';
import type { SharedProps } from '../types';

/** Wraps every page. Inertia keeps it mounted while you move between pages. */
export default function Layout({ children }: { children: ReactNode }) {
  const { props, url: current } = usePage<SharedProps>();
  const url = useUrl();
  const link = (path: string, label: ReactNode) => (
    <Link href={url(path)} aria-current={current.startsWith(url(path)) ? 'page' : undefined}>{label}</Link>
  );

  return (
    <div className="layout">
      <header>
        <strong>Tasks</strong>
        <nav aria-label="Main">
          {link('/tasks', <>Tasks <span className="badge" aria-label={`${props.counts.open} open`}>{props.counts.open}</span></>)}
          {link('/stats', 'Stats')}
        </nav>
      </header>
      {props.flash && <p className="flash" role="status">{props.flash}</p>}
      <main>{children}</main>
      <footer>Real CrossInertia · FastAPI · Pyodide</footer>
    </div>
  );
}
