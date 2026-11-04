/**
 * Counter App - React + Inertia frontend
 * 
 * Phase 0: Inline in app.html for simplicity
 * Phase 1+: Compiled by esbuild-wasm from this TSX source
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { createInertiaApp } from '@inertiajs/react';
import Counter from './pages/Counter';

const pages = {
  Counter,
};

createInertiaApp({
  resolve: (name) => {
    const page = pages[name as keyof typeof pages];
    if (!page) {
      throw new Error(`Page component "${name}" not found`);
    }
    return page;
  },
  setup({ el, App, props }) {
    createRoot(el).render(<App {...props} />);
  },
});
