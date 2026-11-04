/**
 * Counter Page Component
 * 
 * Demonstrates Inertia form POST with FastAPI backend
 * Phase 0: Inlined in template; this TSX is the source
 * Phase 1+: Compiled and loaded dynamically
 */

import React from 'react';
import { useForm } from '@inertiajs/react';

interface CounterProps {
  count: number;
}

export default function Counter({ count }: CounterProps) {
  const incrementForm = useForm({
    action: 'increment',
  });

  const decrementForm = useForm({
    action: 'decrement',
  });

  const resetForm = useForm({
    action: 'reset',
  });

  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      padding: '3rem',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      textAlign: 'center',
    }}>
      <h1 style={{
        fontSize: '2.5rem',
        marginBottom: '1rem',
        color: '#1a1a1a',
      }}>
        Counter
      </h1>

      <div style={{
        fontSize: '4rem',
        fontWeight: 'bold',
        color: '#667eea',
        margin: '2rem 0',
      }}>
        {count}
      </div>

      <div style={{
        display: 'flex',
        gap: '1rem',
        justifyContent: 'center',
        marginTop: '2rem',
      }}>
        <form onSubmit={(e) => {
          e.preventDefault();
          decrementForm.post('/counter');
        }}>
          <button
            type="submit"
            disabled={decrementForm.processing}
            style={{
              padding: '1rem 2rem',
              fontSize: '1.25rem',
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              opacity: decrementForm.processing ? 0.6 : 1,
            }}
          >
            −
          </button>
        </form>

        <form onSubmit={(e) => {
          e.preventDefault();
          incrementForm.post('/counter');
        }}>
          <button
            type="submit"
            disabled={incrementForm.processing}
            style={{
              padding: '1rem 2rem',
              fontSize: '1.25rem',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              opacity: incrementForm.processing ? 0.6 : 1,
            }}
          >
            +
          </button>
        </form>

        <form onSubmit={(e) => {
          e.preventDefault();
          resetForm.post('/counter');
        }}>
          <button
            type="submit"
            disabled={resetForm.processing}
            style={{
              padding: '1rem 2rem',
              fontSize: '1rem',
              background: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              opacity: resetForm.processing ? 0.6 : 1,
            }}
          >
            Reset
          </button>
        </form>
      </div>

      <p style={{
        marginTop: '2rem',
        color: '#666',
        fontSize: '0.875rem',
      }}>
        Phase 0: Full Inertia POST → 303 → render cycle via Pyodide
      </p>
    </div>
  );
}
