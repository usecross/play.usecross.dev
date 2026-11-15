/**
 * Code view of the starter's files. Editable files become writable once the
 * shell calls setEditable(true), after Python is ready. Loaded lazily by
 * main.ts so CodeMirror never delays the Python runtime.
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
  const tabs = document.createElement('div');
  tabs.className = 'file-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Starter files');

  const panel = document.createElement('div');
  panel.className = 'code';
  panel.id = 'code-panel';
  panel.setAttribute('role', 'tabpanel');

  let enabled = false;
  const access = new Compartment();
  const readOnly = (path: string) => EditorState.readOnly.of(!(enabled && options.editable.includes(path)));

  // One state per file keeps each file's scroll position, selection and history.
  const states = new Map(Object.entries(files).map(([path, doc]) => [path, EditorState.create({
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
  })]));
  const [first] = states.keys();
  const view = new EditorView({ state: states.get(first)!, parent: panel });
  let current = first;

  const buttons = [...states.keys()].map(path => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = path;
    if (!options.editable.includes(path)) button.title = 'Read-only for now';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => select(path));
    tabs.append(button);
    return button;
  });

  function select(path: string) {
    states.set(current, view.state);
    current = path;
    view.setState(states.get(path)!);
    view.dispatch({ effects: access.reconfigure(readOnly(path)) });
    buttons.forEach(button => {
      const selected = button.textContent === path;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected) button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    panel.setAttribute('aria-label', path);
  }

  // Arrow keys move between tabs, as in the WAI-ARIA tabs pattern.
  tabs.addEventListener('keydown', event => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = buttons[(index + step + buttons.length) % buttons.length];
    select(next.textContent!);
    next.focus();
  });

  select(first);
  container.replaceChildren(tabs, panel);

  return {
    setEditable(value: boolean) {
      enabled = value;
      view.dispatch({ effects: access.reconfigure(readOnly(current)) });
    },
  };
}
