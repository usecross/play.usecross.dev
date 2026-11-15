/**
 * Read-only code view of the starter's files. Loaded lazily by main.ts so
 * CodeMirror never delays the Python runtime.
 */
import { basicSetup } from 'codemirror';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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

export function mountEditor(container: HTMLElement, files: Record<string, string>) {
  const tabs = document.createElement('div');
  tabs.className = 'file-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Starter files');

  const panel = document.createElement('div');
  panel.className = 'code';
  panel.id = 'code-panel';
  panel.setAttribute('role', 'tabpanel');

  // One state per file keeps each file's scroll position and selection.
  const states = new Map(Object.entries(files).map(([path, doc]) => [path, EditorState.create({
    doc,
    extensions: [basicSetup, language(path), EditorState.readOnly.of(true), EditorView.lineWrapping],
  })]));
  const [first] = states.keys();
  const view = new EditorView({ state: states.get(first)!, parent: panel });
  let current = first;

  const buttons = [...states.keys()].map(path => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = path;
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
}
