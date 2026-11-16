import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInertiaApp, router, usePage } from '@inertiajs/react';
import './app.css';

type Action = 'increment' | 'decrement' | 'reset';

function Counter({ count }: { count: number }) {
  const { url } = usePage();
  const [processing, setProcessing] = useState(false);

  function submit(action: Action) {
    setProcessing(true);
    // Post back to this page; the server redirects to it after the update.
    router.post(url, { action }, {
      onFinish: () => setProcessing(false),
    });
  }

  return (
    <main className="counter">
      <h1>Counter</h1>
      <output aria-label="Counter value">{count}</output>
      <div className="actions">
        <button disabled={processing} onClick={() => submit('decrement')}>−</button>
        <button disabled={processing} onClick={() => submit('increment')}>+</button>
        <button disabled={processing} onClick={() => submit('reset')}>Reset</button>
      </div>
      <p>Real CrossInertia · FastAPI · Pyodide</p>
    </main>
  );
}

createInertiaApp({
  resolve: name => {
    if (name !== 'Counter') throw new Error(`Unknown component: ${name}`);
    return Counter;
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
