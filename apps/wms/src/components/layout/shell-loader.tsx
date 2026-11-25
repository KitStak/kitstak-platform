import { SETUP_LOADERS, SETUP_MESSAGES } from '@/lib/warehouse-setup-loader-model';

/** Seconds each app loader and each warehouse chore stays on screen. */
const SLOT_S = 4;
/** Wait before the loader fades in, so a quick open never flashes it. */
const APPEAR_AFTER_S = 0.8;

/**
 * Keyframes for one item of a list of `count` that take turns: visible for its own 1/count of
 * the cycle (with a short fade and lift in and out), hidden the rest of the time.
 */
function turnKeyframes(name: string, count: number, enter: string, exit: string): string {
  const share = 100 / count;
  const pct = (n: number) => `${n.toFixed(3)}%`;
  return `@keyframes ${name} {
  0% { opacity: 0; transform: ${enter}; }
  ${pct(share * 0.12)} { opacity: 1; transform: none; }
  ${pct(share * 0.88)} { opacity: 1; transform: none; }
  ${pct(share)} { opacity: 0; transform: ${exit}; }
  100% { opacity: 0; transform: ${exit}; }
}`;
}

const CSS = `
${turnKeyframes('ks-shell-icon', SETUP_LOADERS.length, 'scale(.75)', 'scale(.75)')}
${turnKeyframes('ks-shell-msg', SETUP_MESSAGES.length, 'translateY(6px)', 'translateY(-6px)')}
@keyframes ks-shell-appear { from { opacity: 0; } to { opacity: 1; } }
@keyframes ks-shell-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
.ks-shell-loader { animation: ks-shell-appear .4s ease ${APPEAR_AFTER_S}s both; }
.ks-shell-icon { opacity: 0; animation: ks-shell-icon ${SETUP_LOADERS.length * SLOT_S}s linear infinite both; }
.ks-shell-msg { opacity: 0; animation: ks-shell-msg ${SETUP_MESSAGES.length * SLOT_S}s linear infinite both; }
.ks-shell-bar { animation: ks-shell-bar 1.6s cubic-bezier(.65,0,.35,1) infinite; }
@media (prefers-reduced-motion: reduce) {
  .ks-shell-loader { animation: none; }
  .ks-shell-icon, .ks-shell-msg { animation: none; opacity: 0; }
  .ks-shell-icon:first-child, .ks-shell-msg:first-child { opacity: 1; }
  .ks-shell-bar { animation: none; width: 100%; opacity: .35; }
}
`;

/**
 * "Opening your warehouse": what the app shell shows while it streams in (a cold or slow open,
 * a newly set up warehouse). Every KitStak app loader and a warehouse chore take turns, in CSS
 * only, so it animates before (or without) the page's JavaScript. It fades in after a moment;
 * a quick open shows nothing but the header bar.
 */
export function ShellLoader() {
  return (
    <div
      className="ks-shell-loader flex min-h-[60vh] flex-col items-center justify-center px-6 text-center"
      role="status"
      aria-label="Opening your warehouse"
      data-testid="shell-loader"
    >
      <style href="ks-shell-loader" precedence="default">
        {CSS}
      </style>
      <div className="relative size-32" aria-hidden>
        {SETUP_LOADERS.map((loader, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- animated SVG must stay an <img> to keep its animation
          <img
            key={loader.key}
            src={loader.src}
            width={128}
            height={128}
            alt=""
            className="ks-shell-icon absolute inset-0 size-32"
            style={{ animationDelay: `${APPEAR_AFTER_S + i * SLOT_S}s` }}
          />
        ))}
      </div>
      <p className="mt-6 text-xl font-semibold tracking-tight">Opening your warehouse</p>
      <div className="relative mt-4 h-6 w-full max-w-md" aria-hidden>
        {SETUP_MESSAGES.map((message, i) => (
          <span
            key={message}
            className="ks-shell-msg absolute inset-x-0 text-base text-fg-secondary"
            style={{ animationDelay: `${APPEAR_AFTER_S + i * SLOT_S}s` }}
          >
            {message}
          </span>
        ))}
      </div>
      <div className="mt-6 h-1 w-56 overflow-hidden rounded-full bg-skeleton" aria-hidden>
        <div className="ks-shell-bar h-full w-2/5 rounded-full bg-primary" />
      </div>
    </div>
  );
}
