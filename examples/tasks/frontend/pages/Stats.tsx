import { useState } from 'react';
import { Deferred, router } from '@inertiajs/react';
import type { Task } from '../types';

interface Summary { total: number; open: number; done: number; percent_done: number }

export default function Stats({ summary, done_tasks }: { summary?: Summary; done_tasks?: Task[] }) {
  const [loading, setLoading] = useState(false);

  function loadDoneTasks() {
    setLoading(true);
    router.reload({ only: ['done_tasks'], onFinish: () => setLoading(false) });
  }

  return (
    <>
      <h1>Stats</h1>
      {/* summary is deferred: the page shows first, then Inertia fetches it. */}
      <Deferred data="summary" fallback={<p className="loading" role="status">Loading stats…</p>}>
        {() => (
          <dl className="summary">
            <div><dt>Total</dt><dd>{summary!.total}</dd></div>
            <div><dt>Open</dt><dd>{summary!.open}</dd></div>
            <div><dt>Done</dt><dd>{summary!.done}</dd></div>
            <div><dt>Complete</dt><dd>{summary!.percent_done}%</dd></div>
          </dl>
        )}
      </Deferred>

      <h2>Done tasks</h2>
      {/* done_tasks is optional: the server sends it only when asked. */}
      {done_tasks ? (
        <ul className="tasks">
          {done_tasks.map(task => <li key={task.id} className="done"><span>{task.title}</span></li>)}
          {done_tasks.length === 0 && <li className="empty">Nothing done yet.</li>}
        </ul>
      ) : (
        <button onClick={loadDoneTasks} disabled={loading}>Load done tasks</button>
      )}
    </>
  );
}
