import { KITSTAK_SITE_URL } from '@kitstak/ui/logo';
import { Logo, LogoMark } from '@/features/shell/logo';

/** The brand showcase panel: a stylized launcher preview (portal is the front door). */
function LauncherPreview() {
  const tiles = [
    { tag: 'CRM', title: 'KitStak CRM', caption: 'Pipelines & automations' },
    { tag: 'WMS', title: 'KitStak WMS', caption: 'Warehouse operations' },
  ];
  return (
    <div className="relative w-full max-w-[460px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
      <div className="flex items-center justify-between">
        <LogoMark size={26} />
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-1.5 rounded-full bg-white/25" />
          <span className="size-1.5 rounded-full bg-white/25" />
          <span className="size-1.5 rounded-full bg-white/40" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <div key={tile.tag} className="rounded-xl border border-white/12 bg-white/[0.06] p-4">
            <span className="inline-flex rounded-md bg-[var(--brand-red)] px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] text-white">
              {tile.tag}
            </span>
            <p className="mt-3 text-sm font-semibold text-white">{tile.title}</p>
            <p className="mt-0.5 text-xs text-white/60">{tile.caption}</p>
            <div className="mt-4 h-1.5 w-16 rounded-full bg-white/20">
              <div className="h-full w-2/3 rounded-full bg-[var(--brand-red)]" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-xs text-white/70">Signed in once, open everywhere</span>
      </div>
    </div>
  );
}

/** Split auth layout: form column on the left, branded showcase panel on the right (≥ lg). */
export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-panel lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <header>
          <a
            href={KITSTAK_SITE_URL}
            aria-label="KitStak website"
            className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <Logo size={30} />
          </a>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-in">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span className="text-fg-muted">One account for CRM and WMS</span>
        </footer>
      </div>

      <aside
        aria-hidden
        className="auth-hero relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12"
      >
        <LauncherPreview />
        <div className="relative max-w-md text-center text-white">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            One login. Every KitStak app your team runs on.
          </p>
          <p className="mt-3 text-md text-white/80">
            Launch CRM and WMS, switch organizations and manage your team from a single front door.
          </p>
        </div>
      </aside>
    </div>
  );
}
