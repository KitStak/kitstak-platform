import { BRAND_NAME } from "@/config/brand";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PackageCheck, Radio, ScanBarcode } from "lucide-react";
import { BRAND_COLORS, BrandLogo } from "@/components/layout/brand-logo";
import { demoCredentialsEnabled } from "./demo-credentials";
import { LoginForm } from "./login-form";
import { SsoNotices } from "./sso-sign-in";

const COPYRIGHT_YEAR = 2026;

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * Product capabilities, not marketing metrics: every chip describes something the app
 * actually does, so nothing here needs a source or an audit to back it up.
 */
const CAPABILITIES: ReadonlyArray<{ icon: React.ReactNode; label: string }> = [
  {
    icon: <ScanBarcode className="h-3.5 w-3.5" aria-hidden />,
    label: "Scan-verified pick & pack",
  },
  {
    icon: <PackageCheck className="h-3.5 w-3.5" aria-hidden />,
    label: "Ledger-backed inventory",
  },
  {
    icon: <Radio className="h-3.5 w-3.5" aria-hidden />,
    label: "Multi-channel order sync",
  },
];

function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return <BrandLogo tone={inverted ? "dark" : "light"} height={24} showProduct />;
}

/** Demo credentials: non-production builds with DEMO_MODE set only (see demo-credentials.ts). */
function showDemoCredentials(): boolean {
  return demoCredentialsEnabled({ NODE_ENV: process.env.NODE_ENV, DEMO_MODE: process.env.DEMO_MODE });
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex lg:w-[55%]"
        style={{ background: "var(--surface-brand)" }}
        aria-hidden
      >
        {/* dot grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: `radial-gradient(circle, ${BRAND_COLORS.cream} 1px, transparent 1px)`,
            backgroundSize: "26px 26px",
          }}
        />
        {/* oversized brand bars, bleeding off the right edge */}
        <div className="pointer-events-none absolute -right-24 bottom-16 flex w-[34%] flex-col gap-8 opacity-[0.14]">
          <div className="h-24" style={{ background: BRAND_COLORS.crimson }} />
          <div className="h-24" style={{ background: BRAND_COLORS.maroon }} />
        </div>

        <div className="relative">
          <BrandMark inverted />
        </div>

        <div className="relative max-w-[520px]">
          <h2 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.02em]" style={{ color: BRAND_COLORS.cream }}>
            Fulfillment,
            <br />
            <span style={{ color: BRAND_COLORS.crimson }}>running on rails.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-white/70">
            Orders, inventory, receiving and labor — one operations platform built for
            high-volume 3PL warehouses. Synchronized across every channel, from order
            creation to the loading dock.
          </p>

          <ul className="mt-8 flex flex-wrap gap-2.5">
            {CAPABILITIES.map((stat) => (
              <li
                key={stat.label}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/90 backdrop-blur-sm"
              >
                {stat.icon}
                {stat.label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[12px] text-white/40">
          © {COPYRIGHT_YEAR} {BRAND_NAME}
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 flex-col items-center justify-center bg-background px-5 py-10">
        <div className="mb-8 lg:hidden">
          <BrandMark />
        </div>
        <Suspense fallback={null}>
          <LoginForm showDemoCredentials={showDemoCredentials()} />
          <SsoNotices />
        </Suspense>
      </main>
    </div>
  );
}
