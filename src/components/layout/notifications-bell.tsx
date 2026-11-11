"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { apiRequest, type ApiError } from "@/lib/api-client";
import { useApiQuery, type ApiQueryData } from "@/lib/query-client";
import { toast } from "@/components/ui/toast";
import { markReadInCache, type MarkReadInput } from "./notifications-cache";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderIconButton } from "./header-icon-button";
import { NotificationItem, type NotificationView } from "./notification-item";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;
const BELL_PAGE_SIZE = 10;
const BELL_POLL_MS = 60_000;

export type { MarkReadInput };

type NotificationsEntry = ApiQueryData<readonly NotificationView[]>;

/** Marks notifications read optimistically (badge + list update at once), rolls back on error. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation<{ updated: number }, ApiError, MarkReadInput, { readonly snapshot: readonly [QueryKey, NotificationsEntry | undefined][] }>({
    mutationFn: async (input) => (await apiRequest<{ updated: number }>("/api/notifications/read", { method: "POST", body: input })).data,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const snapshot = queryClient.getQueriesData<NotificationsEntry>({ queryKey: NOTIFICATIONS_QUERY_KEY });
      const now = new Date().toISOString();
      queryClient.setQueriesData<NotificationsEntry>({ queryKey: NOTIFICATIONS_QUERY_KEY }, (entry) => markReadInCache(entry, input, now));
      return { snapshot };
    },
    onError: (error, _input, context) => {
      for (const [key, entry] of context?.snapshot ?? []) queryClient.setQueryData(key, entry);
      toast.error("Could not mark as read", error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });
}

/** Header bell: unread badge, latest notifications, mark read / mark all read, deep links. */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const list = useApiQuery<readonly NotificationView[]>(NOTIFICATIONS_QUERY_KEY, "/api/notifications", {
    query: { ps: BELL_PAGE_SIZE },
    refetchInterval: BELL_POLL_MS,
  });
  const markRead = useMarkNotificationsRead();
  const unread = typeof list.data?.meta?.unread === "number" ? list.data.meta.unread : 0;
  const rows = list.data?.data ?? [];

  const openNotification = (n: NotificationView): void => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    if (n.href) {
      setOpen(false);
      router.push(n.href);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <HeaderIconButton label="Notifications" badge={unread > 0 ? unread : undefined}>
          <Bell className="h-4 w-4" aria-hidden />
        </HeaderIconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[380px] flex-col overflow-hidden p-0">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <h2 className="text-base font-semibold text-foreground">Notifications</h2>
          {unread > 0 ? <span className="rounded-full bg-primary-soft px-1.5 text-2xs font-semibold text-primary">{unread} unread</span> : null}
          <button
            type="button"
            disabled={unread === 0 || markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            Mark all read
          </button>
        </div>
        {list.isLoading ? (
          <div className="space-y-2 p-3"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : list.isError ? (
          <p className="px-3 py-6 text-center text-xs text-danger">
            Could not load notifications.{" "}
            <button type="button" className="font-semibold underline" onClick={() => void list.refetch()}>Retry</button>
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-secondary">You&apos;re all caught up.</p>
        ) : (
          <ul className="ks-scroll max-h-[420px] min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
            {rows.map((n) => (
              <NotificationItem key={n.id} notification={n} onOpen={() => openNotification(n)} onMarkRead={() => markRead.mutate({ ids: [n.id] })} compact />
            ))}
          </ul>
        )}
        <div className="shrink-0 border-t border-border bg-surface-sunken px-3 py-2">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-semibold text-primary hover:underline">View all notifications</Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
