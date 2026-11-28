'use client';
/**
 * Last line of defense: an error in the root layout itself. Renders its own <html> because the
 * root layout did not. Inline styles only, since the stylesheet may be what failed to load.
 */
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    console.error('[crew] root error', error);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f1e9', color: '#0A1628', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 20px', color: '#4a5263' }}>KitStak Crew hit a problem loading this page. Your data is safe. Try again, and if it keeps happening let us know.</p>
          <button type="button" onClick={reset} style={{ height: 40, padding: '0 16px', borderRadius: 8, border: 0, background: '#C8102E', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
