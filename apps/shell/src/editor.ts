/**
 * Code view of the starter's files. Editable files become writable once the
 * shell calls setEditable(true), after Python is ready. Loaded lazily by
 * runtime.ts so CodeMirror never delays the Python runtime.
 */
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { toml } from '@codemirror/legacy-modes/mode/toml';

function language(path: string): Extension {
  if (path.endsWith('.py')) return python();
  if (path.endsWith('.html')) return html();
  if (path.endsWith('.css')) return css();
  if (path.endsWith('.toml')) return StreamLanguage.define(toml);
  return javascript({ jsx: true, typescript: path.endsWith('.ts') || path.endsWith('.tsx') });
}

export interface EditorOptions {
  /** Paths that can be edited once setEditable(true) is called. */
  editable: string[];
  /** Called with a file's full contents after each edit. */
  onChange: (path: string, content: string) => void;
  /** Called on Cmd/Ctrl+S. */
  onSave: () => void;
}

export function mountEditor(container: HTMLElement, files: Record<string, string>, options: EditorOptions) {
  let enabled = false;
  const access = new Compartment();
  const readOnly = (path: string) => EditorState.readOnly.of(!(enabled && options.editable.includes(path)));

  // One state per file keeps each file's scroll position, selection and history.
  const createState = (path: string, doc: string) => EditorState.create({
    doc,
    extensions: [
      keymap.of([{ key: 'Mod-s', run: () => { options.onSave(); return true; } }]),
      basicSetup,
      language(path),
      access.of(readOnly(path)),
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged) options.onChange(path, update.state.doc.toString());
      }),
    ],
  });
  const states = new Map(Object.entries(files).map(([path, doc]) => [path, createState(path, doc)]));
  let current = states.keys().next().value!;
  const view = new EditorView({ state: states.get(current)!, parent: container });

  return {
    /** Show a file; the shell's sidebar picks it. */
    show(path: string) {
      if (path === current) return;
      states.set(current, view.state);
      current = path;
      view.setState(states.get(path)!);
      view.dispatch({ effects: access.reconfigure(readOnly(path)) });
    },
    /** Replace files' contents, such as saved edits or the starter's, without reporting them as edits. */
    setFiles(contents: Record<string, string>) {
      for (const [path, doc] of Object.entries(contents)) states.set(path, createState(path, doc));
      view.setState(states.get(current)!);
      view.dispatch({ effects: access.reconfigure(readOnly(current)) });
    },
    setEditable(value: boolean) {
      enabled = value;
      view.dispatch({ effects: access.reconfigure(readOnly(current)) });
    },
  };
}
