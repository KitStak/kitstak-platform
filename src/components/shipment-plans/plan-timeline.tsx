"use client";

/**
 * Plan timeline: the shared change-log history with ISO date-times in messages rendered in the
 * viewer's local format (the change log stores "Loading Started At is modified. — --> 2026-11-10T04:50:27.680Z").
 * Shared ActivityTimeline localisation is requested in docs/requests/shipping.md; this keeps the plan page consistent now.
 */
import * as React from "react";
import { PencilLine, FilePlus2, Trash2, ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { useApiQuery } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { SkeletonText } from "@/components/ui/skeleton";
import { buildTimeline } from "@/components/shared/activity-timeline";
import { changeLogEntrySchema, parseList } from "@/components/shared/contracts";
import { humanizePlanChange, localizeIsoInText } from "./plan-form-model";

const KIND = {
  Create: { icon: FilePlus2, dot: "bg-success text-white" },
  Update: { icon: PencilLine, dot: "bg-info text-white" },
  Delete: { icon: Trash2, dot: "bg-danger text-white" },
  Ledger: { icon: ArrowLeftRight, dot: "bg-primary text-white" },
} as const;

export function PlanTimeline({ planId, limit = 20 }: { readonly planId: string; readonly limit?: number }) {
  const fmt = useFormat();
  const [shown, setShown] = React.useState(limit);
  const q = useApiQuery<unknown>(["change-log", "shipment_plan", planId, "timeline"], "/api/change-log", { query: { entityType: "shipment_plan", entityId: planId, ps: 200 } });
  if (q.isPending) return <SkeletonText lines={5} />;
  if (q.error) return <p className="text-xs text-danger">Activity could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Retry</button></p>;
  const items = buildTimeline(parseList(changeLogEntrySchema, q.data?.data), []);
  if (items.length === 0) return <p className="text-xs text-faint">No activity recorded for this plan yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ol className="relative flex flex-col gap-4 pl-1" aria-label="Activity">
        <span className="absolute bottom-2 left-[13px] top-2 w-px bg-border" aria-hidden />
        {items.slice(0, shown).map((item) => {
          const meta = KIND[item.kind];
          const Icon = meta.icon;
          return (
            <li key={item.id} className="relative flex gap-3">
              <span className={cn("z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface", meta.dot)}><Icon className="h-3 w-3" aria-hidden /></span>
              <div className="min-w-0 pt-0.5">
                <p className="break-words text-sm text-body">{localizeIsoInText(humanizePlanChange(item.title), (iso) => fmt.gridDateTime(iso))}</p>
                <p className="text-2xs text-faint">{fmt.gridDateTime(item.at)} · {item.source}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {items.length > shown ? <Button variant="ghost" size="sm" className="self-start" onClick={() => setShown(shown + 50)}>Show more ({items.length - shown})</Button> : null}
    </div>
  );
}
