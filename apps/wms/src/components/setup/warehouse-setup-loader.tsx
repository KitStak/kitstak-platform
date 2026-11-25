'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  indexAt,
  SETUP_LOADERS,
  SETUP_MESSAGES,
  SETUP_SLOW_MS,
  SETUP_STEP_MS,
  shuffled,
} from '@/lib/warehouse-setup-loader-model';

/** Message fade, the indeterminate bar, and their reduced-motion fallbacks. */
const CSS = `
@keyframes ks-setup-msg { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes ks-setup-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
.ks-setup-msg { animation: ks-setup-msg 450ms cubic-bezier(.22,1,.36,1) both; }
.ks-setup-bar { animation: ks-setup-bar 1.6s cubic-bezier(.65,0,.35,1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .ks-setup-msg { animation: none; }
  .ks-setup-bar { animation: none; transform: none; width: 100%; opacity: .35; }
}
`;

export interface WarehouseSetupLoaderProps {
  /** The warehouse being created, shown under the title. */
  readonly warehouseName?: string;
  /** `building` while the warehouse is created, `opening` while its first page loads. */
  readonly stage?: 'building' | 'opening';
}

/**
 * Full-screen "Setting up your warehouse" screen: cycles through every KitStak app loader
 * and a shuffled list of warehouse chores while the new warehouse is provisioned.
 */
export function WarehouseSetupLoader({ warehouseName, stage = 'building' }: WarehouseSetupLoaderProps) {
  // Server and first client render agree on the fixed order (no hydration mismatch). The
  // opener is always shown first; from the first step on, the rest plays in a shuffled order.
  const [{ tick, messages }, setStep] = React.useState<{ tick: number; messages: readonly string[] }>({
    tick: 0,
    messages: SETUP_MESSAGES,
  });
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    const [opener = '', ...rest] = SETUP_MESSAGES;
    const order = [opener, ...shuffled(rest)];
    const step = window.setInterval(() => setStep((s) => ({ tick: s.tick + 1, messages: order })), SETUP_STEP_MS);
    const late = window.setTimeout(() => setSlow(true), SETUP_SLOW_MS);
    return () => {
      window.clearInterval(step);
      window.clearTimeout(late);
    };
  }, []);

  const loaderIndex = indexAt(SETUP_LOADERS.length, tick);
  const message = messages[indexAt(messages.length, tick)] ?? '';
  const title = stage === 'opening' ? 'Opening your warehouse' : 'Setting up your warehouse';

  // Portalled to <body> so the page behind it can be made `inert` while it shows.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ks-setup-title"
      aria-describedby="ks-setup-note"
      aria-busy="true"
      data-testid="warehouse-setup-loader"
    >
      <style href="ks-setup-loader" precedence="default">
        {CSS}
      </style>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--primary-subtle),transparent_65%)] opacity-60"
      />
      <div className="relative flex w-full max-w-md flex-col items-center text-center">
        <div className="relative size-36" aria-hidden>
          {SETUP_LOADERS.map((loader, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay an <img> to keep its animation
            <img
              key={loader.key}
              src={loader.src}
              width={144}
              height={144}
              alt=""
              className={`absolute inset-0 size-36 transition-all duration-700 ease-out ${
                i === loaderIndex ? 'scale-100 opacity-100' : 'scale-75 opacity-0'
              }`}
            />
          ))}
        </div>

        <h2 id="ks-setup-title" className="mt-6 text-2xl font-semibold tracking-tight">
          {title}
        </h2>
        {warehouseName ? <p className="mt-1 text-sm text-fg-secondary">{warehouseName}</p> : null}

        {/* Not a live region: a new chore every few seconds would be noisy for screen readers. */}
        <p className="mt-6 min-h-6 text-base text-fg-secondary">
          <span key={tick} className="ks-setup-msg inline-block">
            {message}
          </span>
        </p>

        <div className="mt-6 h-1 w-56 overflow-hidden rounded-full bg-skeleton" aria-hidden>
          <div className="ks-setup-bar h-full w-2/5 rounded-full bg-primary" />
        </div>

        <div className="mt-4 flex gap-1.5" aria-hidden>
          {SETUP_LOADERS.map((loader, i) => (
            <span
              key={loader.key}
              className={`h-1.5 rounded-full transition-all duration-500 ${
                i === loaderIndex ? 'w-4 bg-primary' : 'w-1.5 bg-skeleton'
              }`}
            />
          ))}
        </div>

        <p id="ks-setup-note" className="mt-8 text-xs text-fg-muted" role="status" aria-live="polite">
          {slow
            ? 'Still working. A brand-new warehouse can take a little longer the first time.'
            : 'This usually takes under a minute. Please keep this tab open.'}
        </p>
      </div>
    </div>,
    document.body,
  );
}
