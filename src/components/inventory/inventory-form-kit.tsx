"use client";

/**
 * Form pieces shared by the inventory drawers:
 *  - `QtyInput`: a quantity box that never rewrites what the user typed (no clamping or
 *    rounding: -2, 0 or 1.5 stay on screen and the schema says why they are wrong).
 *  - `qtyIssue`: the one set of quantity messages every drawer uses.
 *  - `DrawerFooter`: Cancel / Save, disabled while any field error is showing.
 *  - `usePlacementCheck` + `PlacementNotice`: destination pre-flight (count lock, only 1 SKU).
 */
import * as React from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { useMe } from "@/lib/permissions-client";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import { controlVariants } from "@/components/ui/control-styles";
import { formatQty } from "./inventory-shared";

/** Same ceiling as the API (`qty` max in inventory-commands). */
export const MAX_QTY = 10_000_000;
/** Above this a quantity is accepted but flagged for a second look. */
export const LARGE_QTY = 100_000;

/** "1,234" → 1234; "" → null; anything that is not a plain number → NaN (shown as an error, never coerced). */
export function parseQtyText(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!t) return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : Number.NaN;
}

/** The message for a quantity value, or null when it is valid. */
export function qtyIssue(v: number | null | undefined, opts: { readonly allowZero?: boolean; readonly requiredMessage?: string } = {}): string | null {
  if (v === null || v === undefined) return opts.requiredMessage ?? "Enter a quantity";
  if (Number.isNaN(v)) return "Enter a number";
  if (!Number.isInteger(v)) return "Use a whole number";
  if (v < 0) return opts.allowZero ? "Can't be negative" : "Must be greater than 0";
  if (v === 0 && !opts.allowZero) return "Must be greater than 0";
  if (v > MAX_QTY) return `Enter at most ${formatQty(MAX_QTY)}`;
  return null;
}

export const isLargeQty = (v: number | null | undefined): boolean => typeof v === "number" && Number.isFinite(v) && v > LARGE_QTY && v <= MAX_QTY;

export interface QtyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size"> {
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
  readonly invalid?: boolean;
  readonly suffix?: React.ReactNode;
}

export const QtyInput = React.forwardRef<HTMLInputElement, QtyInputProps>(({ value, onChange, invalid, suffix, className, disabled, onBlur, ...props }, ref) => {
  const [text, setText] = React.useState(() => (value === null || Number.isNaN(value) ? "" : String(value)));
  // Follow programmatic changes ("All 20" button, reset) without touching what is being typed.
  React.useEffect(() => {
    const parsed = parseQtyText(text);
    const same = parsed === value || (Number.isNaN(parsed) && Number.isNaN(value));
    if (!same) setText(value === null || Number.isNaN(value) ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only external value changes matter
  }, [value]);
  return (
    <div data-invalid={invalid || undefined} data-disabled={disabled || undefined} className={cn(controlVariants({ size: "md" }), "flex items-center gap-1", className)}>
      <input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseQtyText(e.target.value));
        }}
        onBlur={onBlur}
        className="h-full min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none placeholder:text-faint disabled:cursor-not-allowed"
        {...props}
      />
      {suffix ? <span className="shrink-0 text-xs text-faint">{suffix}</span> : null}
    </div>
  );
});
QtyInput.displayName = "QtyInput";

/**
 * Cancel / Save for drawer forms. Save is disabled while any field error shows (or `blockedReason`
 * is set), with the reason in a tooltip. Mouse-down on Save does not steal focus, so the field being
 * edited doesn't blur, validate and disable Save before the click lands: the click submits and the
 * form flags every invalid field at once.
 */
