import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createInertiaApp } from '@inertiajs/react';
import Layout from './components/Layout';
import Stats from './pages/Stats';
import TasksEdit from './pages/Tasks/Edit';
import TasksIndex from './pages/Tasks/Index';
import './app.css';

// The pages app.py renders, by name. Vite apps often use import.meta.glob;
// the playground's bundler doesn't support it, so they are listed here.
const pages: Record<string, ComponentType<any>> = {
  'Tasks/Index': TasksIndex,
  'Tasks/Edit': TasksEdit,
  Stats,
};

createInertiaApp({
  resolve: name => {
    if (!(name in pages)) throw new Error(`Unknown page: ${name}`);
    return pages[name];
  },
  // Every page renders inside the same layout, which stays mounted.
  layout: () => Layout,
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
