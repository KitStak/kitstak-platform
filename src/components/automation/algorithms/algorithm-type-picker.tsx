"use client";

/** `/automation/algorithms` — Select Algorithm Type (spec 06 §1) with a full-page circuit illustration. */
import Link from "next/link";
import { ArrowRight, Boxes, PackageSearch, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

function CircuitArt() {
  return (
    <svg viewBox="0 0 640 260" aria-hidden className="h-auto w-full max-w-[640px] text-primary">
      <defs>
        <linearGradient id="alg-screen" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round">
        <path d="M20 60h110l30 30h70" /><path d="M20 130h90l20-20h100" /><path d="M20 200h120l40-40h50" />
        <path d="M620 60H510l-30 30h-70" /><path d="M620 130h-90l-20-20H410" /><path d="M620 200H500l-40-40h-50" />
      </g>
      <g fill="currentColor" fillOpacity="0.45">
        {[[20, 60], [20, 130], [20, 200], [620, 60], [620, 130], [620, 200], [230, 90], [230, 110], [230, 160], [410, 90], [410, 110], [410, 160]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" />)}
      </g>
      <rect x="240" y="40" width="160" height="110" rx="10" fill="url(#alg-screen)" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
      <path d="M220 160h200l20 24H200z" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" />
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M268 70h46" strokeOpacity="0.7" /><path d="M268 88h78" strokeOpacity="0.4" /><path d="M268 106h60" strokeOpacity="0.4" />
        <path d="M268 124h96" strokeOpacity="0.25" />
      </g>
      <circle cx="368" cy="74" r="10" fill="currentColor" fillOpacity="0.85" />
      <path d="M363 74l4 4 7-8" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const CARDS = [
  {
    href: "/automation/algorithms/putaway", title: "Putaway Algorithm", icon: PackageSearch, tone: "bg-success text-white hover:bg-success/90",
    body: "Decide where received and transferred stock goes: same SKU, empty bins, zones, capacity and dynamic replenishment.",
  },
  {
    href: "/automation/algorithms/allocation", title: "Allocation Algorithm", icon: Boxes, tone: "bg-[#621DB8] text-white hover:bg-[#621DB8]/90",
    body: "Decide which stock an order reserves: FEFO, pick faces first, lots, full LPs and order conditions per client or channel.",
  },
] as const;

export function AlgorithmTypePicker() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Select Algorithm Type" helper="Select an algorithm type to build your own algorithm."
        actions={<>
          <Link href="/automation/algorithms/putaway/new" className={buttonVariants({ variant: "secondary", size: "sm" })}><Plus className="h-3.5 w-3.5" aria-hidden />Create Putaway Algorithm</Link>
          <Link href="/automation/algorithms/allocation/new" className={buttonVariants({ variant: "primary", size: "sm" })}><Plus className="h-3.5 w-3.5" aria-hidden />Create Allocation Algorithm</Link>
        </>} />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-8 px-6 py-8">
        <CircuitArt />
        <nav aria-label="Algorithm types" className="grid w-full gap-4 sm:grid-cols-2">
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} aria-label={`${c.title}: open the ${c.title.toLowerCase()} list`}
              className={cn("group flex flex-col gap-3 rounded-xl p-5 shadow-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 hover:-translate-y-0.5", c.tone)}>
              <span className="flex items-center gap-2 text-[16px] font-semibold"><c.icon className="h-5 w-5" aria-hidden />{c.title}
                <ArrowRight className="ml-auto h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden /></span>
              <span className="text-[13px] leading-5 text-white/85">{c.body}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
