import { LogoMark } from '@/features/shell/logo';

/**
 * Brand showcase for the auth pages: a stylized pipeline preview in the same visual
 * language as the portal's launcher preview (glass card, brand-red accents, muted
 * skeleton bars) so the suite's front doors read as one product family.
 */

const ROWS = [
  { name: 'w-40', stage: 'Negotiation', won: false },
  { name: 'w-32', stage: 'Proposal', won: false },
  { name: 'w-44', stage: 'Won', won: true },
  { name: 'w-28', stage: 'Discovery', won: false },
] as const;

const FORECAST = ['h-7', 'h-11', 'h-9', 'h-14', 'h-12'] as const;

export function AuthIllustration() {
  return (
    <div className="relative mx-auto w-full max-w-[460px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
      <div className="flex items-center justify-between">
        <LogoMark size={26} />
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-1.5 rounded-full bg-white/25" />
          <span className="size-1.5 rounded-full bg-white/25" />
          <span className="size-1.5 rounded-full bg-white/40" />
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex rounded-md bg-[var(--brand-red)] px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] text-white">
            PIPELINE
          </span>
          <p className="mt-3 text-sm font-semibold text-white">Q4 Deals</p>
          <p className="mt-0.5 text-xs text-white/60">Forecast, stages & owners</p>
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border border-white/12 bg-white/[0.06] px-3 pt-3 pb-2">
          {FORECAST.map((h, i) => (
            <span
              key={i}
              className={`${h} w-2.5 rounded-sm ${i === 3 ? 'bg-[var(--brand-red)]' : 'bg-white/25'}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {ROWS.map((row) => (
          <div
            key={row.stage}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
          >
            <span className="size-5 shrink-0 rounded-full bg-white/15" />
            <span className={`h-2 ${row.name} rounded-full bg-white/20`} />
            <span
              className={`ml-auto inline-flex rounded-md px-2 py-0.5 text-2xs font-semibold ${
                row.won ? 'bg-[var(--brand-red)] text-white' : 'bg-white/10 text-white/70'
              }`}
            >
              {row.stage}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-xs text-white/70">Automations on — next steps never slip</span>
      </div>
    </div>
  );
}
