"use client";

/**
 * Task Details actions (Logiwa 02 §7a): Task Operations ▾ (Execute / Update / Cancel) and
 * User Actions ▾ (Assign / Unassign). Used by the Order Operations and Replenishment tabs
 * and by the Tasks tab of the job detail page.
 *
 * Execute is the supervisor force-complete in a right-side drawer (as in Logiwa): Target location*, Target LPN and (single task)
 * Quantity. A quantity below the remaining task quantity is a partial execute: the domain
 * writes a missing-log row and sets Pick Short Status to Open.
 */
import * as React from "react";
import { Ban, ChevronDown, RotateCcw, Pencil, Play, UserMinus, UserPlus, Users, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { showToast, toast } from "@/components/ui/toast";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/lib/query-client";
import type { PickShortPreview } from "@/server/repositories/tasks-pick-short";
import { DisabledReason } from "@/components/ui/tooltip";
import { errorTextClass, labelClass } from "@/components/ui/control-styles";
import { JobPicker, LocationPicker, LpPicker } from "@/components/shared";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { bulkToast, errorMessage, plural, postJson, type BulkOutcome } from "@/components/jobs/jobs-client";
import { targetHint } from "@/lib/grid-defs/jobs/copy";
import { AssignUserModal, DifferentWarehousesDialog } from "@/components/jobs/job-modals";

export const TASK_PERMS = {
  execute: "fulfillment.task_details.execute_task",
  update: "fulfillment.task_details.update_task",
  cancel: "fulfillment.task_details.cancel_task",
} as const;

export interface TaskFacts {
  readonly id: string;
  readonly taskNo: number;
  readonly status: string;
  readonly taskType: string;
  readonly warehouseId: string;
  readonly assigneeUserId: string | null;
  readonly plannedQty: number;
  readonly actualQty: number;
  readonly sku?: string | null;
  readonly sourceLocation?: string | null;
  readonly jobId?: string;
  readonly jobCode?: string | null;
  /** Replenishment grid only. */
  readonly replenishmentPhase?: string | null;
  readonly targetLocation?: string | null;
  readonly sourceLpn?: string | null;
  /** Count grid only: the count plan line this task counts (Create Recount target). */
  readonly countLineId?: string | null;
}

/** Create Recount permissions (Count Location / SKU Details). */
const COUNT_RECOUNT_PERMS = ["inventory.count_location_details.create_recount", "inventory.count_sku_details.create_recount"] as const;

const OPEN = new Set(["Pending", "Started"]);

/**
 * Critic R4: replenishment cancel semantics (no order, allocation or pack/sort/load cascade).
 * Nothing is reserved for a pending replenishment move, so cancelling only stops the move;
 * what stays where depends on the phase.
 */

export function replenishmentCancelCopy(tasks: readonly Pick<TaskFacts, "replenishmentPhase">[]): string {
  const phases = new Set(tasks.map((t) => t.replenishmentPhase ?? "Direct Put"));
  const parts = ["No stock moves and nothing is reserved for a pending replenishment, so cancelling only stops the move; the job completes when its other tasks are done."];
  if (phases.has("Replenishment Pick Phase") || phases.has("Direct Put")) {
    parts.push("Pick phase / direct put: the stock stays in its source location and LP, the target pick location is not replenished, and no put phase is created.");
  }
  if (phases.has("Replenishment Put Phase")) {
    parts.push("Put phase: the units already picked stay in the location and LP the pick phase moved them to; move them with a manual movement or a new replenishment.");
  }
  return parts.join(" ");
}

interface ExecuteResult { readonly taskId: string; readonly doneQty: number; readonly shortQty: number; readonly resolutionJobId: string | null; readonly resolutionJobCode?: string | null }

function resolutionHint(p: PickShortPreview | undefined): string | null {
  if (!p) return null;
  if (!p.eligible) return "Only picking tasks tied to an order line can get a resolution job.";
  if (p.retainsAllocation) return "This client retains the allocation during missing, so the short stays allocated at the source for investigation.";
  if (p.preventsReallocation) return "This client prevents reallocation of missing stock.";
  if (p.freeElsewhere <= 0) return "No free stock of this SKU elsewhere in the warehouse; the order stays pick short.";
  return null;
}

function ExecuteDrawer({ tasks, open, onClose, onDone }: { readonly tasks: readonly TaskFacts[]; readonly open: boolean; readonly onClose: () => void; readonly onDone: () => void }) {
  const single = tasks.length === 1 ? tasks[0] : undefined;
  const remaining = single ? Math.max(0, single.plannedQty - single.actualQty) : 0;
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [lpId, setLpId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState<number | null>(remaining);
  const [resolution, setResolution] = React.useState(false);
  const [resolutionTouched, setResolutionTouched] = React.useState(false);
  const router = useRouter();
  // Critic R5: Logiwa-style pick-short — the toggle defaults ON when free stock exists elsewhere.
  const preview = useApiQuery<PickShortPreview>(["task", "pick-short-preview", single?.id ?? ""], open && single && single.taskType === "Picking" ? `/api/tasks/${encodeURIComponent(single.id)}/pick-short-preview` : null, { retry: false, timeoutMs: 20_000, staleTime: 15_000 });
  const pv = preview.data?.data;
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setLocationId(null);
    setLpId(null);
    setQty(remaining);
    setResolution(false);
    setResolutionTouched(false);
    setTouched(false);
    setServerError(null);
  }, [open, remaining]);
  const partial = single !== undefined && qty !== null && qty < remaining;
  // Until the user flips it, the toggle follows the server suggestion (free stock elsewhere).
  const resolutionOn = resolutionTouched ? resolution : Boolean(pv?.suggestResolution);
  const canResolve = pv ? pv.eligible && !pv.retainsAllocation && !pv.preventsReallocation : single?.taskType === "Picking";
  const locError = touched && !locationId ? "Choose the target location" : null;
  const qtyError = single && (qty === null || qty < 0 || qty > remaining) ? `Enter 0 to ${remaining}` : null;
  const execute = async () => {
    setTouched(true);
    if (!locationId || qtyError) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await postJson<BulkOutcome & { readonly results: readonly ExecuteResult[] }>("/api/tasks/actions", {
        action: "execute", ids: tasks.map((t) => t.id), targetLocationId: locationId, targetLpId: lpId, ...(single ? { qty: qty ?? 0, createResolutionJob: partial && canResolve && resolutionOn } : {}),
      });
      const short = res.results.reduce((s, r) => s + r.shortQty, 0);
      const resolved = res.results.find((r) => r.resolutionJobId);
      if (resolved?.resolutionJobId) {
        const href = `/jobs/${encodeURIComponent(resolved.resolutionJobId)}`;
        showToast({ variant: "warning", title: "Pick short · resolution job created", message: `${plural(short, "unit")} short. ${resolved.resolutionJobCode ?? "A resolution job"} re-picks from another location; the order stays flagged Pick short until it is picked.`, action: { label: "Open job", onClick: () => router.push(href) }, duration: 10_000 });
      } else if (short > 0) {
        toast.warning("Executed with a pick short", `${plural(short, "unit")} short. A missing-log row was written, Pick Short Status is Open and the order is flagged Pick short.`);
      } else toast.success("Success", `${plural(tasks.length, "task")} executed`);
      onDone();
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const dirty = Boolean(locationId || lpId || (single && qty !== remaining));
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => (o ? undefined : onClose())}
      width={35}
      dirty={dirty && !saving}
      title="Execute task"
      description={`Task ID(s) ${tasks.map((t) => t.taskNo).join(", ")}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void execute()} disabled={saving} aria-busy={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" label="Executing" /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            Execute
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void execute(); }} noValidate>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead className="bg-surface-sunken">
              <tr>
                {["Task ID", "Type", "SKU", "Source", "Remaining"].map((h) => (
                  <th key={h} scope="col" className="border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-faint">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, 8).map((t) => (
                <tr key={t.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-1.5 tabular-nums">{t.taskNo}</td>
                  <td className="px-3 py-1.5">{t.taskType}</td>
                  <td className="px-3 py-1.5 font-medium">{t.sku ?? "—"}</td>
                  <td className="px-3 py-1.5">{t.sourceLocation ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{Math.max(0, t.plannedQty - t.actualQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tasks.length > 8 ? <p className="border-t border-border bg-surface-sunken px-3 py-1.5 text-[11px] text-faint">+{tasks.length - 8} more</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="exec-location">Target location <span className="text-danger">*</span></label>
          <LocationPicker id="exec-location" warehouseId={tasks[0]?.warehouseId ?? null} value={locationId} onChange={(v) => setLocationId(v)} placeholder="Select target location" invalid={Boolean(locError)} />
          {locError ? <p className={errorTextClass}>{locError}</p> : <p className="text-[11px] text-faint">{targetHint(tasks.map((t) => t.taskType))}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="exec-lp">Target LPN</label>
          <LpPicker id="exec-lp" warehouseId={tasks[0]?.warehouseId ?? null} value={lpId} onChange={(v) => setLpId(v)} placeholder="Select target LPN" />
        </div>
        {single ? (
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="exec-qty">Quantity</label>
            <NumberInput id="exec-qty" value={qty} min={0} max={remaining} onChange={(v) => setQty(v)} invalid={Boolean(qtyError)} />
            <p className="text-[11px] text-faint">{single.sku ? `${single.sku} · ` : ""}{remaining} remaining{single.sourceLocation ? ` at ${single.sourceLocation}` : ""}</p>
            {qtyError ? <p className={errorTextClass}>{qtyError}</p> : null}
          </div>
        ) : (
          <p className="text-[12px] text-secondary">Every selected task is executed for its full remaining quantity.</p>
        )}
        {partial ? (
          <Callout variant="attention" title={`Partial execute: ${plural(remaining - (qty ?? 0), "unit")} short`}>
            <div className="flex flex-col gap-2">
              <span>A missing-log row is written, Pick Short Status becomes Open and the order is flagged Pick short.</span>
              <label className="flex items-center gap-2 text-[12px] font-medium text-body">
                <Switch checked={resolutionOn && canResolve} disabled={!canResolve} onCheckedChange={(v) => { setResolutionTouched(true); setResolution(v); }} aria-label="Create a resolution job" data-testid="exec-resolution-toggle" />
                Create a resolution job to re-pick from another location
              </label>
              {preview.isPending && single?.taskType === "Picking" ? <span className="text-[11px] text-faint">Checking stock in other locations…</span> : null}
              {pv && canResolve && pv.freeElsewhere > 0 ? (
                <span className="text-[11px] text-secondary" data-testid="exec-free-elsewhere">
                  {plural(pv.freeElsewhere, "unit")} free in {pv.locations.map((l) => `${l.code} (${l.free})`).join(", ")}{pv.sourceLocation ? ` · excluding ${pv.sourceLocation}` : ""}.
                  {!resolutionOn ? " Without a resolution job the order ships short." : ""}
                </span>
              ) : null}
              {resolutionHint(pv) ? <span className="text-[11px] text-secondary">{resolutionHint(pv)}</span> : null}
              {preview.error ? <span className="text-[11px] text-faint">Couldn&apos;t check other locations; you can still create a resolution job.</span> : null}
            </div>
          </Callout>
        ) : null}
        {serverError ? <Callout variant="error" title="Couldn't execute">{serverError}</Callout> : null}
      </form>
    </Drawer>
  );
}

function UpdateModal({ task, open, onClose, onDone }: { readonly task: TaskFacts | undefined; readonly open: boolean; readonly onClose: () => void; readonly onDone: () => void }) {
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [lpId, setLpId] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setLocationId(null);
    setLpId(null);
    setJobId(null);
    setServerError(null);
  }, [open]);
  const changed = Boolean(locationId || lpId || (jobId && jobId !== task?.jobId));
  const save = async () => {
    if (!task || !changed) return;
    setSaving(true);
    setServerError(null);
    try {
      await postJson<BulkOutcome>("/api/tasks/actions", {
        action: "update", ids: [task.id], ...(locationId ? { targetLocationId: locationId } : {}), ...(lpId ? { targetLpId: lpId } : {}), ...(jobId && jobId !== task.jobId ? { moveToJobId: jobId } : {}),
      });
      toast.success("Success", `Task ${task.taskNo} updated`);
      onDone();
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader title="Update task" description={task ? `Task ID ${task.taskNo}${task.jobCode ? ` · ${task.jobCode}` : ""}` : undefined} />
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="upd-location">Target location</label>
            <LocationPicker id="upd-location" warehouseId={task?.warehouseId ?? null} value={locationId} onChange={(v) => setLocationId(v)} placeholder="Select inventory location" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="upd-lp">To LPN</label>
            <LpPicker id="upd-lp" warehouseId={task?.warehouseId ?? null} value={lpId} onChange={(v) => setLpId(v)} placeholder="Select inventory LP" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="upd-job">Job code</label>
            <JobPicker id="upd-job" status={["Pending", "Started"]} value={jobId} onChange={(v) => setJobId(v)} placeholder="Search job code" />
            <p className="text-[11px] text-faint">Moves the task (and its allocation) to another open job of the same warehouse.</p>
          </div>
          {serverError ? <Callout variant="error" title="Couldn't update">{serverError}</Callout> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <DisabledReason reason={changed ? null : "Change at least one field"}>
            <Button variant="primary" onClick={() => void save()} disabled={!changed || saving} aria-busy={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
              Save
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskActions({ tasks, onChanged, mode = "order" }: { readonly tasks: readonly TaskFacts[]; readonly onChanged: () => void; readonly mode?: "order" | "replenishment" | "count" }) {
  const { permissions } = usePermissionSet();
  const [modal, setModal] = React.useState<null | "execute" | "update" | "cancel" | "assign" | "unassign" | "warehouses" | "recount">(null);
  const none = tasks.length === 0 ? "Select at least one task" : null;
  const perm = (key: keyof typeof TASK_PERMS) => (permissions.has(TASK_PERMS[key]) ? null : "You don't have permission for this action");
  const open = tasks.filter((t) => OPEN.has(t.status));
  const pending = tasks.filter((t) => t.status === "Pending");
  const ids = tasks.map((t) => t.id);
  const codes = new Map(tasks.map((t) => [t.id, `Task ${t.taskNo}`]));
  const multiWarehouse = new Set(tasks.map((t) => t.warehouseId)).size > 1;
  const executeReason = none ?? perm("execute") ?? (open.length !== tasks.length ? "Only pending or started tasks can be executed" : multiWarehouse ? "Select tasks of one warehouse" : null);
  const updateReason = none ?? perm("update") ?? (tasks.length !== 1 ? "Select exactly one task to update" : pending.length !== 1 ? "Only pending tasks can be updated" : null);
  const cancelReason = none ?? perm("cancel") ?? (pending.length === 0 ? "Only pending tasks can be cancelled" : null);
  const assignReason = none ?? perm("update") ?? (open.length === 0 ? "Closed tasks can't be assigned" : null);
  const unassignReason = none ?? perm("update") ?? (tasks.some((t) => t.assigneeUserId) ? null : "None of the selected tasks is assigned");

  const call = async (action: string, extra: Record<string, unknown>, verb: string, only: readonly string[] = ids) => {
    try {
      const res = await postJson<BulkOutcome & { readonly message?: string }>("/api/tasks/actions", { action, ids: only, ...extra });
      if (res.failed.length === 0 && res.message) toast.success("Success", res.message);
      else bulkToast(res, "task", verb, codes);
      onChanged();
    } catch (error) {
      toast.error("Action failed", errorMessage(error));
      throw error;
    }
  };

  const cancelDialog = (
    <ConfirmDialog
      open={modal === "cancel"}
      onOpenChange={(o) => (o ? undefined : setModal(null))}
      variant="danger"
      title={`Cancel ${plural(pending.length, "task")}?`}
      description={mode === "replenishment" ? replenishmentCancelCopy(pending) : "Cancelled picking tasks release their allocation and reduce or cancel the matching packing, sorting and loading tasks. An order with no picking left goes back to Open; a partly cancelled order is flagged pick short. Started and completed tasks are skipped."}
      records={mode === "replenishment"
        ? { columns: [{ key: "no", label: "Task ID" }, { key: "phase", label: "Phase" }, { key: "sku", label: "SKU" }, { key: "from", label: "Source" }, { key: "to", label: "Target" }, { key: "lp", label: "LP" }], rows: pending.map((t) => ({ no: t.taskNo, phase: t.replenishmentPhase ?? "—", sku: t.sku ?? "", from: t.sourceLocation ?? "—", to: t.targetLocation ?? "—", lp: t.sourceLpn ?? "—" })) }
        : { columns: [{ key: "no", label: "Task ID" }, { key: "type", label: "Type" }, { key: "sku", label: "SKU" }, { key: "status", label: "Status" }], rows: pending.map((t) => ({ no: t.taskNo, type: t.taskType, sku: t.sku ?? "", status: <StatusPill status={t.status} domain="task" size="sm" /> })) }}
      cancelLabel="Keep tasks"
      confirmLabel={pending.length === 1 ? "Cancel task" : "Cancel tasks"}
      onConfirm={() => call("cancel", {}, "cancelled", pending.map((t) => t.id))}
    />
  );

  // Hide controls the role can never use (same rule as Job Management).
  const canOps = permissions.has(TASK_PERMS.execute) || permissions.has(TASK_PERMS.update) || permissions.has(TASK_PERMS.cancel);
  const canUsers = permissions.has(TASK_PERMS.update);

  if (mode === "count") {
    const canRecount = COUNT_RECOUNT_PERMS.some((p) => permissions.has(p));
    if (!canOps && !canUsers && !canRecount) return null;
    const lineIds = [...new Set(tasks.map((t) => t.countLineId).filter((v): v is string => Boolean(v)))];
    const counted = tasks.filter((t) => t.status === "Completed" && t.countLineId);
    const recountReason = none ?? (counted.length !== tasks.length ? "Only completed count tasks can be recounted" : null);
    const recount = async () => {
      try {
        const res = await postJson<Partial<BulkOutcome> & { readonly message?: string }>("/api/counts/lines/recount", { ids: lineIds });
        const failed = res.failed ?? [];
        if (failed.length === 0) toast.success("Success", res.message ?? `Recount created for ${plural(lineIds.length, "count line")}`);
        else toast.warning("Recount partly created", failed.map((f) => f.message).join(" "));
        onChanged();
      } catch (error) {
        toast.error("Action failed", errorMessage(error));
        throw error;
      }
    };
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {permissions.has(TASK_PERMS.cancel) ? (
          <DisabledReason reason={cancelReason}>
            <Button variant="secondary" disabled={Boolean(cancelReason)} onClick={() => setModal("cancel")}>
              <Ban className="h-3.5 w-3.5" aria-hidden />
              Cancel
            </Button>
          </DisabledReason>
        ) : null}
        {canUsers ? (
          <DropdownMenu>
            <DisabledReason reason={none}>
              <DropdownMenuTrigger asChild disabled={Boolean(none)}>
                <Button variant="secondary" disabled={Boolean(none)}>
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  Assign
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </DisabledReason>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuItem icon={UserPlus} disabledReason={assignReason} onSelect={() => setModal(multiWarehouse ? "warehouses" : "assign")}>Assign</DropdownMenuItem>
              <DropdownMenuItem icon={UserMinus} disabledReason={unassignReason} onSelect={() => setModal(multiWarehouse ? "warehouses" : "unassign")}>Unassign</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canRecount ? (
          <DisabledReason reason={recountReason}>
            <Button variant="secondary" disabled={Boolean(recountReason)} onClick={() => setModal("recount")}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Recount
            </Button>
          </DisabledReason>
        ) : null}
        <AssignUserModal open={modal === "assign"} noun="task(s)" warehouseId={tasks[0]?.warehouseId ?? null} onClose={() => setModal(null)} onAssign={(userId) => call("assign", { userId }, "assigned")} />
        <DifferentWarehousesDialog open={modal === "warehouses"} noun="tasks" onClose={() => setModal(null)} />
        <ConfirmDialog
          open={modal === "unassign"}
          onOpenChange={(o) => (o ? undefined : setModal(null))}
          variant="attention"
          title="Unassign the selected tasks?"
          cancelLabel="Keep assigned"
          confirmLabel="Unassign"
          onConfirm={() => call("unassign", {}, "unassigned")}
        />
        <ConfirmDialog
          open={modal === "recount"}
          onOpenChange={(o) => (o ? undefined : setModal(null))}
          variant="attention"
          title={`Create a recount for ${plural(lineIds.length, "count line")}?`}
          description="Each counted line is marked Recount Created and a new count task is planned for the same location. If the recount is cancelled, the original result can still be posted."
          cancelLabel="Go back"
          confirmLabel="Create recount"
          onConfirm={() => recount()}
        />
        {cancelDialog}
      </span>
    );
  }

  if (!canOps && !canUsers) return null;

  if (mode === "replenishment") {
    if (!permissions.has(TASK_PERMS.cancel)) return null;
    return (
      <span className="flex items-center gap-1.5">
        <DisabledReason reason={cancelReason}>
          <Button variant="secondary" disabled={Boolean(cancelReason)} onClick={() => setModal("cancel")}>
            <Ban className="h-3.5 w-3.5" aria-hidden />
            Cancel task
          </Button>
        </DisabledReason>
        {cancelDialog}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      {canOps ? (
      <DropdownMenu>
        <DisabledReason reason={none}>
          <DropdownMenuTrigger asChild disabled={Boolean(none)}>
            <Button variant="secondary" disabled={Boolean(none)}>
              <Wrench className="h-3.5 w-3.5" aria-hidden />
              Task operations
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuItem icon={Play} disabledReason={executeReason} description="Force-complete from the desktop" onSelect={() => setModal("execute")}>Execute</DropdownMenuItem>
          <DropdownMenuItem icon={Pencil} disabledReason={updateReason} description="Target location, LPN or job" onSelect={() => setModal("update")}>Update</DropdownMenuItem>
          <DropdownMenuItem icon={Ban} destructive disabledReason={cancelReason} onSelect={() => setModal("cancel")}>Cancel</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}
      {canUsers ? (
      <DropdownMenu>
        <DisabledReason reason={none}>
          <DropdownMenuTrigger asChild disabled={Boolean(none)}>
            <Button variant="secondary" disabled={Boolean(none)}>
              <Users className="h-3.5 w-3.5" aria-hidden />
              User actions
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem icon={UserPlus} disabledReason={assignReason} onSelect={() => setModal(multiWarehouse ? "warehouses" : "assign")}>Assign</DropdownMenuItem>
          <DropdownMenuItem icon={UserMinus} disabledReason={unassignReason} onSelect={() => setModal(multiWarehouse ? "warehouses" : "unassign")}>Unassign</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}
      <ExecuteDrawer tasks={tasks} open={modal === "execute"} onClose={() => setModal(null)} onDone={onChanged} />
      <UpdateModal task={tasks[0]} open={modal === "update"} onClose={() => setModal(null)} onDone={onChanged} />
      <AssignUserModal open={modal === "assign"} noun="task(s)" warehouseId={tasks[0]?.warehouseId ?? null} onClose={() => setModal(null)} onAssign={(userId) => call("assign", { userId }, "assigned")} />
      <DifferentWarehousesDialog open={modal === "warehouses"} noun="tasks" onClose={() => setModal(null)} />
      <ConfirmDialog
        open={modal === "unassign"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="attention"
        title="Unassign the selected tasks?"
        cancelLabel="Keep assigned"
        confirmLabel="Unassign"
        onConfirm={() => call("unassign", {}, "unassigned")}
      />
      {cancelDialog}
    </span>
  );
}
