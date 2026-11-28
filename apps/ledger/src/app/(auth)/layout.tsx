import Link from 'next/link';
import { LedgerMark, Logo } from '@/features/shell/logo';
import { appUrls } from '@/server/env';

/** Brand showcase: a stylized money card (what Ledger feels like). Sample numbers, decorative only. */
function LedgerPreview() {
  const rows = [
    { label: 'Money owed to you', value: '$84,210.00', width: '100%', tone: 'bg-white/80' },
    { label: 'Past due', value: '$21,400.00', width: '25%', tone: 'bg-[var(--brand-red)]' },
  ];
  const tiles = [
    { label: 'Bills due this week', value: '$6,200' },
    { label: 'Invoices sent', value: '42' },
    { label: 'Lines to match', value: '3' },
  ];
  return (
    <div className="relative w-full max-w-[480px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <LedgerMark size={28} />
          <span className="text-sm font-semibold text-white">INV-1042 · Harbor Roast</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-0.5 text-2xs font-semibold tracking-[0.06em] text-white/85">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          PART PAID
        </span>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-white/60">{row.label}</span>
              <span className="font-semibold text-white tabular-nums">{row.value}</span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-white/10">
              <div className={`h-full rounded-full ${row.tone}`} style={{ width: row.width }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <p className="text-lg font-semibold text-white tabular-nums">{tile.value}</p>
            <p className="mt-0.5 text-2xs leading-tight text-white/60">{tile.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-xs text-white/70">Works on its own, or with your warehouse, Pulse and QuickBooks</span>
      </div>
    </div>
  );
}

export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  const urls = appUrls();
  return (
    <div className="grid min-h-dvh bg-panel lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <header>
          <Link href="/login" aria-label="KitStak Ledger" className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
            <Logo size={30} />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-in">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span className="flex items-center gap-4">
            <a className="hover:text-fg hover:underline" href={`${urls.crm}/privacy`}>
              Privacy
            </a>
            <a className="hover:text-fg hover:underline" href={`${urls.crm}/terms`}>
              Terms
            </a>
          </span>
        </footer>
      </div>
      <aside aria-hidden className="auth-hero relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12">
        <LedgerPreview />
        <div className="relative max-w-md text-center text-white">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">Bill it. Pay it. Close it.</p>
        </div>
      </aside>
    </div>
  );
}
