import type { FormEvent } from 'react';
import { Link, router, useForm } from '@inertiajs/react';
import { useUrl } from '../../lib/url';
import type { Task } from '../../types';

const FILTERS = { all: 'All', open: 'Open', done: 'Done' };
const HEADINGS = { all: 'All tasks', open: 'Open tasks', done: 'Done tasks' };

export default function Index({ tasks, filter }: { tasks: Task[]; filter: keyof typeof FILTERS }) {
  const url = useUrl();
  const form = useForm({ title: '' });

  function add(event: FormEvent) {
    event.preventDefault();
    form.post(url('/tasks'), { preserveScroll: true, onSuccess: () => form.reset() });
  }

  return (
    <>
      <h1>{HEADINGS[filter]}</h1>
      <form onSubmit={add} className="new-task">
        <input
          aria-label="New task"
          placeholder="What needs doing?"
          value={form.data.title}
          onChange={event => {
            form.setData('title', event.target.value);
            form.clearErrors('title');
          }}
          aria-required="true"
          aria-invalid={!!form.errors.title}
          aria-describedby="title-error"
        />
        <button disabled={form.processing}>Add</button>
        {form.errors.title && <p id="title-error" className="error">{form.errors.title}</p>}
      </form>

      <nav aria-label="Filter" className="filters">
        {Object.entries(FILTERS).map(([value, label]) => (
          // A partial reload: the server sends only these props.
          <Link key={value} href={url(`/tasks?filter=${value}`)} only={['tasks', 'filter']}
            preserveState preserveScroll aria-current={filter === value ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>

      <ul className="tasks">
        {tasks.map(task => (
          <li key={task.id} className={task.done ? 'done' : undefined}>
            <label>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => router.post(url(`/tasks/${task.id}/toggle`), {}, { preserveScroll: true })}
              />
              <span>{task.title}</span>
            </label>
            <Link href={url(`/tasks/${task.id}/edit`)} aria-label={`Edit ${task.title}`}>Edit</Link>
          </li>
        ))}
        {tasks.length === 0 && <li className="empty">Nothing here.</li>}
      </ul>
    </>
  );
}
