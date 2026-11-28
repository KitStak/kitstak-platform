import Link from 'next/link';
import { CrewMark, Logo } from '@/features/shell/logo';
import { appUrls } from '@/server/env';

/** Brand showcase: a stylized today board (what Crew feels like). Sample people, decorative only. */
function CrewPreview() {
  const rows = [
    { name: 'Maria L.', detail: 'Kitting line 2 since 6:58 AM', state: 'On site', tone: 'bg-emerald-400' },
    { name: 'Dev P.', detail: 'Scheduled 7:00 AM, 9 minutes late', state: 'Late', tone: 'bg-amber-400' },
    { name: 'Ana R.', detail: 'Meal break since 11:30 AM', state: 'On break', tone: 'bg-sky-400' },
  ];
  const tiles = [
    { label: 'On site now', value: '41' },
    { label: 'Needs a fix', value: '2' },
    { label: 'Tuesday', value: '3 short' },
  ];
  return (
    <div className="relative w-full max-w-[480px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <CrewMark size={28} />
          <span className="text-sm font-semibold text-white">Today at Main site</span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-0.5 text-2xs font-semibold tracking-[0.06em] text-white/85">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          LIVE
        </span>
      </div>
      <ul className="mt-5 flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <span className="flex flex-col">
              <span className="text-sm font-semibold text-white">{row.name}</span>
              <span className="text-2xs text-white/60">{row.detail}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-white/80">
              <span className={`size-2 rounded-full ${row.tone}`} aria-hidden />
              {row.state}
            </span>
          </li>
        ))}
      </ul>
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
        <span className="text-xs text-white/70">Crew is in preview for a few workspaces</span>
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
          <Link href="/login" aria-label="KitStak Crew" className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
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
        <CrewPreview />
        <div className="relative max-w-md text-center text-white">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">Staff it. Clock it. Plan it.</p>
        </div>
      </aside>
    </div>
  );
}
