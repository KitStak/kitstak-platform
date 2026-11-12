"use client";

/**
 * Activity timeline (BUILD_PLAN F4.4) built from real history only: `change_log`
 * (`GET /api/change-log`) merged with ledger transactions from `ledgerPath` (e.g.
 * `/api/inventory/transactions?…`, `[{ id, type, quantity, at, source, sku?, detail? }]`).
 * Never synthesised: when both sources are empty the empty state says so.
 */
import * as React from "react";
import { z } from "zod";
import { ArrowLeftRight, FilePlus2, PencilLine, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { changeLogEntrySchema, parseList, type ChangeLogEntry } from "./contracts";
import { changeLogMessage, useChangeLogTime, type ChangeLogMessageOptions } from "./change-log-drawer";

export const ledgerEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  quantity: z.number(),
  at: z.string(),
  source: z.string().nullish(),
  sku: z.string().nullish(),
  detail: z.string().nullish(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export interface TimelineItem {
  readonly id: string;
  readonly kind: "Create" | "Update" | "Delete" | "Ledger";
  readonly at: string;
  readonly title: string;
  readonly source: string;
}

export function buildTimeline(changes: readonly ChangeLogEntry[], ledger: readonly LedgerEntry[], options: ChangeLogMessageOptions = {}): readonly TimelineItem[] {
  const fromChanges = changes.map<TimelineItem>((c) => ({ id: `c:${c.id}`, kind: c.type, at: c.at, title: changeLogMessage(c, options), source: c.userName || c.source }));
  const fromLedger = ledger.map<TimelineItem>((l) => ({
    id: `l:${l.id}`,
    kind: "Ledger",
    at: l.at,
    title: `${l.type}${l.sku ? ` · ${l.sku}` : ""}: ${l.quantity > 0 ? "+" : ""}${l.quantity}${l.detail ? ` (${l.detail})` : ""}`,
    source: l.source ?? "System",
  }));
  return [...fromChanges, ...fromLedger].sort((a, b) => b.at.localeCompare(a.at));
}

const KIND_META = {
  Create: { icon: FilePlus2, dot: "bg-success text-white" },
  Update: { icon: PencilLine, dot: "bg-info text-white" },
  Delete: { icon: Trash2, dot: "bg-danger text-white" },
  Ledger: { icon: ArrowLeftRight, dot: "bg-primary text-white" },
} as const;

const PAGE = 50;

export function ActivityTimeline({ entityType, entityId, ledgerPath, limit = PAGE, timeZone }: { readonly entityType: string; readonly entityId: string; readonly ledgerPath?: string; readonly limit?: number; /** IANA zone: times render there with a zone suffix. */ readonly timeZone?: string | null }) {
  const timeOf = useChangeLogTime(timeZone);
  const [shown, setShown] = React.useState(limit);
  const changes = useApiQuery<unknown>(["change-log", entityType, entityId, "timeline"], "/api/change-log", { query: { entityType, entityId, ps: 200 } });
  const ledger = useApiQuery<unknown>(["timeline-ledger", ledgerPath ?? ""], ledgerPath ?? null);
  const items = buildTimeline(parseList(changeLogEntrySchema, changes.data?.data), parseList(ledgerEntrySchema, ledger.data?.data), { formatIso: timeOf });
  const loading = changes.isPending || (Boolean(ledgerPath) && ledger.isPending);

  if (loading) return <SkeletonText lines={5} />;
  if (changes.error) {
    return (
      <p className="text-xs text-danger">
        Activity could not be loaded.{" "}
        <button type="button" className="font-semibold underline" onClick={() => void changes.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  if (items.length === 0) return <p className="text-xs text-faint">No activity recorded for this record yet.</p>;

  return (
    <div className="flex flex-col gap-2">
      <ol className="relative flex flex-col gap-4 pl-1" aria-label="Activity">
        <span className="absolute bottom-2 left-[13px] top-2 w-px bg-border" aria-hidden />
        {items.slice(0, shown).map((item) => {
          const meta = KIND_META[item.kind];
          const Icon = meta.icon;
          return (
            <li key={item.id} className="relative flex gap-3">
              <span className={cn("z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface", meta.dot)}>
                <Icon className="h-3 w-3" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="break-words text-sm text-body">{item.title}</p>
                <p className="text-2xs text-faint">
                  {timeOf(item.at)} · {item.source}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > shown ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown(shown + PAGE)}>
          Show more ({items.length - shown})
        </Button>
      ) : null}
    </div>
  );
}
