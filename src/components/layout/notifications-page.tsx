"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SkeletonText } from "@/components/ui/skeleton";
import { NotificationItem, type NotificationView } from "./notification-item";
import { NOTIFICATIONS_QUERY_KEY, useMarkNotificationsRead } from "./notifications-bell";
import { PageHeader } from "./page-header";

const PAGE_SIZE = 25;
type Filter = "all" | "unread";

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** `/notifications`: full, paged notification inbox with unread filter and mark-all-read. */
export function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [page, setPage] = React.useState(1);
  const list = useApiQuery<readonly NotificationView[]>(NOTIFICATIONS_QUERY_KEY, "/api/notifications", {
    query: { page, ps: PAGE_SIZE, unread: filter === "unread" ? "true" : "false" },
    placeholderData: (previous) => previous,
  });
  const markRead = useMarkNotificationsRead();
  const rows = list.data?.data ?? [];
  const total = list.data?.meta?.total ?? 0;
  const unread = typeof list.data?.meta?.unread === "number" ? list.data.meta.unread : 0;
  const pages = pageCount(total, PAGE_SIZE);

  const open = (n: NotificationView): void => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    if (n.href) router.push(n.href);
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Notifications"
        helper="Wave completions, failed imports, shortages and other alerts for your account."
        actions={
          <Button variant="primary" disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            <CheckCheck className="h-4 w-4" aria-hidden />
            Mark all read
          </Button>
        }
      />
      <div className="px-6 py-4">
        <div className="mb-3 flex items-center gap-3">
          <SegmentedControl<Filter>
            ariaLabel="Filter notifications"
            value={filter}
            onChange={(v) => { setFilter(v); setPage(1); }}
            options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread (${unread})` }]}
          />
          <span className="text-[12px] text-faint">Total: {total}</span>
        </div>
        {list.isError ? (
          <Callout variant="error" title="Could not load notifications" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>}>{list.error.message}</Callout>
        ) : list.isLoading ? (
          <div className="rounded-lg border border-border bg-surface p-4"><SkeletonText lines={6} /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface">
            <EmptyState icon={BellOff} title={filter === "unread" ? "No unread notifications" : "No notifications yet"} description="Alerts about waves, imports, shortages and integrations will appear here." />
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {rows.map((n) => (
              <NotificationItem key={n.id} notification={n} onOpen={() => open(n)} onMarkRead={() => markRead.mutate({ ids: [n.id] })} />
            ))}
          </ul>
        )}
        {pages > 1 ? (
          <nav aria-label="Notification pages" className="mt-3 flex items-center justify-end gap-2 text-[12px] text-secondary">
            <Button size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
            <span>Page {page} / {pages}</span>
            <Button size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
