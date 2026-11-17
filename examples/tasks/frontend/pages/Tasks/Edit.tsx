import type { FormEvent } from 'react';
import { Link, router, useForm } from '@inertiajs/react';
import { useUrl } from '../../lib/url';
import type { Task } from '../../types';

export default function Edit({ task }: { task: Task }) {
  const url = useUrl();
  const form = useForm({ title: task.title, done: task.done });

  function save(event: FormEvent) {
    event.preventDefault();
    form.put(url(`/tasks/${task.id}`));
  }

  return (
    <>
      <h1>Edit task</h1>
      <form onSubmit={save} className="edit-task">
        <label>
          Title
          <input
            value={form.data.title}
            onChange={event => {
              form.setData('title', event.target.value);
              form.clearErrors('title');
            }}
            aria-required="true"
            aria-invalid={!!form.errors.title}
            aria-describedby="title-error"
          />
        </label>
        {form.errors.title && <p id="title-error" className="error">{form.errors.title}</p>}
        <label className="inline">
          <input type="checkbox" checked={form.data.done} onChange={event => form.setData('done', event.target.checked)} />
          Done
        </label>
        <div className="actions">
          <button disabled={form.processing}>Save</button>
          <Link href={url('/tasks')}>Cancel</Link>
          <button type="button" className="danger" onClick={() => router.delete(url(`/tasks/${task.id}`))}>Delete</button>
        </div>
      </form>
    </>
  );
}
