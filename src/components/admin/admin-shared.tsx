"use client";

/**
 * Shared client pieces for the M14 admin pages: permission flags, admin options (roles,
 * warehouses, clients), filter-field mapping, bulk toasts, a JSON mutation hook, a change
 * log drawer for module `/change-log` endpoints, and detail lists.
 */
import * as React from "react";
import { z } from "zod";
import { ChevronLeft, ChevronRight, FilePlus2, PencilLine, Trash2 } from "lucide-react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useFormat } from "@/lib/format";
import { usePermissionSet } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";
import { bulkSummary, sentenceCase, type AdminField } from "@/lib/grid-defs/admin/common";
import type { FilterFieldDef } from "@/components/grid";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";

export interface Option {
  readonly value: string;
  readonly label: string;
}

export const NO_PERMISSION = "You don't have permission for this action";

/** Permission flags for one catalog page, e.g. `settings.users`. */
export function usePagePerms<A extends string>(page: string, actions: readonly A[]): Readonly<Record<A, boolean>> & { readonly loading: boolean } {
  const { permissions, isLoading } = usePermissionSet();
  const out = Object.fromEntries(actions.map((a) => [a, permissions.has(`${page}.${a}`)])) as Record<A, boolean>;
  return { ...out, loading: isLoading };
}

const optionsSchema = z.object({
  roles: z.array(z.object({ id: z.string(), key: z.string(), name: z.string(), category: z.string(), description: z.string().nullish(), isSystem: z.boolean() })),
  warehouses: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  clients: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })).default([]),
});
export type AdminOptions = z.infer<typeof optionsSchema>;

const EMPTY_OPTIONS: AdminOptions = { roles: [], warehouses: [], clients: [], users: [] };

/** Roles, warehouses (caller scope) and clients for wizards and filters. */
export function useAdminOptions(): AdminOptions & { readonly loading: boolean } {
  const q = useApiQuery<unknown>(["admin-options"], "/api/users/options", { staleTime: 60_000 });
  const parsed = optionsSchema.safeParse(q.data?.data);
  return { ...(parsed.success ? parsed.data : EMPTY_OPTIONS), loading: q.isPending };
}

/** Pure field list -> filter-builder defs, with page-supplied options for id enums. */
export function toFilterFields(fields: readonly AdminField[], dynamic: Readonly<Record<string, readonly Option[]>> = {}): readonly FilterFieldDef[] {
  return fields.map((f) => {
    const options = dynamic[f.field] ?? f.options?.map((v) => ({ value: v, label: v.includes("_") ? sentenceCase(v) : v }));
    return { field: f.field, label: f.label, type: f.type, ...(options ? { options } : {}) };
  });
}

/* ---------------- mutations ---------------- */

export interface BulkResponse {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export function errorMessage(error: unknown): string {
  if (!isApiError(error)) return "Something went wrong. Try again.";
  return error.code === "CONFLICT" ? "This record changed since you opened it — Reload" : error.message;
}

/** Runs a JSON mutation, toasts failures and invalidates queries. Returns data or null. */
export function useAction(invalidate: readonly QueryKey[]) {
  const qc = useQueryClient();
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async <T,>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown, onError?: (e: unknown) => void): Promise<T | null> => {
      setPending(true);
      try {
        const { data } = await apiRequest<T>(path, { method, body });
        await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
        return data;
      } catch (error) {
        if (onError) onError(error);
        else toast.error("Error", errorMessage(error));
        return null;
      } finally {
        setPending(false);
      }
    },
    [qc, invalidate],
  );
  return { run, pending };
}

/** "3 of 4 users activated · 1 failed" plus the first failure reasons. */
export function toastBulk(result: BulkResponse, noun: string, verb: string): void {
  const message = bulkSummary(result, noun, verb);
  if (result.failed.length === 0) {
    toast.success("Success", message);
    return;
  }
  const reasons = result.failed.slice(0, 3).map((f) => f.message).join(" · ");
  const more = result.failed.length > 3 ? ` (+${result.failed.length - 3} more)` : "";
  (result.succeeded.length === 0 ? toast.error : toast.warning)(result.succeeded.length === 0 ? "Nothing changed" : "Partly done", `${message}. ${reasons}${more}`);
}

