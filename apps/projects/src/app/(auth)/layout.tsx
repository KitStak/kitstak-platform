import Link from 'next/link';
import { Logo, ProjectsMark } from '@/features/shell/logo';
import { appUrls } from '@/server/env';

/** Brand showcase: a stylized board preview (what Projects feels like). */
function BoardPreview() {
  const columns = [
    { name: 'To do', cards: ['Book the venue', 'Write the launch brief'] },
    { name: 'In progress', cards: ['Load products and barcodes'] },
    { name: 'Done', cards: ['Kickoff call', 'Welcome email'] },
  ];
  return (
    <div className="relative w-full max-w-[480px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
      <div className="flex items-center justify-between">
        <ProjectsMark size={28} />
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-2xs font-semibold tracking-[0.1em] text-white/80">OPS</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {columns.map((column) => (
          <div key={column.name} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
            <p className="text-2xs font-semibold tracking-[0.06em] text-white/60 uppercase">{column.name}</p>
            <div className="mt-2 flex flex-col gap-2">
              {column.cards.map((card) => (
                <div key={card} className="rounded-lg border border-white/12 bg-white/[0.07] px-2.5 py-2 text-xs text-white">
                  {card}
                  <div className="mt-2 h-1 w-10 rounded-full bg-[var(--brand-red)]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-xs text-white/70">Linked to your CRM deals and warehouse orders</span>
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
          <Link href="/login" aria-label="KitStak Projects" className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
            <Logo size={30} />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-in">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span className="flex items-center gap-4">
            <span className="hidden sm:inline">One account for every KitStak app</span>
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
        <BoardPreview />
        <div className="relative max-w-md text-center text-white">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">Plan it. Track it. Ship it.</p>
          <p className="mt-3 text-md text-white/80">Boards, lists, timelines and goals your whole team understands at a glance.</p>
        </div>
      </aside>
    </div>
  );
}
