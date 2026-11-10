"use client";

/** Rail cards shared by create and edit: order status (progress ring + Save) and price summary. */
import * as React from "react";
import { ClipboardCheck } from "lucide-react";
import { useFormat } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import { orderTotals, type OrderFormValues } from "./order-form-model";

export function RailCard({ title, action, children, className }: { readonly title: React.ReactNode; readonly action?: React.ReactNode; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs ${className ?? ""}`}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function StatusCard({ percent, saveLabel, onSave, saving, disabledReason, subtitle }: {
  readonly percent: number; readonly saveLabel: string; readonly onSave?: () => void; readonly saving: boolean; readonly disabledReason: string | null; readonly subtitle: string;
}) {
  return (
    <RailCard title="Data completeness">
      <div className="flex items-center gap-3">
        <ProgressRing value={percent} size={64} thickness={5} tone={percent >= 100 ? "success" : "primary"} label="Required order data complete" center={<ClipboardCheck className="h-5 w-5 text-secondary" aria-hidden />} />
        <div className="min-w-0">
          <p className="text-[20px] font-semibold tabular-nums text-foreground">{Math.round(percent)}%<span className="ml-1.5 text-[12px] font-normal text-secondary">required data</span></p>
          <p className="text-[12px] text-secondary">{subtitle}</p>
        </div>
      </div>
      {onSave ? <DisabledReason reason={saving ? null : disabledReason}>
        <Button variant="primary" size="lg" className="w-full" onClick={onSave} disabled={saving || Boolean(disabledReason)} aria-busy={saving}>
          {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
          {saveLabel}
        </Button>
      </DisabledReason> : null}
      {onSave && !saving && disabledReason ? (
        <p className="mt-2 text-[12px] text-secondary" role="note">{disabledReason}</p>
      ) : null}
    </RailCard>
  );
}

export function PriceSummary({ values }: { readonly values: OrderFormValues }) {
  const fmt = useFormat();
  const t = orderTotals(values.lines ?? [], values.discount ?? 0);
  return (
    <dl className="flex flex-col gap-1.5 text-[13px]">
      <div className="flex justify-between"><dt className="text-secondary">Price</dt><dd className="tabular-nums text-foreground">{fmt.money(t.price, "USD", "summary")}</dd></div>
      <div className="flex justify-between"><dt className="text-secondary">Discount</dt><dd className="tabular-nums text-foreground">{fmt.money(t.discount, "USD", "summary")}</dd></div>
      <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt className="text-foreground">Total</dt><dd className="tabular-nums text-foreground">{fmt.money(t.total, "USD", "summary")}</dd></div>
      <div className="flex justify-between text-[12px]"><dt className="text-faint">Weight</dt><dd className="tabular-nums text-secondary">{fmt.measure(t.weightOz / 16, "lb", 2)}</dd></div>
    </dl>
  );
}
