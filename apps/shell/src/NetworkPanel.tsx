/**
 * The preview's requests to the app, like a browser's Network panel, with
 * each one labelled by what it is in Inertia's protocol: a full page load,
 * an Inertia visit that returns only JSON, a partial reload, a redirect.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Ban, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { clearNetwork, type NetworkEntry } from './runtime';

type Kind = 'Document' | 'Inertia' | 'Partial' | 'Redirect' | 'Conflict' | 'Script' | 'Stylesheet' | 'JSON' | 'Other' | 'Failed';

const header = (entry: NetworkEntry, name: string) => entry.requestHeaders[name];

function kind(entry: NetworkEntry): Kind {
  if (entry.status === 0) return 'Failed';
  if (entry.status >= 300 && entry.status < 400) return 'Redirect';
  if (header(entry, 'x-inertia') === 'true') {
    if (entry.status === 409) return 'Conflict';
    return header(entry, 'x-inertia-partial-data') || header(entry, 'x-inertia-partial-except') ? 'Partial' : 'Inertia';
  }
  const type = entry.responseHeaders['content-type'] ?? '';
  if (type.includes('html')) return 'Document';
  if (type.includes('javascript')) return 'Script';
  if (type.includes('css')) return 'Stylesheet';
  if (type.includes('json')) return 'JSON';
  return 'Other';
}

const KIND_STYLE: Partial<Record<Kind, string>> = {
  Document: 'bg-sky-100 text-sky-900',
  Inertia: 'bg-violet-100 text-violet-900',
  Partial: 'bg-fuchsia-100 text-fuchsia-900',
  Redirect: 'bg-amber-100 text-amber-900',
  Conflict: 'bg-orange-100 text-orange-900',
  Failed: 'bg-red-100 text-red-900',
};

const FILTERS = {
  All: () => true,
  Inertia: (k: Kind) => ['Inertia', 'Partial', 'Redirect', 'Conflict'].includes(k),
  Document: (k: Kind) => k === 'Document',
  Assets: (k: Kind) => k === 'Script' || k === 'Stylesheet',
};

function formatSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/** The Inertia page object in a response: its JSON, or the one an HTML page embeds. */
function pageObject(entry: NetworkEntry): Record<string, any> | null {
  if (!entry.responseBody) return null;
  try {
    const k = kind(entry);
    if (k === 'Inertia' || k === 'Partial') return JSON.parse(entry.responseBody);
    if (k === 'Document') {
      const script = new DOMParser().parseFromString(entry.responseBody, 'text/html').querySelector('script[data-page]');
      return script?.textContent ? JSON.parse(script.textContent) : null;
    }
  } catch {
    // Not a page object.
  }
  return null;
}