/* ---------------- change log (module endpoints) ---------------- */

const logEntry = z.object({ id: z.string(), type: z.enum(["Create", "Update", "Delete"]), message: z.string(), fieldLabel: z.string().nullish(), fromValue: z.string().nullish(), toValue: z.string().nullish(), source: z.string(), at: z.string() });

const TYPE_META = {
  Create: { icon: FilePlus2, tile: "bg-success-soft text-success" },
  Update: { icon: PencilLine, tile: "bg-info-soft text-info" },
  Delete: { icon: Trash2, tile: "bg-danger-soft text-danger" },
} as const;

const LOG_PAGE = 20;

export function EntityChangeLogDrawer({ open, onOpenChange, path, title }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly path: string | null; readonly title: string }) {
  const fmt = useFormat();
  const [page, setPage] = React.useState(1);
  const query = useApiQuery<unknown>(["admin-change-log", path ?? "", page], open && path ? path : null, { query: { page, ps: LOG_PAGE }, placeholderData: (p) => p, staleTime: 0 });
  const parsed = z.array(logEntry).safeParse(query.data?.data);
  const rows = parsed.success ? parsed.data : [];
  const total = query.data?.meta?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE));
  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) setPage(1); onOpenChange(o); }} title={title} description="Every create, edit and delete with who made it and when." width={45}>
      {query.isPending ? (
        <SkeletonTable rows={6} columns={4} />
      ) : query.isError ? (
        <EmptyState title="Couldn't load the change log" description={query.error.message} action={<Button onClick={() => void query.refetch()}>Retry</Button>} compact />
      ) : rows.length === 0 ? (
        <EmptyState title="No changes recorded yet" description="Edits to this record will appear here." compact />
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => {
              const meta = TYPE_META[r.type];
              const Icon = meta.icon;
              return (
                <li key={r.id} className="flex gap-3 px-3 py-2.5">
                  <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", meta.tile)}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                  <div className="min-w-0 flex-1">
                    {r.type === "Update" && r.fieldLabel ? (
                      <p className="break-words text-[13px] text-body">
                        <span className="font-medium">{r.fieldLabel}</span>{" "}
                        {r.fromValue ? <span className="text-faint line-through decoration-faint/60">{r.fromValue}</span> : null}
                        {r.fromValue ? <span className="mx-1 text-faint">→</span> : null}
                        <span className="font-medium text-foreground">{r.toValue || "—"}</span>
                      </p>
                    ) : (
                      <p className="text-[13px] text-body">{r.message}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-faint">{fmt.dateTime(r.at)} · {r.source}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-center justify-between text-[12px] text-secondary">
            <span>Total: {total}</span>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="tabular-nums">{page} / {pages}</span>
              <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ---------------- detail lists ---------------- */

export interface DetailItem {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly wide?: boolean;
}

export function Muted({ children }: { readonly children?: React.ReactNode }) {
  return <span className="text-faint">{children ?? "—"}</span>;
}

/** Two-column label/value grid used by the "Show details" drawers. */
export function DetailList({ title, items }: { readonly title?: string; readonly items: readonly DetailItem[] }) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h3 className="text-[12px] font-semibold uppercase tracking-wide text-secondary">{title}</h3> : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
        {items.map((i) => (
          <div key={i.label} className={cn("min-w-0", i.wide && "col-span-2")}>
            <dt className="text-[11px] text-faint">{i.label}</dt>
            <dd className="mt-0.5 break-words text-[13px] text-foreground">{i.value === null || i.value === undefined || i.value === "" ? <Muted /> : i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Small stat tiles across the top of a detail drawer or page. */
export function StatRow({ stats }: { readonly stats: readonly { readonly label: string; readonly value: React.ReactNode; readonly tone?: "danger" | "warning" | "success" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg border border-border bg-surface-sunken/60 px-3 py-2">
          <p className="text-[11px] text-faint">{s.label}</p>
          <p className={cn("text-[18px] font-semibold tabular-nums text-foreground", s.tone === "danger" && "text-danger", s.tone === "warning" && "text-warning", s.tone === "success" && "text-success")}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