export function DrawerFooter({ submitLabel = "Save", onCancel, pending, blockedReason }: { readonly submitLabel?: string; readonly onCancel: () => void; readonly pending: boolean; readonly blockedReason?: string | null }) {
  const { control } = useFormContext();
  const { errors, isSubmitting } = useFormState({ control });
  const hasErrors = Object.keys(errors).length > 0;
  const busy = pending || isSubmitting;
  const reason = blockedReason ?? (hasErrors ? "Fix the highlighted fields first" : null);
  return (
    <div className="sticky bottom-0 -mx-5 mt-auto flex justify-end gap-2 border-t border-border bg-surface px-5 py-3">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      <DisabledReason reason={busy ? null : reason}>
        <Button type="submit" variant="primary" disabled={busy || reason !== null} aria-busy={busy} onMouseDown={(e) => e.preventDefault()}>
          {busy ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
          {submitLabel}
        </Button>
      </DisabledReason>
    </div>
  );
}

/* ---------------- warehouse select ---------------- */

/** One warehouse label across the module: "MLT1 - Main Fulfillment" (never "MLT1 · MLT1 - …"). */
export function warehouseLabel(w: { readonly code?: string | null; readonly name: string }): string {
  return w.code && !w.name.startsWith(w.code) ? `${w.code} - ${w.name}` : w.name;
}

export function InventoryWarehouseSelect({ id, value, onChange, invalid, onBlur, disabled }: { readonly id?: string; readonly value: string | null; readonly onChange: (v: string | null) => void; readonly invalid?: boolean; readonly onBlur?: () => void; readonly disabled?: boolean }) {
  const me = useMe();
  const options = (me.data?.data.contextOptions.warehouses ?? []).map((w) => ({ value: w.id, label: warehouseLabel(w) }));
  return <Combobox id={id} aria-label="Warehouse" options={options} value={value} onChange={(v) => onChange(v)} onBlur={onBlur} invalid={invalid} disabled={disabled || me.isPending} placeholder="Select warehouse" clearable={false} />;
}

/* ---------------- destination pre-flight ---------------- */

export interface PlacementCheck {
  readonly kind: "location" | "lp";
  readonly id: string;
  readonly code: string;
  readonly countLockPlan: string | null;
  readonly blocking: string | null;
  readonly notes: readonly string[];
}

/** The pre-flight gives up after this long and says so (the server re-checks on Submit anyway). */
export const PLACEMENT_CHECK_TIMEOUT_MS = 6000;

export interface PlacementCheckState {
  readonly check: PlacementCheck | null;
  /** First load for this target only; background refetches never re-block Transfer. */
  readonly checking: boolean;
  /** The check failed or timed out: a retry link shows and Submit stays available. */
  readonly failed: boolean;
  readonly retry: () => void;
}

export function usePlacementCheck(target: { readonly kind: "location" | "lp"; readonly id: string } | null, productIds: readonly string[], exclude: readonly string[] = []): PlacementCheckState {
  const query = target ? { kind: target.kind, id: target.id, productIds: productIds.join(","), exclude: exclude.join(",") } : undefined;
  const q = useQuery<PlacementCheck, Error>({
    queryKey: ["inventory-placement-check", query],
    enabled: Boolean(target),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      signal.addEventListener("abort", onAbort);
      const timer = setTimeout(() => ctrl.abort(), PLACEMENT_CHECK_TIMEOUT_MS);
      try {
        const res = await apiRequest<PlacementCheck>("/api/inventory/placement-check", { query, signal: ctrl.signal });
        return res.data;
      } catch (e) {
        if (ctrl.signal.aborted && !signal.aborted) throw new Error("The destination check timed out");
        throw e;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
  });
  const data = target && q.data?.id === target.id ? q.data : null;
  return {
    check: data,
    checking: Boolean(target) && q.isPending && q.fetchStatus === "fetching",
    failed: Boolean(target) && q.isError && !data,
    retry: () => { void q.refetch(); },
  };
}

/** Inline result under a destination picker: lock / rule (blocking, red), a neutral note, or a retry when the check failed. */
export function PlacementNotice({ state }: { readonly state: PlacementCheckState }) {
  const { check, checking, failed, retry } = state;
  if (checking && !check) return <p className="flex items-center gap-1.5 text-xs text-secondary"><Spinner className="h-3 w-3" label="Checking" /> Checking the destination…</p>;
  if (failed) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-1.5 text-xs text-warning">
        <span>Couldn&apos;t check the destination in time. It is re-checked when you submit.</span>
        <button type="button" onClick={retry} className="font-semibold text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded">Retry</button>
      </p>
    );
  }
  if (!check) return null;
  if (check.blocking) {
    return (
      <p role="alert" className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{check.blocking}</span>
      </p>
    );
  }
  if (check.notes.length === 0) return null;
  return <p className="text-xs text-secondary">{check.notes.join(" ")}</p>;
}
