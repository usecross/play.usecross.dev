import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { CircleAlert, Database, FileCode, Folder, Info, LoaderCircle, RotateCw, Undo2 } from 'lucide-react';
import { editableSources } from '@play.usecross.dev/runner/starter-files';
import runtimeVersions from '../../../packages/starters/runtime.json';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  clearData, getState, reloadPreview, resetToStarter, restart, selectFile, start, subscribe, type ShellState,
} from './runtime';

export function App() {
  const state = useSyncExternalStore(subscribe, getState);
  const preview = useRef<HTMLIFrameElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => start({ preview: preview.current!, editor: editor.current! }), []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-medium whitespace-nowrap">CrossInertia Playground</h1>
        <Status status={state.status} ready={state.ready} />
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="About this playground"><Info /></Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-80">
            A FastAPI and CrossInertia app running in your browser with Pyodide. Edits apply when you pause
            typing or press ⌘S/Ctrl+S, and are saved in this browser. Dependencies in pyproject.toml install
            when you restart Python.
          </TooltipContent>
        </Tooltip>
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={220} minSize={180} maxSize={360}>
          <Sidebar state={state} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={300}>
          <section className="flex h-full min-w-0 flex-col" aria-label="Editor">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
              <span className="truncate font-mono">{state.selectedFile}</span>
              {state.editedFiles.includes(state.selectedFile) && <span className="text-muted-foreground">Edited</span>}
              <div className="flex-1" />
              <span className="whitespace-nowrap text-muted-foreground">Saved in this browser</span>
            </div>
            {state.editorFailed && <p className="p-3 text-sm text-muted-foreground">The code view failed to load.</p>}
            {/* CodeMirror owns this element's children. */}
            <div ref={editor} id="editor" className="min-h-0 flex-1" />
            <ErrorPanel error={state.error} />
            {state.starterChanged && (
              <p id="starter-changed" role="status" className="shrink-0 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                The starter has changed since you edited it. Reset to starter to get the new version.
              </p>
            )}
          </section>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="40%" minSize={300}>
          <section className="flex h-full min-w-0 flex-col" aria-label="Preview">
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Reload preview" disabled={!state.ready} onClick={reloadPreview}>
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reload preview</TooltipContent>
              </Tooltip>
              <div className="flex h-6 min-w-0 flex-1 items-center rounded-md bg-muted px-2 font-mono text-xs text-muted-foreground">
                <span className="truncate">{state.previewPath || ' '}</span>
              </div>
            </div>
            <div className="relative min-h-0 flex-1 bg-muted/40">
              <iframe ref={preview} id="preview" src="about:blank" title="App preview" className="size-full border-0" />
              {!state.ready && <Starting status={state.status} />}
            </div>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function tone(status: string, ready: boolean) {
  if (/^(Failed|Not applied|The preview has an error)/.test(status)) return 'error';
  if (status.endsWith('...') || !ready) return 'busy';
  return 'ok';
}

function Status({ status, ready }: { status: string; ready: boolean }) {
  const kind = tone(status, ready);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
      {kind === 'busy'
        ? <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
        : <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', kind === 'ok' ? 'bg-emerald-500' : 'bg-red-500')} />}
      <span id="status" role="status" className="truncate" title={status}>{status}</span>
    </span>
  );
}

function Starting({ status }: { status: string }) {
  const failed = status.startsWith('Failed');
  return (
    <div aria-hidden className="absolute inset-0 grid place-items-center bg-background p-6">
      <div className={cn('flex max-w-sm items-start gap-2 text-sm', failed ? 'text-destructive' : 'text-muted-foreground')}>
        {failed ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" />}
        <span>{status}</span>
      </div>
    </div>
  );
}

function ErrorPanel({ error }: { error: ShellState['error'] }) {
  const panel = useRef<HTMLPreElement>(null);
  // The error message is last in a traceback.
  useEffect(() => { if (panel.current) panel.current.scrollTop = panel.current.scrollHeight; }, [error]);
  if (!error) return null;
  return (
    <pre
      ref={panel}
      id="apply-error"
      role="alert"
      className="max-h-[40%] shrink-0 overflow-auto border-t-2 border-destructive bg-destructive/5 px-3 py-2 font-mono text-xs/5 whitespace-pre-wrap text-destructive"
    >
      {error.message}
    </pre>
  );
}

interface TreeFolder { name: string; path: string; folders: TreeFolder[]; files: string[] }

/** The editable files as a tree: in each folder, folders first, then files, as editors show them. */
function fileTree(paths: string[]): TreeFolder {
  const root: TreeFolder = { name: '', path: '', folders: [], files: [] };
  for (const path of paths) {
    let folder = root;
    for (const name of path.split('/').slice(0, -1)) {
      let child = folder.folders.find(child => child.name === name);
      if (!child) folder.folders.push(child = { name, path: `${folder.path}${name}/`, folders: [], files: [] });
      folder = child;
    }
    folder.files.push(path);
  }
  const sort = (folder: TreeFolder) => {
    folder.folders.sort((a, b) => a.name.localeCompare(b.name)).forEach(sort);
    folder.files.sort();
  };
  sort(root);
  return root;
}
const tree = fileTree(editableSources);
/** Left padding for an entry this many folders deep. */
const indent = (depth: number) => ({ paddingLeft: `${0.5 + depth}rem` });

function Sidebar({ state }: { state: ShellState }) {
  const file = (path: string, depth: number) => (
    <li key={path}>
      <button
        type="button"
        aria-label={path}
        aria-current={state.selectedFile === path}
        onClick={() => selectFile(path)}
        style={indent(depth)}
        className={cn(
          'flex h-7 w-full items-center gap-2 rounded-md pr-2 text-left font-mono text-xs text-sidebar-foreground/70 outline-none',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
          'aria-[current=true]:bg-sidebar-accent aria-[current=true]:text-sidebar-accent-foreground',
        )}
      >
        <FileCode aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{path.split('/').pop()}</span>
        {state.editedFiles.includes(path) && (
          <span title="Edited" aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-sky-500" />
        )}
      </button>
    </li>
  );
  const entries = (folder: TreeFolder, depth: number): ReactNode[] => [
    ...folder.folders.map(child => (
      <li key={child.path}>
        <div style={indent(depth)} className="flex h-7 items-center gap-2 pr-2 font-mono text-xs text-muted-foreground">
          <Folder aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{child.name}</span>
        </div>
        <ul className="grid gap-0.5">{entries(child, depth + 1)}</ul>
      </li>
    )),
    ...folder.files.map(path => file(path, depth)),
  ];
  return (
    <aside className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <nav aria-label="Files" className="min-h-0 flex-1 overflow-auto p-2">
        <h2 className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">Files</h2>
        <ul className="grid gap-0.5">{entries(tree, 0)}</ul>
      </nav>
      <div className="grid shrink-0 gap-1.5 border-t p-3">
        <h2 className="text-xs font-medium text-muted-foreground">Python</h2>
        {state.depsChanged && (
          <p id="deps-changed" role="status" className="text-xs text-amber-800">
            Dependency changes install when Python restarts. The app's data is kept.
          </p>
        )}
        <Button
          size="sm"
          variant={state.depsChanged ? 'default' : 'outline'}
          disabled={!state.ready || state.restarting}
          onClick={restart}
          className="justify-start"
        >
          {state.restarting ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RotateCw />}Restart Python
        </Button>
        <Confirm
          label={<><Database />Clear data</>}
          title="Clear the app's data?"
          description="This deletes the app's database, so the count goes back to 0. Your code edits are kept."
          action="Delete data"
          disabled={!state.ready}
          onConfirm={clearData}
        />
        <Confirm
          label={<><Undo2 />Reset to starter</>}
          title="Reset to the starter?"
          description="This discards your edits to every file and restores the starter's code. The app's data is kept."
          action="Discard edits"
          // A reset decides whether to restart from the dependencies Python
          // runs, which a restart in progress is about to change.
          disabled={!state.ready || state.restarting}
          onConfirm={resetToStarter}
        />
        <p className="pt-1 text-[11px] text-muted-foreground">Pyodide {runtimeVersions.pyodideVersion}</p>
      </div>
    </aside>
  );
}

function Confirm(props: {
  label: ReactNode; title: string; description: string; action: string; disabled: boolean; onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={props.disabled} className="justify-start">{props.label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={props.onConfirm}>{props.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
