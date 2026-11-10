import * as React from "react";
import type { DevOrderLine } from "@/lib/dev-orders";
import { cn } from "@/lib/utils";

const HEADERS = [
  { key: "sku", label: "SKU", numeric: false },
  { key: "description", label: "Description", numeric: false },
  { key: "quantity", label: "Qty", numeric: true },
  { key: "allocated", label: "Allocated", numeric: true },
  { key: "picked", label: "Picked", numeric: true },
] as const;

/** Compact (32px rows, 12px text) order-lines table rendered inside an expanded grid row. */
export function OrderLinesTable({ code, lines }: { readonly code: string; readonly lines: readonly DevOrderLine[] }) {
  if (lines.length === 0) return <p className="text-[12px] text-faint">{code} has no lines.</p>;
  return (
    <table aria-label={`${code} order lines`} className="w-auto min-w-[560px] max-w-[760px] border-collapse text-[12px]">
      <thead>
        <tr className="h-8 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">
          {HEADERS.map((h) => (
            <th key={h.key} scope="col" className={cn("px-3 font-semibold", h.numeric ? "w-20 text-right" : "text-left")}>{h.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="h-8 border-t border-border">
            <td className="whitespace-nowrap px-3 font-medium text-foreground">{line.sku}</td>
            <td className="max-w-[320px] truncate px-3 text-secondary" title={line.description}>{line.description}</td>
            <td className="px-3 text-right tabular-nums text-foreground">{line.quantity.toLocaleString()}</td>
            <td className={cn("px-3 text-right tabular-nums", line.allocatedQuantity < line.quantity ? "text-warning" : "text-foreground")}>{line.allocatedQuantity.toLocaleString()}</td>
            <td className="px-3 text-right tabular-nums text-foreground">{line.pickedQuantity.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
