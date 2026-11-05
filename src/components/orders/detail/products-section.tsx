import * as React from "react";
import Link from "next/link";
import type { OrderDetailLine } from "@/server/repositories/orders";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import { SectionCard } from "./section-card";

export interface ProductsSectionProps {
  lines: OrderDetailLine[];
  footer?: React.ReactNode;
}

const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint";
const TD = "px-3 text-[13px] text-body";

function qtyTone(actual: number, expected: number): string {
  if (actual >= expected) return "text-success font-medium";
  if (actual === 0) return "text-faint";
  return "text-warning font-medium";
}

export function ProductsSection({ lines, footer }: ProductsSectionProps) {
  const totals = lines.reduce(
    (acc, l) => ({
      qty: acc.qty + l.quantity,
      picked: acc.picked + l.pickedQuantity,
      packed: acc.packed + l.packedQuantity,
      amount: acc.amount + l.quantity * l.unitPrice,
    }),
    { qty: 0, picked: 0, packed: 0, amount: 0 }
  );
  return (
    <SectionCard
      stepLabel="Step 3"
      title="Products"
      helper="Line items on this order with pick and pack progress per SKU."
      footer={footer}
    >
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-surface-sunken/60 text-left">
              <th className={TH}>SKU</th>
              <th className={TH}>Product Name</th>
              <th className={cn(TH, "text-right")}>Qty</th>
              <th className={cn(TH, "text-right")}>Picked</th>
              <th className={cn(TH, "text-right")}>Packed</th>
              <th className={cn(TH, "text-right")}>Unit Price</th>
              <th className={cn(TH, "text-right")}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[13px] text-faint">
                  No line items on this order.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr
                  key={line.id}
                  className="h-10 border-b border-border last:border-b-0 transition-colors hover:bg-surface-sunken/50"
                >
                  <td className={TD}>
                    <Link
                      href={`/products/${line.productId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {line.sku}
                    </Link>
                  </td>
                  <td className={cn(TD, "max-w-[260px]")}>
                    <span className="block truncate">{line.productName}</span>
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    {formatNumber(line.quantity)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "text-right tabular-nums",
                      qtyTone(line.pickedQuantity, line.quantity)
                    )}
                  >
                    {formatNumber(line.pickedQuantity)}
                  </td>
                  <td
                    className={cn(
                      TD,
                      "text-right tabular-nums",
                      qtyTone(line.packedQuantity, line.quantity)
                    )}
                  >
                    {formatNumber(line.packedQuantity)}
                  </td>
                  <td className={cn(TD, "text-right tabular-nums")}>
                    {formatMoney(line.unitPrice)}
                  </td>
                  <td className={cn(TD, "text-right font-medium tabular-nums")}>
                    {formatMoney(line.quantity * line.unitPrice)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {lines.length > 0 ? (
            <tfoot>
              <tr className="h-10 border-t border-border bg-surface-sunken/60">
                <td className={cn(TD, "font-semibold text-foreground")} colSpan={2}>
                  Totals · {formatNumber(lines.length)}{" "}
                  {lines.length === 1 ? "line" : "lines"}
                </td>
                <td className={cn(TD, "text-right font-semibold tabular-nums")}>
                  {formatNumber(totals.qty)}
                </td>
                <td className={cn(TD, "text-right font-semibold tabular-nums")}>
                  {formatNumber(totals.picked)}
                </td>
                <td className={cn(TD, "text-right font-semibold tabular-nums")}>
                  {formatNumber(totals.packed)}
                </td>
                <td />
                <td
                  className={cn(TD, "text-right font-semibold tabular-nums text-foreground")}
                >
                  {formatMoney(totals.amount)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </SectionCard>
  );
}
