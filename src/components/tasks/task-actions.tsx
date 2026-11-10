"use client";

/**
 * Task Details actions (Logiwa 02 §7a): Task Operations ▾ (Execute / Update / Cancel) and
 * User Actions ▾ (Assign / Unassign). Used by the Order Operations and Replenishment tabs
 * and by the Tasks tab of the job detail page.
 *
 * Execute is the supervisor force-complete: Target location*, Target LPN and (single task)
 * Quantity. A quantity below the remaining task quantity is a partial execute: the domain
 * writes a missing-log row and sets Pick Short Status to Open.
 */
import * as React from "react";
import { Ban, ChevronDown, Pencil, Play, UserMinus, UserPlus, Users, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NumberInput } from "@/components/ui/number-input";
import { Spinner } from "@/components/ui/spinner";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { errorTextClass, labelClass } from "@/components/ui/control-styles";
import { JobPicker, LocationPicker, LpPicker } from "@/components/shared";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { bulkToast, errorMessage, plural, postJson, type BulkOutcome } from "@/components/jobs/jobs-client";
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
}

const OPEN = new Set(["Pending", "Started"]);

interface ExecuteResult { readonly taskId: string; readonly doneQty: number; readonly shortQty: number; readonly resolutionJobId: string | null }

function ExecuteModal({ tasks, open, onClose, onDone }: { readonly tasks: readonly TaskFacts[]; readonly open: boolean; readonly onClose: () => void; readonly onDone: () => void }) {
  const single = tasks.length === 1 ? tasks[0] : undefined;
  const remaining = single ? Math.max(0, single.plannedQty - single.actualQty) : 0;
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [lpId, setLpId] = React.useState<string | null>(null);
  const [qty, setQty] = React.useState<number | null>(remaining);
  const [resolution, setResolution] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setLocationId(null);
    setLpId(null);
    setQty(remaining);
    setResolution(false);
    setTouched(false);
    setServerError(null);
  }, [open, remaining]);
  const partial = single !== undefined && qty !== null && qty < remaining;
  const locError = touched && !locationId ? "Choose the target location" : null;
  const qtyError = single && (qty === null || qty < 0 || qty > remaining) ? `Enter 0 to ${remaining}` : null;
  const execute = async () => {
    setTouched(true);
    if (!locationId || qtyError) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await postJson<BulkOutcome & { readonly results: readonly ExecuteResult[] }>("/api/tasks/actions", {
        action: "execute", ids: tasks.map((t) => t.id), targetLocationId: locationId, targetLpId: lpId, ...(single ? { qty: qty ?? 0, createResolutionJob: partial && resolution } : {}),
      });
      const short = res.results.reduce((s, r) => s + r.shortQty, 0);
      if (short > 0) toast.warning("Executed with a pick short", `${short} units short. A missing-log row was written and Pick Short Status is Open.`);
      else toast.success("Success", `${plural(tasks.length, "task")} executed`);
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
        <DialogHeader title="Execute task" description={`Task ID(s) ${tasks.map((t) => t.taskNo).join(", ")}`} />
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="exec-location">Target location <span className="text-danger">*</span></label>
            <LocationPicker id="exec-location" warehouseId={tasks[0]?.warehouseId ?? null} value={locationId} onChange={(v) => setLocationId(v)} placeholder="Select target location" invalid={Boolean(locError)} />
            {locError ? <p className={errorTextClass}>{locError}</p> : null}
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
            <Callout variant="attention" title={`Partial execute: ${remaining - (qty ?? 0)} units short`}>
              <div className="flex flex-col gap-2">
                <span>A missing-log row is written, Pick Short Status becomes Open and the short quantity is released.</span>
                <label className="flex items-center gap-2 text-[12px] font-medium text-body">
                  <Switch checked={resolution} onCheckedChange={setResolution} aria-label="Create a resolution job" />
                  Create a resolution job to re-pick from another location
                </label>
              </div>
            </Callout>
          ) : null}
          {serverError ? <Callout variant="error" title="Couldn't execute">{serverError}</Callout> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void execute()} disabled={saving} aria-busy={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" label="Executing" /> : null}
            Execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export function TaskActions({ tasks, onChanged, mode = "order" }: { readonly tasks: readonly TaskFacts[]; readonly onChanged: () => void; readonly mode?: "order" | "replenishment" }) {
  const { permissions } = usePermissionSet();
  const [modal, setModal] = React.useState<null | "execute" | "update" | "cancel" | "assign" | "unassign" | "warehouses">(null);
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
      const res = await postJson<BulkOutcome>("/api/tasks/actions", { action, ids: only, ...extra });
      bulkToast(res, "task", verb, codes);
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
      description="Cancelled picking tasks release their allocation. Started and completed tasks are skipped."
      records={{ columns: [{ key: "no", label: "Task ID" }, { key: "type", label: "Type" }, { key: "sku", label: "SKU" }, { key: "status", label: "Status" }], rows: pending.map((t) => ({ no: t.taskNo, type: t.taskType, sku: t.sku ?? "", status: <StatusPill status={t.status} domain="task" size="sm" /> })) }}
      cancelLabel="No"
      confirmLabel="Yes"
      onConfirm={() => call("cancel", {}, "cancelled", pending.map((t) => t.id))}
    />
  );

  if (mode === "replenishment") {
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
      <ExecuteModal tasks={tasks} open={modal === "execute"} onClose={() => setModal(null)} onDone={onChanged} />
      <UpdateModal task={tasks[0]} open={modal === "update"} onClose={() => setModal(null)} onDone={onChanged} />
      <AssignUserModal open={modal === "assign"} noun="task(s)" warehouseId={tasks[0]?.warehouseId ?? null} onClose={() => setModal(null)} onAssign={(userId) => call("assign", { userId }, "assigned")} />
      <DifferentWarehousesDialog open={modal === "warehouses"} noun="tasks" onClose={() => setModal(null)} />
      <ConfirmDialog
        open={modal === "unassign"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="attention"
        title="Unassign the selected tasks?"
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={() => call("unassign", {}, "unassigned")}
      />
      {cancelDialog}
    </span>
  );
}
