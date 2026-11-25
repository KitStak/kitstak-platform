'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Moon, Sun } from 'lucide-react';
import { cn } from '@/components/ui';

type View = 'email' | 'text';
type Scheme = 'light' | 'dark';

const tabClass = (active: boolean) =>
  cn(
    'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    active ? 'bg-selected text-fg' : 'text-fg-secondary hover:bg-hover hover:text-fg',
  );

/**
 * One email, as a mail client would show it and as plain text. The HTML runs in a sandboxed frame
 * with scripts off. The light and dark switch turns the email's own dark mode rules on or off, so
 * both looks can be checked without changing the computer's setting.
 */
const DARK_QUERY = /@media \(prefers-color-scheme: dark\)/g;

function forScheme(html: string, scheme: 'light' | 'dark'): string {
  return html.replace(DARK_QUERY, scheme === 'dark' ? '@media all' : '@media not all');
}

export function EmailPreview({ html, text, code }: { readonly html: string | null; readonly text: string | null; readonly code: string | null }) {
  const [view, setView] = useState<View>(html ? 'email' : 'text');
  const [scheme, setScheme] = useState<Scheme>('light');
  const [height, setHeight] = useState(520);
  const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const shown = useMemo(() => (html ? forScheme(html, scheme) : null), [html, scheme]);

  const fit = useCallback(() => {
    const body = frame.current?.contentDocument?.body;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight + 8, 240), 2400));
  }, []);

  // The frame can finish loading before this component is live, and then `onLoad` never runs here.
  // So the height is also measured after mount, after a look change, and when the window resizes.
  useEffect(() => {
    if (view !== 'email') return;
    fit();
    const soon = setTimeout(fit, 250);
    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(soon);
      window.removeEventListener('resize', fit);
    };
  }, [fit, shown, view]);

  const copyCode = useCallback(async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard can be blocked. The code is on screen to type by hand.
      setCopied(false);
    }
  }, [code]);

  return (
    <div>
      {code ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/25 bg-info-subtle px-4 py-3">
          <div>
            <p className="text-2xs font-semibold tracking-[0.08em] text-info-text uppercase">Your code</p>
            <p data-testid="outbox-code" className="mt-0.5 font-mono text-2xl font-bold tracking-[0.2em] text-fg">
              {code}
            </p>
          </div>
          <button
            type="button"
            onClick={copyCode}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-md border border-border-input bg-panel px-3 text-sm font-medium text-fg',
              'hover:border-border-input-hover hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            <span aria-live="polite">{copied ? 'Copied' : 'Copy code'}</span>
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Email version" className="flex gap-1">
          <button type="button" role="tab" aria-selected={view === 'email'} aria-controls="outbox-panel" disabled={!html} onClick={() => setView('email')} className={cn(tabClass(view === 'email'), 'disabled:opacity-40')}>
            Email
          </button>
          <button type="button" role="tab" aria-selected={view === 'text'} aria-controls="outbox-panel" disabled={!text} onClick={() => setView('text')} className={cn(tabClass(view === 'text'), 'disabled:opacity-40')}>
            Plain text
          </button>
        </div>
        {view === 'email' && html ? (
          <div role="group" aria-label="Mail client look" className="flex gap-1">
            <button type="button" aria-pressed={scheme === 'light'} onClick={() => setScheme('light')} className={tabClass(scheme === 'light')}>
              <Sun aria-hidden className="mr-1.5 size-4" />
              Light
            </button>
            <button type="button" aria-pressed={scheme === 'dark'} onClick={() => setScheme('dark')} className={tabClass(scheme === 'dark')}>
              <Moon aria-hidden className="mr-1.5 size-4" />
              Dark
            </button>
          </div>
        ) : null}
      </div>

      <div id="outbox-panel" role="tabpanel" className="mt-3 overflow-hidden rounded-lg border border-border-default">
        {view === 'email' && html ? (
          <iframe
            ref={frame}
            title="Email as a mail client shows it"
            srcDoc={shown ?? ''}
            // Scripts stay off. Same origin only lets this page measure the height; links open in a new tab.
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            onLoad={fit}
            data-testid="outbox-html"
            className="block w-full bg-panel"
            style={{ height }}
          />
        ) : (
          <pre data-testid="outbox-text" className="max-h-[720px] overflow-auto bg-sunken p-4 font-mono text-sm leading-6 whitespace-pre-wrap text-fg">
            {text ?? 'This email has no stored text.'}
          </pre>
        )}
      </div>
      {/* The text version is always in the page for tools that read it, also while the HTML tab is open. */}
      {view === 'email' && text ? (
        <pre data-testid="outbox-text" className="sr-only">
          {text}
        </pre>
      ) : null}
    </div>
  );
}
