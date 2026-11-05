import type { Metadata } from "next";
import { Suspense } from "react";
import { Boxes, PackageCheck, Radio, ScanBarcode } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

const STATS: ReadonlyArray<{ icon: React.ReactNode; label: string }> = [
  {
    icon: <ScanBarcode className="h-3.5 w-3.5" aria-hidden />,
    label: "99.98% scan accuracy",
  },
  {
    icon: <PackageCheck className="h-3.5 w-3.5" aria-hidden />,
    label: "1.2M units/mo",
  },
  {
    icon: <Radio className="h-3.5 w-3.5" aria-hidden />,
    label: "14 channels",
  },
];

function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[#5c82f2] to-[#2ec5a8] shadow-md">
        <Boxes className="h-5 w-5 text-white" aria-hidden />
      </span>
      <span
        className={`text-[19px] font-bold tracking-tight ${inverted ? "text-white" : "text-foreground"}`}
      >
        KitStak
        <span
          className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
            inverted ? "bg-white/10 text-white/70" : "bg-neutral-soft text-secondary"
          }`}
        >
          WMS
        </span>
      </span>
    </span>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex lg:w-[55%]"
        style={{
          background:
            "linear-gradient(135deg, #2b3357 0%, #353e6b 38%, #2a5a74 72%, #1e8273 100%)",
        }}
        aria-hidden
      >
        {/* dot grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />
        {/* soft glow accents */}
        <div
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-25"
          style={{ background: "radial-gradient(circle, #5c82f2 0%, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #2ec5a8 0%, transparent 70%)" }}
        />

        <div className="relative">
          <BrandMark inverted />
        </div>

        <div className="relative max-w-[520px]">
          <h2 className="text-[42px] font-bold leading-[1.1] tracking-tight text-white">
            Fulfillment,
            <br />
            running on rails.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-white/70">
            Orders, inventory, receiving and labor — one operations platform built for
            high-volume 3PL warehouses. Synchronized across every channel, from order
            creation to the loading dock.
          </p>

          <ul className="mt-8 flex flex-wrap gap-2.5">
            {STATS.map((stat) => (
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
          © 2026 KitStak Logistics, Inc. · SOC 2 Type II · 99.95% uptime SLA
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex flex-1 flex-col items-center justify-center bg-background px-5 py-10">
        <div className="mb-8 lg:hidden">
          <BrandMark />
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
