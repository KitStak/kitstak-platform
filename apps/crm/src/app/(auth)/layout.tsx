import Link from 'next/link';
import { Logo } from '@/features/shell/logo';
import { AuthIllustration } from './_components/auth-illustration';

/** Split auth layout: form column on the left, branded showcase panel on the right (≥ lg). */
export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-panel lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <header>
          <Link
            href="/login"
            aria-label="KitStak home"
            className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <Logo size={30} />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-fade-in">{children}</div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span>© {new Date().getFullYear()} KitStak</span>
          <span className="flex gap-4">
            <Link className="hover:text-fg hover:underline" href="/privacy">
              Privacy
            </Link>
            <Link className="hover:text-fg hover:underline" href="/terms">
              Terms
            </Link>
          </span>
        </footer>
      </div>

      <aside
        aria-hidden
        className="auth-hero relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12"
      >
        <div className="relative w-full max-w-[460px]">
          <AuthIllustration />
        </div>
        <div className="relative max-w-md text-center text-white">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Every deal, contact and next step — on one board your whole team trusts.
          </p>
          <p className="mt-3 text-md text-white/80">
            Pipelines, automations and dashboards that keep revenue moving.
          </p>
        </div>
      </aside>
    </div>
  );
}
