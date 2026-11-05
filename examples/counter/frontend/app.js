// Fixed starter: browser-native ESM. Dynamic TSX bundling comes later.
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInertiaApp, router } from '@inertiajs/react';

function Counter({ count }) {
  const [processing, setProcessing] = useState(false);

  function submit(action) {
    setProcessing(true);
    router.post('/preview/counter', { action }, {
      onFinish: () => setProcessing(false),
    });
  }

  return h('main', { className: 'counter' },
    h('h1', null, 'Counter'),
    h('output', { 'aria-label': 'Counter value' }, count),
    h('div', { className: 'actions' },
      h('button', { disabled: processing, onClick: () => submit('decrement') }, '−'),
      h('button', { disabled: processing, onClick: () => submit('increment') }, '+'),
      h('button', { disabled: processing, onClick: () => submit('reset') }, 'Reset'),
    ),
    h('p', null, 'Real CrossInertia · FastAPI · Pyodide'),
  );
}

createInertiaApp({
  resolve: name => {
    if (name !== 'Counter') throw new Error(`Unknown component: ${name}`);
    return Counter;
  },
  setup({ el, App, props }) {
    createRoot(el).render(h(App, props));
  },
});
