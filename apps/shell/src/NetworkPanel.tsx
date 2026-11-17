/**
 * The preview's requests to the app, like a browser's Network panel, with
 * each one labelled by what it is in Inertia's protocol: a full page load,
 * an Inertia visit that returns only JSON, a partial reload, a redirect.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Ban, ChevronRight, History, Hourglass, Info, X } from 'lucide-react';
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
  // A partial reload's props merge into what the client has: the last full
  // page of the same component, and the partial reloads after it.
  const known = useMemo(() => {
    if (kind(entry) !== 'Partial' || !page) return null;
    const names = new Set<string>();
    for (const earlier of entries.filter(e => e.id < entry.id).reverse()) {
      const k = kind(earlier);
      if (k !== 'Inertia' && k !== 'Document' && k !== 'Partial') continue;
      const other = pageObject(earlier);
      if (!other || other.component !== page.component) break;
      Object.keys(other.props ?? {}).forEach(name => names.add(name));
      if (k !== 'Partial') break;
    }
    return names;
  }, [entry, entries, page]);
  const query = [...new URLSearchParams(entry.path.split('?')[1] ?? '')];
  const hasPayload = query.length > 0 || entry.requestBody !== null;
  const [tab, setTab] = useState(page ? 'page' : 'headers');
  const description = explain(entry);
  const k = kind(entry);

  return (
    <div role="region" aria-label="Request details" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-px font-mono text-[0.7rem] font-semibold">{entry.method}</span>
          <span className="min-w-0 truncate font-mono font-medium" title={entry.path}>{entry.path}</span>
          <span className={cn('rounded px-1.5 py-px tabular-nums', statusStyle(entry.status))}>{entry.status || 'failed'}</span>
          <span className={cn('rounded px-1.5 py-px', KIND_STYLE[k] ?? 'bg-muted text-muted-foreground')}>{k}</span>
          <span className="ml-auto whitespace-nowrap tabular-nums text-muted-foreground">
            {formatSize(entry.size)} · {Math.round(entry.time)} ms
          </span>
          <Button variant="ghost" size="icon-xs" aria-label="Close request details" onClick={onClose}><X /></Button>
        </div>
        {description && (
          <p className="mt-2 flex gap-2 rounded-md bg-muted/60 px-2.5 py-2 leading-relaxed text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{description}</span>
          </p>
        )}
      </div>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="h-8 shrink-0 px-2">
          {page && <TabsTrigger value="page" className="text-xs">Page</TabsTrigger>}
          <TabsTrigger value="headers" className="text-xs">Headers</TabsTrigger>
          {hasPayload && <TabsTrigger value="payload" className="text-xs">Payload</TabsTrigger>}
          <TabsTrigger value="response" className="text-xs">Response</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-auto border-t p-3 text-xs">
          {page && <TabsContent value="page"><PageView entry={entry} page={page} known={known} /></TabsContent>}
          <TabsContent value="headers" className="grid grid-cols-1 gap-4">
            <HeaderList title="General" headers={{ 'Request URL': `/preview${entry.path}`, 'Request method': entry.method, Status: String(entry.status || 'failed') }} />
            <HeaderList title="Response headers" headers={entry.responseHeaders} />
            <HeaderList title="Request headers" headers={entry.requestHeaders} />
          </TabsContent>
          {hasPayload && (
            <TabsContent value="payload" className="grid grid-cols-1 gap-4">
              {query.length > 0 && <HeaderList title="Query string" headers={query} />}
              {entry.requestBody !== null && (
                <Section title="Request body"><Code text={entry.requestBody} /></Section>
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

function statusStyle(status: number) {
  if (status >= 200 && status < 300) return 'bg-emerald-100 text-emerald-900';
  if (status >= 300 && status < 400) return 'bg-amber-100 text-amber-900';
  return 'bg-red-100 text-red-900';
}

/** The Inertia page object, with its props grouped by where they come from. */
function PageView({ entry, page, known }: { entry: NetworkEntry; page: Record<string, any>; known: Set<string> | null }) {
  const props: Record<string, unknown> = page.props ?? {};
  const shared = new Set<string>(page.sharedProps ?? []);
  const requested = list(header(entry, 'x-inertia-partial-data'));
  const deferred = Object.entries<string[]>(page.deferredProps ?? {}).flatMap(([group, names]) => names.map(name => [name, group]));
  // Props a partial reload left out. After a Clear the history is gone, but
  // the page object still names the shared ones.
  const kept = known ? [...new Set([...known, ...shared])].filter(name => !(name in props)) : [];
  const names = Object.keys(props);
  const groups = [
    { title: 'From the route', hint: 'passed to inertia.render()', names: names.filter(name => !shared.has(name) && name !== 'errors') },
    { title: 'Shared', hint: 'from inertia_share, on every page', names: names.filter(name => shared.has(name)) },
    { title: 'Added by Inertia', hint: 'validation errors, on every response', names: names.filter(name => name === 'errors' && !shared.has(name)) },
  ].filter(group => group.names.length);

  return (
    <div className="grid grid-cols-1 gap-4">
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] overflow-hidden rounded-md border">
        {[['Component', page.component], ['URL', page.url], ['Version', page.version]].map(([label, value]) => (
          <div key={label} className="min-w-0 border-r px-2.5 py-1.5 last:border-r-0">
            <dt className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="truncate font-mono" title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      {groups.map(group => (
        <Section key={group.title} title={group.title} hint={group.hint}>
          <ul aria-label={`${group.title} props`} className="divide-y overflow-hidden rounded-md border">
            {group.names.map(name => (
              <li key={name}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                    <span className="font-mono font-medium">{name}</span>
                    {requested.includes(name) && <Badge title="Named in X-Inertia-Partial-Data">requested</Badge>}
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground"><Preview value={props[name]} /></span>
                  </summary>
                  <Code text={JSON.stringify(props[name])} className="rounded-none border-0 border-t" />
                </details>
              </li>
            ))}
          </ul>
        </Section>
      ))}
      {(deferred.length > 0 || kept.length > 0) && (
        <Section title="Not in this response">
          <ul aria-label="Props not in this response" className="divide-y overflow-hidden rounded-md border border-dashed">
            {deferred.map(([name, group]) => (
              <li key={name} className="flex items-center gap-2 px-2 py-1.5">
                <Hourglass aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-mono font-medium">{name}</span>
                <Badge title={`defer() group "${group}"`}>deferred</Badge>
                <span className="min-w-0 truncate text-muted-foreground">The client asks for it once the page has rendered.</span>
              </li>
            ))}
            {kept.map(name => (
              <li key={name} className="flex items-center gap-2 px-2 py-1.5">
                <History aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-mono font-medium">{name}</span>
                <Badge title="Not requested in this partial reload">kept</Badge>
                <span className="min-w-0 truncate text-muted-foreground">Not requested; the client keeps the value it has.</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1.5 flex items-baseline gap-2">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function Badge({ children, title }: { children: ReactNode; title: string }) {
  return <span title={title} className="shrink-0 rounded bg-muted px-1 text-[0.65rem] text-muted-foreground">{children}</span>;
}

/** A one-line preview of a value, as browser devtools show one. */
function Preview({ value, nested = false }: { value: unknown; nested?: boolean }): ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground/70">{String(value)}</span>;
  if (typeof value === 'string') return <span className="text-emerald-700">"{value}"</span>;
  if (typeof value !== 'object') return <span className="text-sky-700">{String(value)}</span>;
  const comma = (i: number) => (i ? ', ' : '');
  if (Array.isArray(value)) {
    if (nested) return <>[…]</>;
    return (
      <>
        <span className="text-muted-foreground/70">({value.length}) </span>
        [{value.slice(0, 4).map((item, i) => <span key={i}>{comma(i)}<Preview value={item} nested /></span>)}{value.length > 4 && ', …'}]
      </>
    );
  }
  if (nested) return <>{'{…}'}</>;
  const entries = Object.entries(value);
  if (!entries.length) return <>{'{}'}</>;
  return (
    <>
      {'{'}{entries.map(([key, item], i) => (
        <span key={key}>{comma(i)}<span className="text-violet-700">{key}</span>: <Preview value={item} nested /></span>
      ))}{'}'}
    </>
  );
}

/** Name and value pairs; a list keeps a query string's repeated names. */
function HeaderList({ title, headers }: { title: string; headers: Record<string, string> | [string, string][] }) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  return (
    <Section title={title}>
      <dl className="grid grid-cols-[minmax(0,max-content)_1fr] gap-x-4 gap-y-1 rounded-md border px-2.5 py-2 font-mono">
        {entries.map(([name, value], index) => {
          // Inertia's own headers stand out.
          const inertia = /^x-inertia/i.test(name);
          return (
            <div key={index} className="contents">
              <dt className={inertia ? 'text-violet-700' : 'text-muted-foreground'}>{name}</dt>
              <dd className={cn('break-all', inertia && 'text-violet-700')}>{value}</dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}

const JSON_TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Pretty-printed JSON with keys, strings and numbers coloured; other text as it is. */
function Code({ text, className }: { text: string; className?: string }) {
  let pretty: string | null = null;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Not JSON: show it as it is.
  }
  const body: ReactNode[] = [];
  if (pretty !== null) {
    let last = 0;
    for (const match of pretty.matchAll(JSON_TOKEN)) {
      body.push(pretty.slice(last, match.index));
      const [token, string, colon] = match;
      const style = colon ? 'text-violet-700' : string ? 'text-emerald-700' : /^[tfn]/.test(token) ? 'text-muted-foreground' : 'text-sky-700';
      body.push(<span key={match.index} className={style}>{string ?? token}</span>, colon ?? '');
      last = match.index! + token.length;
    }
    body.push(pretty.slice(last));
  }
  return (
    <pre className={cn('overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[0.7rem]/4 whitespace-pre-wrap break-all', className)}>
      {pretty === null ? text : body}
    </pre>
  );
}
