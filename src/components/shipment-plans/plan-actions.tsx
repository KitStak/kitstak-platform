"use client";

/**
 * Plan actions shared by the grid and the plan detail page: Delete (Open only, confirm),
 * Ship (confirm, partial results), status change (popover; Cancelled confirms, Shipped
 * routes to Ship), Print Manifest/BOL and Picking/Job operations (create-job-modal).
 */
import * as React from "react";
import { Ban, Trash2, Truck } from "lucide-react";
import type { ShipmentPlanStatus } from "@/lib/enums";
import { isApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { CreateJobModal } from "@/components/shared";
import { bulkToast, useHydratedPermissions, errorMessage, openFileWhenReady, postJson, type BulkOutcome } from "@/components/shipping/shipping-client";
import { PLAN_INVALIDATE, PLAN_PERMS, changeStatus, shipPlans, shipToast, useInvalidatePlans, type PlanRow } from "./plans-client";

type Pending =
  | { readonly kind: "delete"; readonly rows: readonly PlanRow[] }
  | { readonly kind: "ship"; readonly rows: readonly PlanRow[] }
  | { readonly kind: "cancel"; readonly row: PlanRow }
  | null;

export interface PlanActions {
  readonly can: { readonly create: boolean; readonly edit: boolean; readonly delete: boolean; readonly ship: boolean; readonly jobs: boolean; readonly status: boolean; readonly print: boolean };
  readonly deleteReason: (rows: readonly PlanRow[]) => string | null;
  readonly shipReason: (rows: readonly PlanRow[]) => string | null;
  readonly printReason: (rows: readonly PlanRow[]) => string | null;
  readonly jobsReason: (rows: readonly PlanRow[]) => string | null;
  readonly statusReason: (row: PlanRow) => string | null;
  readonly requestDelete: (rows: readonly PlanRow[]) => void;
  readonly requestShip: (rows: readonly PlanRow[]) => void;
  readonly requestStatus: (row: PlanRow, status: ShipmentPlanStatus) => void;
  readonly print: (rows: readonly PlanRow[]) => void;
  readonly openJobs: (rows: readonly PlanRow[]) => void;
  readonly dialogs: React.ReactNode;
}

const noPerm = (what: string) => `You don't have permission to ${what}`;

export function usePlanActions({ onChanged, onDeleted }: { readonly onChanged: () => void; readonly onDeleted?: () => void }): PlanActions {
  const permissions = useHydratedPermissions();
  const invalidate = useInvalidatePlans();
  const [pending, setPending] = React.useState<Pending>(null);
  const [jobIds, setJobIds] = React.useState<readonly string[] | null>(null);
  const can = {
    create: permissions.has(PLAN_PERMS.create), edit: permissions.has(PLAN_PERMS.edit), delete: permissions.has(PLAN_PERMS.delete),
    ship: permissions.has(PLAN_PERMS.ship), jobs: permissions.has(PLAN_PERMS.jobs), status: permissions.has(PLAN_PERMS.status), print: permissions.has(PLAN_PERMS.print),
  };

  const changed = () => {
    invalidate();
    onChanged();
  };

  const deleteReason = (rows: readonly PlanRow[]) => (!can.delete ? noPerm("delete shipment plans") : rows.find((r) => r.deleteBlockedReason)?.deleteBlockedReason ?? null);
  const shipReason = (rows: readonly PlanRow[]) => {
    if (!can.ship) return noPerm("ship shipment plans");
    const bad = rows.find((r) => r.shipBlockedReason);
    return bad ? `${bad.code}: ${bad.shipBlockedReason}` : null;
  };
  const printReason = (rows: readonly PlanRow[]) => {
    if (!can.print) return noPerm("print the Manifest / BOL");
    const empty = rows.find((r) => r.orderCount === 0);
    return empty ? `${empty.code} has no orders to print` : null;
  };
  const jobsReason = (rows: readonly PlanRow[]) => {
    if (!can.jobs) return noPerm("create jobs from shipment plans");
    const closed = rows.find((r) => r.status === "Shipped" || r.status === "Cancelled");
    if (closed) return `${closed.code} is ${closed.status}`;
    const empty = rows.find((r) => r.orderCount === 0);
    return empty ? `${empty.code} has no orders` : null;
  };
  const statusReason = (): string | null => (!can.status ? noPerm("change plan statuses") : null);

  const runStatus = async (row: PlanRow, status: ShipmentPlanStatus) => {
    try {
      const updated = await changeStatus(row.id, status, row.version);
      toast.success("Success", `${updated.code} is now ${updated.status}.`);
      changed();
    } catch (error) {
      toast.error(isApiError(error) && error.code === "CONFLICT" ? "This plan changed since you opened it" : "Couldn't change the status", isApiError(error) && error.code === "CONFLICT" ? "Refresh to see the latest status, then try again." : errorMessage(error));
      if (isApiError(error) && error.code === "CONFLICT") onChanged();
    }
  };

  const requestStatus = (row: PlanRow, status: ShipmentPlanStatus) => {
    if (status === "Shipped") setPending({ kind: "ship", rows: [row] });
    else if (status === "Cancelled") setPending({ kind: "cancel", row });
    else void runStatus(row, status);
  };

  const print = async (rows: readonly PlanRow[]) => {
    try {
      const result = await openFileWhenReady(() => postJson<{ fileId: string; count: number }>("/api/shipment-plans/print", { ids: rows.map((r) => r.id) }));
      toast.success("Success", `Manifest / BOL ready for ${result.count} ${result.count === 1 ? "plan" : "plans"}.`);
    } catch (error) {
      toast.error("Couldn't print the Manifest / BOL", errorMessage(error));
    }
  };

  const planTable = (rows: readonly PlanRow[]) => ({
    columns: [{ key: "code", label: "Plan code" }, { key: "status", label: "Status" }, { key: "orders", label: "Orders" }, { key: "loaded", label: "Loaded" }, { key: "planned", label: "Planned shipment" }],
    rows: rows.map((r) => ({ code: r.code, status: <StatusPill status={r.status} domain="shipmentPlan" />, orders: r.orderCount, loaded: `${r.loadedCount} of ${r.orderCount}`, planned: r.plannedShipmentAt ? formatDateTime(r.plannedShipmentAt) : "—" })),
  });

  const close = () => setPending(null);
  const shipRows = pending?.kind === "ship" ? pending.rows : [];
  const notReady = shipRows.reduce((s, r) => s + Math.max(0, r.orderCount - r.loadedCount), 0);

  const dialogs = (
    <>
      <ConfirmDialog
        open={pending?.kind === "delete"}
        onOpenChange={(o) => (o ? undefined : close())}
        variant="danger"
        icon={Trash2}
        title={pending?.kind === "delete" && pending.rows.length > 1 ? `Delete ${pending.rows.length} shipment plans?` : "Delete this shipment plan?"}
        description="The plan and its order links are removed; the orders themselves are not changed. The change log keeps a Delete entry."
        records={pending?.kind === "delete" ? planTable(pending.rows) : undefined}
        cancelLabel="No"
        confirmLabel="Yes, delete"
        onConfirm={async () => {
          if (pending?.kind !== "delete") return;
          const rows = pending.rows;
          try {
            const result = await postJson<BulkOutcome>("/api/shipment-plans/delete", { ids: rows.map((r) => r.id) });
            bulkToast(result, "deleted", ["shipment plan", "shipment plans"], new Map(rows.map((r) => [r.id, r.code])));
            changed();
            if (result.succeeded.length > 0) onDeleted?.();
          } catch (error) {
            toast.error("Delete failed", errorMessage(error));
          }
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "ship"}
        onOpenChange={(o) => (o ? undefined : close())}
        variant="attention"
        icon={Truck}
        title={shipRows.length > 1 ? `Ship ${shipRows.length} shipment plans?` : "Ship this shipment plan?"}
        description={`Every Ready to Ship order in the ${shipRows.length > 1 ? "plans" : "plan"} is shipped and leaves inventory. ${notReady > 0 ? `${notReady} ${notReady === 1 ? "order isn't" : "orders aren't"} Ready to Ship yet and will be reported, not shipped. ` : ""}A plan becomes Shipped once all of its orders are.`}
        records={planTable(shipRows)}
        cancelLabel="No"
        confirmLabel="Yes, ship"
        onConfirm={async () => {
          try {
            shipToast(await shipPlans(shipRows.map((r) => r.id)));
          } catch (error) {
            toast.error("Ship failed", errorMessage(error));
          }
          changed();
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "cancel"}
        onOpenChange={(o) => (o ? undefined : close())}
        variant="danger"
        icon={Ban}
        title="Cancel this shipment plan?"
        description="The plan moves to Cancelled and becomes read-only. Its orders are released and can join another plan."
        records={pending?.kind === "cancel" ? planTable([pending.row]) : undefined}
        cancelLabel="No"
        confirmLabel="Yes, cancel plan"
        onConfirm={() => (pending?.kind === "cancel" ? runStatus(pending.row, "Cancelled") : undefined)}
      />
      {jobIds ? (
        <CreateJobModal open onOpenChange={(o) => (o ? undefined : setJobIds(null))} operation="shipment-plan" ids={jobIds} invalidate={PLAN_INVALIDATE} onDone={() => { setJobIds(null); changed(); }} />
      ) : null}
    </>
  );

  return {
    can, deleteReason, shipReason, printReason, jobsReason, statusReason,
    requestDelete: (rows) => setPending({ kind: "delete", rows }),
    requestShip: (rows) => setPending({ kind: "ship", rows }),
    requestStatus,
    print: (rows) => void print(rows),
    openJobs: (rows) => setJobIds(rows.map((r) => r.id)),
    dialogs,
  };
}
