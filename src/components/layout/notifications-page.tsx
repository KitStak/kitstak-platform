"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, ChevronLeft, ChevronRight, FilterX, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiError } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { kindGroup, kindGroupLabel, type NotificationDateFilter, type NotificationFilter } from "@/lib/grid-defs/admin/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { SkeletonText } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { NotificationItem, type NotificationView } from "./notification-item";
import { NOTIFICATIONS_QUERY_KEY, useMarkNotificationsRead } from "./notifications-bell";
import { PageHeader } from "./page-header";

const PAGE_SIZES = [25, 50, 100] as const;
type Status = "all" | "unread";
type Severity = NotificationFilter["severity"];

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** "26–50 of 112" (or "0 of 0"). PURE. */
export function rangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return "0 of 0";
  const start = (page - 1) * pageSize + 1;
  return `${start}–${Math.min(total, page * pageSize)} of ${total}`;
}

const SEVERITY_OPTIONS: readonly { value: Severity; label: string }[] = [
  { value: "all", label: "Any severity" }, { value: "attention", label: "Needs attention" }, { value: "success", label: "Success" }, { value: "info", label: "Info" },
];
const DATE_OPTIONS: readonly { value: NotificationDateFilter; label: string }[] = [
  { value: "all", label: "Any time" }, { value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" },
];

function Chip({ active, onClick, children }: { readonly active: boolean; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("h-7 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40",
        active ? "border-primary bg-primary-soft text-primary" : "border-border bg-surface text-secondary hover:border-border-strong hover:text-body")}>
      {children}
    </button>
  );
}

function useDeleteNotifications() {
  const qc = useQueryClient();
  return useMutation<{ deleted: number }, ApiError, { ids: readonly string[] } | { read: true }>({
    mutationFn: async (input) => (await apiRequest<{ deleted: number }>("/api/notifications", { method: "DELETE", body: input })).data,
    onSuccess: (r, input) => {
      if ("ids" in input) {
        const gone = new Set(input.ids);
        qc.setQueriesData<{ data: readonly NotificationView[]; meta?: Record<string, unknown> }>({ queryKey: NOTIFICATIONS_QUERY_KEY }, (old) =>
          old && Array.isArray(old.data) ? { ...old, data: old.data.filter((n) => !gone.has(n.id)) } : old);
      }
      toast.success("Success", r.deleted === 1 ? "1 notification deleted" : `${r.deleted} notifications deleted`);
    },
    onError: (e) => toast.error("Couldn't delete", e.message),
    onSettled: () => void qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });
}

/** `/notifications`: paged inbox with status, type, severity and date filters, mark read and delete. */
export function NotificationsPage() {
  const router = useRouter();
  const [status, setStatus] = React.useState<Status>("all");
  const [type, setType] = React.useState("");
  const [severity, setSeverity] = React.useState<Severity>("all");
  const [since, setSince] = React.useState<NotificationDateFilter>("all");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(PAGE_SIZES[0]);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const list = useApiQuery<readonly NotificationView[]>(NOTIFICATIONS_QUERY_KEY, "/api/notifications", {
    query: { page, ps: pageSize, unread: status === "unread" ? "true" : "false", type, severity, since },
    placeholderData: (previous) => previous,
  });
  const markRead = useMarkNotificationsRead();
  const del = useDeleteNotifications();
  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? 0;
  const unread = typeof list.data?.meta?.unread === "number" ? list.data.meta.unread : 0;
  const types = Array.isArray(list.data?.meta?.types) ? (list.data.meta.types as string[]) : [];
  const pages = pageCount(total, pageSize);
  const filtered = status !== "all" || type !== "" || severity !== "all" || since !== "all";
  React.useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const open = (n: NotificationView): void => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    if (n.href) router.push(n.href);
  };
  const clearFilters = () => { setStatus("all"); setType(""); setSeverity("all"); setSince("all"); setPage(1); };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Notifications"
        helper="Wave completions, failed imports, shortages, feedback and other alerts for your account."
        actions={
          <>
            <Button variant="secondary" disabled={del.isPending} onClick={() => setConfirmClear(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Clear read
            </Button>
            <Button variant="primary" disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark all read
            </Button>
          </>
        }
      />
      <div className="px-6 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Notification filters">
          <SegmentedControl<Status> ariaLabel="Read status" value={status} onChange={reset(setStatus)}
            options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread (${unread})` }]} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <Chip active={type === ""} onClick={() => reset(setType)("")}>All types</Chip>
          {types.map((t) => <Chip key={t} active={type === t} onClick={() => reset(setType)(type === t ? "" : t)}>{kindGroupLabel(t)}</Chip>)}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="w-44"><Select aria-label="Severity" value={severity} onChange={(v) => v && reset(setSeverity)(v as Severity)} options={SEVERITY_OPTIONS} /></span>
            <span className="w-40"><Select aria-label="Date" value={since} onChange={(v) => v && reset(setSince)(v as NotificationDateFilter)} options={DATE_OPTIONS} /></span>
            {filtered ? <Button variant="ghost" size="sm" onClick={clearFilters}><FilterX className="h-3.5 w-3.5" aria-hidden />Clear filters</Button> : null}
          </span>
        </div>
        {list.isError ? (
          <Callout variant="error" title="Could not load notifications" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>{list.error.message}</Callout>
        ) : list.isLoading ? (
          <div className="rounded-lg border border-border bg-surface p-4"><SkeletonText lines={6} /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState icon={BellOff} title={filtered ? "No notifications match these filters" : "No notifications yet"}
              description={filtered ? "Clear a filter to see more." : "Alerts about waves, imports, shortages and integrations will appear here."}
              action={filtered ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined} />
          </div>
        ) : (
          <ul className={cn("divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface transition-opacity", list.isFetching && list.isPlaceholderData ? "opacity-60" : "")} aria-busy={list.isFetching}>
            {rows.map((n) => (
              <NotificationItem key={n.id} notification={n} typeLabel={kindGroupLabel(kindGroup(n.kind))} onOpen={() => open(n)}
                onMarkRead={() => markRead.mutate({ ids: [n.id] })} onDelete={() => del.mutate({ ids: [n.id] })} />
            ))}
          </ul>
        )}
        <nav aria-label="Notification pages" className="mt-3 flex flex-wrap items-center justify-end gap-3 text-xs text-secondary">
          <span className="flex items-center gap-1.5">Rows per page
            <span className="w-20"><Select aria-label="Rows per page" value={String(pageSize)} onChange={(v) => { if (v) { setPageSize(Number(v)); setPage(1); } }} options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))} /></span>
          </span>
          <span className="tabular-nums">{rangeLabel(page, pageSize, total)}</span>
          <Button size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span className="tabular-nums">Page {page} / {pages}</span>
          <Button size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </nav>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        variant="danger"
        icon={Trash2}
        title="Delete every read notification?"
        description="Unread notifications are kept. This can't be undone."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        onConfirm={async () => { await del.mutateAsync({ read: true }).catch(() => undefined); setConfirmClear(false); }}
      />
    </div>
  );
}
