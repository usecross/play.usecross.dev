export interface Task {
  id: number;
  title: string;
  done: boolean;
}

/** Props every page gets from shared_props() in app.py. */
export interface SharedProps {
  root_path: string;
  counts: { total: number; open: number; done: number };
  flash: string | null;
  [key: string]: unknown;
}