const list = (value: string | undefined) => (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
const names = (items: string[]) => items.map(item => <code key={item} className="font-mono">{item}</code>)
  .flatMap((item, i) => (i ? [', ', item] : [item]));

/** One or two sentences on what this request is in Inertia's protocol. */
function explain(entry: NetworkEntry): ReactNode {
  switch (kind(entry)) {
    case 'Document':
      return <>A full page load. The server rendered HTML with the page object in a script tag; the app's JavaScript and CSS load next.</>;
    case 'Inertia':
      return <>An Inertia visit: the client sent <code className="font-mono">X-Inertia: true</code> and got the page object back as JSON. No HTML, JavaScript or CSS was loaded.</>;
    case 'Partial': {
      const only = list(header(entry, 'x-inertia-partial-data'));
      const except = list(header(entry, 'x-inertia-partial-except'));
      return (
        <>
          A partial reload: the client asked only for {only.length ? names(only) : <>everything except {names(except)}</>}.
          The server sent those, plus <code className="font-mono">always()</code> props and <code className="font-mono">errors</code>,
          and the client keeps the other props it has.
        </>
      );
    }
    case 'Redirect':
      return (
        <>
          The server answered {entry.status} with <code className="font-mono">Location: {entry.responseHeaders.location}</code>.
          The browser follows it with a GET{header(entry, 'x-inertia') ? ', which keeps the X-Inertia header, so the next page also comes back as JSON' : ''}.
        </>
      );
    case 'Conflict':
      return <>The client's asset version is out of date, so the server answered 409 with <code className="font-mono">X-Inertia-Location</code>, and the client does a full page load to get the new build.</>;
    case 'Script':
    case 'Stylesheet':
      return <>Part of the frontend build in <code className="font-mono">static/build</code>, served by <code className="font-mono">app.frontend()</code>.</>;
    case 'Failed':
      return <>Python failed to answer: {entry.error}</>;
    default:
      return null;
  }
}

export function NetworkPanel({ entries }: { entries: NetworkEntry[] }) {
  const [filter, setFilter] = useState<keyof typeof FILTERS>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const shown = useMemo(() => entries.filter(entry => FILTERS[filter](kind(entry))), [entries, filter]);
  const selected = entries.find(entry => entry.id === selectedId);
  const total = shown.reduce((sum, entry) => sum + entry.size, 0);

  // Follow new requests, unless the list was scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [shown.length, selected]);

  return (
    <section aria-label="Network" className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-1.5 text-xs">
        <h2 className="px-1.5 font-medium">Network</h2>
        <div role="group" aria-label="Filter requests" className="flex gap-0.5">
          {Object.keys(FILTERS).map(name => (
            <button
              key={name}
              type="button"
              aria-pressed={filter === name}
              onClick={() => setFilter(name as keyof typeof FILTERS)}
              className="h-6 rounded-md px-2 text-muted-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="whitespace-nowrap text-muted-foreground">
          {shown.length} {shown.length === 1 ? 'request' : 'requests'} · {formatSize(total)}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Clear requests" onClick={() => { clearNetwork(); setSelectedId(null); }}>
              <Ban />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear requests</TooltipContent>
        </Tooltip>
      </div>
      {selected ? (
        <RequestDetail key={selected.id} entry={selected} entries={entries} onClose={() => setSelectedId(null)} />
      ) : (
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-auto"
          onScroll={event => {
            const el = event.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
          }}
        >
          {shown.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Requests the preview makes to your app show here. Click a link or submit a form in the preview.
            </p>
          ) : (
            <table aria-label="Requests" className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-background text-left text-muted-foreground shadow-[0_1px_0_var(--border)]">
                <tr>
                  <th className="px-2 py-1 font-normal">Name</th>
                  <th className="w-12 px-2 py-1 font-normal">Status</th>
                  <th className="w-20 px-2 py-1 font-normal">Type</th>
                  <th className="w-16 px-2 py-1 text-right font-normal">Size</th>
                  <th className="w-14 px-2 py-1 text-right font-normal">Time</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(entry => {
                  const k = kind(entry);
                  return (
                    <tr key={entry.id} onClick={() => setSelectedId(entry.id)} className="cursor-pointer border-b border-border/60 hover:bg-muted/60">
                      <td className="truncate px-2 py-1 font-mono">
                        <button type="button" className="w-full truncate text-left outline-none focus-visible:underline" title={`${entry.method} ${entry.path}`}>
                          {entry.method !== 'GET' && <span className="mr-1 text-muted-foreground">{entry.method}</span>}
                          {entry.path}
                        </button>
                      </td>
                      <td className={cn('px-2 py-1 tabular-nums', (entry.status === 0 || entry.status >= 400) && 'text-destructive')}>
                        {entry.status || '—'}
                      </td>
                      <td className="px-2 py-1">
                        <span className={cn('rounded px-1 py-px', KIND_STYLE[k] ?? 'text-muted-foreground')}>{k}</span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{formatSize(entry.size)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{Math.round(entry.time)} ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

function RequestDetail({ entry, entries, onClose }: { entry: NetworkEntry; entries: NetworkEntry[]; onClose: () => void }) {
  const page = useMemo(() => pageObject(entry), [entry]);
  // A partial reload's props merge into the last full page of the same component.
  const previous = useMemo(() => {
    if (kind(entry) !== 'Partial' || !page) return null;
    for (const earlier of entries.filter(e => e.id < entry.id).reverse()) {
      if (kind(earlier) !== 'Inertia' && kind(earlier) !== 'Document') continue;
      const other = pageObject(earlier);
      if (other?.component === page.component) return other;
    }
    return null;
  }, [entry, entries, page]);
  const query = [...new URLSearchParams(entry.path.split('?')[1] ?? '')];
  const hasPayload = query.length > 0 || entry.requestBody !== null;
  const [tab, setTab] = useState(page ? 'page' : 'headers');
  const description = explain(entry);

  return (
    <div role="region" aria-label="Request details" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2 text-xs">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono font-medium">
            {entry.method} {entry.path} <span className="text-muted-foreground">· {entry.status || 'failed'} · {kind(entry)}</span>
          </p>
          {description && <p className="mt-1 text-muted-foreground">{description}</p>}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close request details" onClick={onClose}><X /></Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="h-8 shrink-0 px-2">
          {page && <TabsTrigger value="page" className="text-xs">Page</TabsTrigger>}
          <TabsTrigger value="headers" className="text-xs">Headers</TabsTrigger>
          {hasPayload && <TabsTrigger value="payload" className="text-xs">Payload</TabsTrigger>}
          <TabsTrigger value="response" className="text-xs">Response</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-auto border-t p-3 text-xs">
          {page && <TabsContent value="page"><PageView entry={entry} page={page} previous={previous} /></TabsContent>}
          <TabsContent value="headers" className="grid grid-cols-1 gap-3">
            <HeaderList title="General" headers={{ 'Request URL': `/preview${entry.path}`, 'Request method': entry.method, Status: String(entry.status || 'failed') }} />
            <HeaderList title="Response headers" headers={entry.responseHeaders} />
            <HeaderList title="Request headers" headers={entry.requestHeaders} />
          </TabsContent>
          {hasPayload && (
            <TabsContent value="payload" className="grid grid-cols-1 gap-3">
              {query.length > 0 && <HeaderList title="Query string" headers={Object.fromEntries(query)} />}
              {entry.requestBody !== null && (
                <div>
                  <h3 className="mb-1 font-medium">Request body</h3>
                  <Code text={entry.requestBody} />
                </div>
              )}
            </TabsContent>
          )}
          <TabsContent value="response">
            {entry.responseBody !== null
              ? <Code text={entry.responseBody} />
              : <p className="text-muted-foreground">{entry.size ? 'This response is not text.' : 'This response has no body.'}</p>}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/** The Inertia page object, with each prop labelled by how it got there. */
function PageView({ entry, page, previous }: { entry: NetworkEntry; page: Record<string, any>; previous: Record<string, any> | null }) {
  const shared = new Set<string>(page.sharedProps ?? []);
  const deferred = Object.entries<string[]>(page.deferredProps ?? {}).flatMap(([group, props]) => props.map(prop => [prop, group]));
  const requested = list(header(entry, 'x-inertia-partial-data'));
  // Props a partial reload left out: the last full page's, or after a Clear,
  // at least the shared ones the page object names.
  const known = previous ? Object.keys(previous.props ?? {}) : kind(entry) === 'Partial' ? [...shared] : [];
  const kept = known.filter(name => !(name in (page.props ?? {})));
  return (
    <div className="grid grid-cols-1 gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">component</dt><dd className="font-mono">{page.component}</dd>
        <dt className="text-muted-foreground">url</dt><dd className="font-mono">{page.url}</dd>
        <dt className="text-muted-foreground">version</dt><dd className="truncate font-mono">{page.version}</dd>
      </dl>
      <div>
        <h3 className="mb-1 font-medium">Props in this response</h3>
        <ul aria-label="Props" className="grid grid-cols-1 gap-1">
          {Object.entries(page.props ?? {}).map(([name, value]) => (
            <li key={name}>
              <details className="group rounded-md border">
                <summary className="flex cursor-pointer items-center gap-2 px-2 py-1">
                  <span className="font-mono font-medium">{name}</span>
                  {shared.has(name) && <Badge title="From inertia_share, on every page">shared</Badge>}
                  {requested.includes(name) && <Badge title="Named in X-Inertia-Partial-Data">requested</Badge>}
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{JSON.stringify(value)}</span>
                </summary>
                <Code text={JSON.stringify(value, null, 2)} className="m-0 rounded-none border-0 border-t" />
              </details>
            </li>
          ))}
        </ul>
      </div>
      {kept.length > 0 && (
        <p className="text-muted-foreground">
          Not sent, so the client keeps the values it has: {names(kept)}.
        </p>
      )}
      {deferred.length > 0 && (
        <p className="text-muted-foreground">
          Deferred, not in this response: {deferred.map(([prop, group], i) => (
            <span key={prop}>{i ? ', ' : ''}<code className="font-mono text-foreground">{prop}</code> (group {group})</span>
          ))}. The client asks for them in a partial reload once the page has rendered.
        </p>
      )}
    </div>
  );
}

function Badge({ children, title }: { children: ReactNode; title: string }) {
  return <span title={title} className="rounded bg-muted px-1 text-[0.7rem] text-muted-foreground">{children}</span>;
}

function HeaderList({ title, headers }: { title: string; headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  return (
    <div>
      <h3 className="mb-1 font-medium">{title}</h3>
      <dl className="grid grid-cols-[minmax(0,auto)_1fr] gap-x-3 gap-y-0.5 font-mono">
        {entries.map(([name, value]) => {
          // Inertia's own headers stand out.
          const inertia = /^x-inertia/i.test(name);
          return (
            <div key={name} className="contents">
              <dt className={inertia ? 'text-violet-700' : 'text-muted-foreground'}>{name}</dt>
              <dd className={cn('break-all', inertia && 'text-violet-700')}>{value}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function Code({ text, className }: { text: string; className?: string }) {
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not JSON: show it as it is.
  }
  return (
    <pre className={cn('overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[0.7rem]/4 whitespace-pre-wrap break-all', className)}>
      {pretty}
    </pre>
  );
}
