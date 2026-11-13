import { KITSTAK_SITE_URL } from '@kitstak/ui/logo';
import { BRAND_NAME } from '@/config/brand';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BrandLogo, BrandMark } from '@/components/layout/brand-logo';
import { demoCredentialsEnabled } from './demo-credentials';
import { LoginForm } from './login-form';
import { SsoNotices } from './sso-sign-in';

const COPYRIGHT_YEAR = 2026;

export const metadata: Metadata = {
  title: 'Sign in',
};

/** Outbound volume mini bars; the tallest bar carries the brand red (portal/CRM parity). */
const OUTBOUND = ['h-7', 'h-10', 'h-8', 'h-14', 'h-11'] as const;

/** Stylized order rows: muted skeleton bars with a status chip; Shipped carries the brand red. */
const ROWS = [
  { name: 'w-40', status: 'Picking', shipped: false },
  { name: 'w-32', status: 'Picking', shipped: false },
  { name: 'w-44', status: 'Packed', shipped: false },
  { name: 'w-28', status: 'Shipped', shipped: true },
] as const;

/**
 * Brand showcase for the sign-in page: a stylized outbound board in the same visual
 * language as the portal's launcher preview and the CRM's pipeline preview (glass card,
 * brand-red accents, muted skeleton bars) so the suite's front doors read as one family.
 */
function WarehousePreview() {
  return (
    <div className="relative mx-auto w-full max-w-[460px] rounded-2xl border border-white/12 bg-white/[0.05] p-5 shadow-modal backdrop-blur-[2px]">
      <div className="flex items-center justify-between">
        <BrandMark size={26} />
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-1.5 rounded-full bg-white/25" />
          <span className="size-1.5 rounded-full bg-white/25" />
          <span className="size-1.5 rounded-full bg-white/40" />
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-3">
        <div>
          <span className="inline-flex rounded-md bg-[var(--brand-red)] px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] text-white">
            ORDERS
          </span>
          <p className="mt-3 text-sm font-semibold text-white">Outbound today</p>
          <p className="mt-0.5 text-xs text-white/60">Picks, packs and ship confirms</p>
        </div>
        <div className="flex items-end gap-1.5 rounded-xl border border-white/12 bg-white/[0.06] px-3 pt-3 pb-2">
          {OUTBOUND.map((h, i) => (
            <span
              key={i}
              className={`${h} w-2.5 rounded-sm ${i === 3 ? 'bg-[var(--brand-red)]' : 'bg-white/25'}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {ROWS.map((row, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"
          >
            <span className="size-5 shrink-0 rounded-full bg-white/15" />
            <span className={`h-2 ${row.name} rounded-full bg-white/20`} />
            <span
              className={`ml-auto inline-flex rounded-md px-2 py-0.5 text-2xs font-semibold ${
                row.shipped ? 'bg-[var(--brand-red)] text-white' : 'bg-white/10 text-white/70'
              }`}
            >
              {row.status}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-xs text-white/70">All stations scanning, orders on schedule</span>
      </div>
    </div>
  );
}

/** Demo credentials: non-production builds with DEMO_MODE set only (see demo-credentials.ts). */
function showDemoCredentials(): boolean {
  return demoCredentialsEnabled({ NODE_ENV: process.env.NODE_ENV, DEMO_MODE: process.env.DEMO_MODE });
}

/** Split sign-in layout: form column on the left, branded showcase panel on the right (≥ lg). */
export default function LoginPage() {
  return (
    <div className="grid min-h-dvh bg-panel lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <header>
          <a
            href={KITSTAK_SITE_URL}
            aria-label={`${BRAND_NAME} website`}
            className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            <BrandLogo tone="light" height={24} showProduct />
          </a>
        </header>
        <main className="flex flex-1 flex-col items-center justify-center py-10">
          <Suspense fallback={null}>
            <LoginForm showDemoCredentials={showDemoCredentials()} />
            <SsoNotices />
          </Suspense>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
          <span>
            © {COPYRIGHT_YEAR} {BRAND_NAME}
          </span>
          <span>One account for CRM and WMS</span>
        </footer>
      </div>

      <aside
        aria-hidden
        className="auth-hero relative hidden overflow-hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:gap-10 lg:p-12"
      >
        <WarehousePreview />
        <div className="relative max-w-md text-center text-white">
          <p className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
            Every order, pick and pallet, tracked from dock to door.
          </p>
          <p className="mt-3 text-md text-white/80">
            Run receiving, inventory and outbound from one platform that keeps pace with the warehouse floor.
          </p>
        </div>
      </aside>
    </div>
  );
}
