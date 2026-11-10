"use client";

/** Mobile preview canvas: the receiving screen as an operator sees it with the current steps. */
import { Camera, CalendarClock, Hash, Package, Printer, Ruler, ScanLine } from "lucide-react";
import { RECEIVING_STEPS } from "@/lib/grid-defs/admin/screen-configs";

const ICONS: Readonly<Record<string, React.ComponentType<{ className?: string }>>> = {
  scanLp: ScanLine, lot: Hash, expiry: CalendarClock, productionDate: CalendarClock, photo: Camera, dimensions: Ruler, printLabel: Printer,
};

interface Step { readonly key: string; readonly enabled: boolean; readonly required: boolean }

export function MobilePreview({ steps, title }: { readonly steps: readonly Step[]; readonly title: string }) {
  const shown = RECEIVING_STEPS.filter((d) => steps.find((s) => s.key === d.key)?.enabled);
  return (
    <section aria-label="Mobile preview" className="flex items-start justify-center rounded-xl bg-surface-sunken px-4 py-6">
      <div className="w-[260px] rounded-[30px] border-[6px] border-foreground/85 bg-surface shadow-lg">
        <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-foreground/20" />
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
          <span className="rounded bg-success-soft px-1.5 py-px text-[10px] font-semibold text-success">PO000418</span>
        </div>
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
          <Package className="h-4 w-4 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-foreground">APX-TEE-BLK-M</span>
            <span className="block text-[10px] text-secondary">Expected 48 · Received 12</span>
          </span>
        </div>
        <ol className="flex min-h-[260px] flex-col gap-1.5 px-3 pb-3">
          {shown.length === 0 ? <li className="py-10 text-center text-[12px] text-faint">No steps switched on</li> : null}
          {shown.map((d, i) => {
            const s = steps.find((x) => x.key === d.key);
            const Icon = ICONS[d.key] ?? ScanLine;
            return (
              <li key={d.key} className="flex items-center gap-2 rounded-lg bg-surface-sunken px-2.5 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface text-primary shadow-xs"><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                <span className="flex-1 text-[12px] text-foreground">{i + 1}. {d.label}</span>
                {d.canBeOptional ? <span className={s?.required ? "text-[10px] font-semibold text-danger" : "text-[10px] text-faint"}>{s?.required ? "Required" : "Optional"}</span> : null}
              </li>
            );
          })}
        </ol>
        <div className="px-3 pb-4"><div className="rounded-lg bg-success py-2 text-center text-[12px] font-semibold text-white">Receive</div></div>
      </div>
    </section>
  );
}
