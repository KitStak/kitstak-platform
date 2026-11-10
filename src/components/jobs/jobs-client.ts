"use client";

/**
 * Client helpers shared by the M03 screens (jobs, tasks, wave rules, job types, reports):
 * row types, bulk-result toasts and error text.
 */
import { apiFetch, isApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";

export interface BulkFailure {
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

export interface BulkOutcome {
  readonly succeeded: readonly string[];
  readonly failed: readonly BulkFailure[];
}

export type GridRow = { readonly id: string } & Readonly<Record<string, unknown>>;

export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  return isApiError(error) ? error.message : error instanceof Error ? error.message : fallback;
}

export function plural(n: number, noun: string, many = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : many}`;
}

/** "3 of 4 jobs cancelled · 1 failed" with the first failure reasons. */
export function bulkToast(result: BulkOutcome, noun: string, verb: string, codes?: ReadonlyMap<string, string>): void {
  const ok = result.succeeded.length;
  const all = ok + result.failed.length;
  const base = `${ok} of ${plural(all, noun)} ${verb}`;
  if (result.failed.length === 0) {
    toast.success("Success", all === 1 && codes?.get(result.succeeded[0] ?? "") ? `${codes.get(result.succeeded[0] ?? "")} ${verb}` : base);
    return;
  }
  const reasons = result.failed.slice(0, 3).map((f) => `${codes?.get(f.id) ? `${codes.get(f.id)}: ` : ""}${f.message}`).join(" · ");
  const more = result.failed.length > 3 ? ` · +${result.failed.length - 3} more` : "";
  (ok > 0 ? toast.warning : toast.error)(ok > 0 ? `${base} · ${result.failed.length} failed` : "Nothing changed", `${reasons}${more}`);
}

export function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body });
}

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
