"use client";

/**
 * Job Management actions (Logiwa 02 §1), shared by the grid toolbar and the job detail page:
 * Update Priority · Cancel · User Actions ▾ (Assign / Unassign) · Label ▾ · Print ▾.
 * Every control is disabled with a reason until the selection makes it valid.
 */
import * as React from "react";
import { Ban, ChevronDown, FileText, Flag, LayoutGrid, ListChecks, Package, Printer, RefreshCcw, Tag, UserMinus, UserPlus, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { usePermissionSet } from "@/components/jobs/use-permissions";
import { bulkToast, errorMessage, postJson, type BulkOutcome } from "./jobs-client";
import { ToolbarLabel } from "./toolbar-label";
import { AssignUserModal, DifferentWarehousesDialog, UpdatePriorityModal } from "./job-modals";

export const JOB_PERMS = {
  priority: "fulfillment.job_management.update_priority",
  cancel: "fulfillment.job_management.cancel",
  assign: "fulfillment.job_management.assign",
  unassign: "fulfillment.job_management.unassign",
  pickList: "fulfillment.job_management.print_job_pick_list",
  content: "fulfillment.job_management.print_job_content",
  packingList: "fulfillment.job_management.print_packing_list",
  cartLayout: "fulfillment.job_management.print_mobile_cart_layout",
  pickShort: "fulfillment.job_management.print_pick_short_consolidation",
  label: "fulfillment.shipment_orders.create_label",
} as const;

export interface JobFacts {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly warehouseId: string;
  readonly assignedToUserId: string | null;
  readonly hasPickShort: number | boolean;
  readonly mobileCartId: string | null;
  readonly operationType?: string;
  readonly jobType?: string;
  readonly priority?: string;
  /** Row version for optimistic concurrency (a stale write fails with CONFLICT). */
  readonly version?: number;
}

const CLOSED = new Set(["Completed", "Cancelled"]);

const TASK_EXECUTE_PERM = "fulfillment.task_details.execute_task";
/** Supervisor-level job actions (Logiwa: priority, cancel and assignment are not floor actions). */
const SUPERVISOR_KEYS: ReadonlySet<keyof typeof JOB_PERMS> = new Set(["priority", "cancel", "assign", "unassign"]);
const SUPERVISOR_REASON = "Supervisor permission required. Ask a supervisor to change job priority, assignment or cancel jobs.";

interface LabelOutcome extends BulkOutcome {
  readonly files: readonly { readonly orderCode: string; readonly trackingNumber: string; readonly fileId: string | null }[];
}

function openPdf(url: string): void {
  const w = window.open(url, "_blank", "noopener");
  if (!w) toast.warning("Pop-up blocked", "Allow pop-ups for KitStak to open printouts in a new tab.");
}

export function JobActions({ jobs, onChanged, compact = false }: { readonly jobs: readonly JobFacts[]; readonly onChanged: (opts?: { readonly keepSelection?: boolean }) => void; readonly compact?: boolean }) {
  const { permissions } = usePermissionSet();
  const [modal, setModal] = React.useState<null | "priority" | "cancel" | "assign" | "unassign" | "warehouses" | "void">(null);
  const ids = jobs.map((j) => j.id);
  const codes = new Map(jobs.map((j) => [j.id, j.code]));
  const none = jobs.length === 0 ? "Select at least one job" : null;
  const open = jobs.filter((j) => !CLOSED.has(j.status));
  const closedReason = none ?? (open.length === 0 ? "The selected jobs are already completed or cancelled" : null);
  const perm = (key: keyof typeof JOB_PERMS) => (permissions.has(JOB_PERMS[key]) ? null : SUPERVISOR_KEYS.has(key) ? SUPERVISOR_REASON : "You don't have permission for this action");
  const multiWarehouse = new Set(jobs.map((j) => j.warehouseId)).size > 1;

  const call = async (action: string, extra: Record<string, unknown> = {}, verb: string) => {
    try {
      const versions = Object.fromEntries(jobs.filter((j) => typeof j.version === "number").map((j) => [j.id, j.version as number]));
      const res = await postJson<BulkOutcome & { readonly message?: string; readonly unchanged?: readonly string[] }>("/api/jobs/actions", { action, ids, versions, ...extra });
      const unchanged = res.unchanged?.length ?? 0;
      if (res.failed.length === 0 && action === "priority" && unchanged > 0) {
        if (res.succeeded.length === 0) toast.info("No change", unchanged === 1 ? `${codes.get(res.unchanged?.[0] ?? "") ?? "The job"} is already ${String(extra.priority)}` : `The selected jobs are already ${String(extra.priority)}`);
        else toast.success("Priority updated", res.message ?? `${res.succeeded.length} updated`);
      } else if (res.failed.length === 0 && action === "priority") {
        const label = String(extra.priority);
        toast.success("Priority updated", res.succeeded.length === 1 ? `${codes.get(res.succeeded[0] ?? "") ?? "Job"} is now ${label}` : `${res.succeeded.length} jobs are now ${label}`);
      } else if (res.failed.length === 0 && res.message) {
        toast.success("Success", res.message);
      } else {
        bulkToast(res, "job", verb, codes);
      }
      onChanged({ keepSelection: action !== "cancel" });
    } catch (error) {
      toast.error("Action failed", errorMessage(error));
      throw error;
    }
  };

  const labels = async (op: "create" | "reprint" | "void") => {
    try {
      const res = await postJson<LabelOutcome>("/api/jobs/labels", { ids, op });
      const verb = op === "create" ? "labeled" : op === "reprint" ? "reprinted" : "voided";
      if (res.succeeded.length + res.failed.length === 0) toast.info("No orders", "The selected jobs have no orders.");
      else bulkToast(res, "order", verb);
      const first = res.files.find((f) => f.fileId);
      if (first?.fileId && op !== "void") openPdf(`/api/files/${encodeURIComponent(first.fileId)}?inline=1`);
      onChanged({ keepSelection: true });
    } catch (error) {
      toast.error("Label action failed", errorMessage(error));
    }
  };

  const print = async (doc: string, title: string) => {
    // Render first, then open: a guard failure (no pick short, no cart, closed job) becomes a
    // toast instead of a JSON error page in a new tab. The tab is opened synchronously so
    // pop-up blockers treat it as user-initiated.
    const tab = window.open("", "_blank");
    if (tab) {
      tab.opener = null;
      tab.document.title = `${title}…`;
      tab.document.body.style.cssText = "font:14px system-ui;color:#50575C;display:flex;align-items:center;justify-content:center;height:100vh;margin:0";
      tab.document.body.textContent = `Preparing ${title.toLowerCase()}…`;
    }
    // Critic R3: feedback in the app too, not only in the new tab.
    const pending = toast.info(`Preparing ${title.toLowerCase()}…`, ids.length === 1 ? "The PDF opens in a new tab." : `${ids.length} jobs · the PDF opens in a new tab.`, { duration: 30_000 });
    try {
      const res = await fetch(`/api/jobs/print?doc=${doc}&ids=${encodeURIComponent(ids.join(","))}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof body?.error === "string" && body.error ? body.error : `The ${title.toLowerCase()} couldn't be printed (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url;
      else openPdf(url);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.dismiss(pending);
    } catch (error) {
      toast.dismiss(pending);
      tab?.close();
      toast.error(`Couldn't print ${title.toLowerCase()}`, errorMessage(error));
      return;
    }
    if (doc === "pick-list") {
      try {
        await postJson<BulkOutcome>("/api/jobs/actions", { action: "markPrinted", ids });
        onChanged({ keepSelection: true });
      } catch {
        // Printing already opened; the status flag is cosmetic.
      }
    }
  };

  // Critic R5: terminal-state jobs (Completed / Cancelled) take no assignment, label or pick-list work.
  const terminalReason = open.length === 0 && jobs.length > 0 ? `The selected ${jobs.length === 1 ? "job is" : "jobs are"} ${jobs.every((j) => j.status === "Cancelled") ? "cancelled" : "closed"}` : null;
  const assignReason = none ?? perm("assign") ?? (terminalReason ? "Closed jobs can't be assigned" : null);
  const unassignReason = none ?? perm("unassign") ?? (jobs.some((j) => j.assignedToUserId) ? null : "None of the selected jobs is assigned");
  const userMenuReason = none ?? terminalReason ?? (perm("assign") && perm("unassign") ? SUPERVISOR_REASON : null);
  const pickShortReason = none ?? perm("pickShort") ?? (jobs.some((j) => Boolean(j.hasPickShort)) ? null : "None of the selected jobs has an open pick short");
  const cartReason = none ?? perm("cartLayout") ?? (jobs.some((j) => j.mobileCartId) ? null : "None of the selected jobs uses a mobile cart");
  const picking = jobs.every((j) => !j.operationType || j.operationType === "Picking" || j.operationType === "Work Order");
  const labelReason = none ?? perm("label") ?? (picking ? null : "Labels apply to picking jobs only");
  const createLabelReason = labelReason ?? (terminalReason ? `${terminalReason}; labels can't be created` : null);
  const pickListReason = perm("pickList") ?? (terminalReason ? `${terminalReason}; there is nothing left to pick` : null);

  // Critic R1: controls the role can never use are hidden rather than shown disabled without a reason.
  // Critic R4: floor users (they can execute tasks) see the supervisor actions disabled with the
  // reason; roles that can't work jobs at all (viewers) don't see them.
  const operational = permissions.has(TASK_EXECUTE_PERM);
  const can = (key: keyof typeof JOB_PERMS) => permissions.has(JOB_PERMS[key]) || (operational && SUPERVISOR_KEYS.has(key));
  const showUser = can("assign") || can("unassign");
  const showPrint = can("pickList") || can("content") || can("packingList") || can("cartLayout") || can("pickShort");
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {can("priority") ? (
      <DisabledReason reason={closedReason ?? perm("priority")}>
        <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(closedReason ?? perm("priority"))} aria-label="Update priority" onClick={() => setModal("priority")}>
          <Flag className="h-3.5 w-3.5" aria-hidden />
          <ToolbarLabel always={compact}>Update priority</ToolbarLabel>
        </Button>
      </DisabledReason>
      ) : null}
      {can("cancel") ? (
      <DisabledReason reason={closedReason ?? perm("cancel")}>
        <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(closedReason ?? perm("cancel"))} aria-label="Cancel jobs" onClick={() => setModal("cancel")}>
          <Ban className="h-3.5 w-3.5" aria-hidden />
          <ToolbarLabel always={compact}>Cancel</ToolbarLabel>
        </Button>
      </DisabledReason>
      ) : null}
      {showUser ? (
      <DropdownMenu>
        <DisabledReason reason={userMenuReason}>
          <DropdownMenuTrigger asChild disabled={Boolean(userMenuReason)}>
            <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(userMenuReason)} aria-label="User actions">
              <Users className="h-3.5 w-3.5" aria-hidden />
              <ToolbarLabel always={compact}>User actions</ToolbarLabel>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[200px]">
          <DropdownMenuItem icon={UserPlus} disabledReason={assignReason} onSelect={() => setModal(multiWarehouse ? "warehouses" : "assign")}>Assign</DropdownMenuItem>
          <DropdownMenuItem icon={UserMinus} disabledReason={unassignReason} onSelect={() => setModal(multiWarehouse ? "warehouses" : "unassign")}>Unassign</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}
      {can("label") ? (
      <DropdownMenu>
        <DisabledReason reason={none}>
          <DropdownMenuTrigger asChild disabled={Boolean(none)}>
            <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(none)} aria-label="Label">
              <Tag className="h-3.5 w-3.5" aria-hidden />
              <ToolbarLabel always={compact}>Label</ToolbarLabel>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuItem icon={Tag} disabledReason={createLabelReason} description="Buy a shipping label for every order" onSelect={() => void labels("create")}>Create label</DropdownMenuItem>
          <DropdownMenuItem icon={RefreshCcw} disabledReason={labelReason} description="Open the active labels again" onSelect={() => void labels("reprint")}>Reprint label</DropdownMenuItem>
          <DropdownMenuItem icon={XCircle} destructive disabledReason={labelReason} description="Void the active labels" onSelect={() => setModal("void")}>Void label</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}
      {showPrint ? (
      <DropdownMenu>
        <DisabledReason reason={none}>
          <DropdownMenuTrigger asChild disabled={Boolean(none)}>
            <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(none)} aria-label="Print">
              <Printer className="h-3.5 w-3.5" aria-hidden />
              <ToolbarLabel always={compact}>Print</ToolbarLabel>
              <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </DisabledReason>
        <DropdownMenuContent align="end" className="min-w-[250px]">
          <DropdownMenuItem icon={ListChecks} disabledReason={pickListReason} description="Walking-path order, with check boxes" onSelect={() => void print("pick-list", "Job pick list")}>Print job pick list</DropdownMenuItem>
          <DropdownMenuItem icon={FileText} disabledReason={perm("content")} description="Every task of the job" onSelect={() => void print("job-content", "Job content")}>Print job content</DropdownMenuItem>
          <DropdownMenuItem icon={XCircle} disabledReason={pickShortReason} description="Short lines to re-pick" onSelect={() => void print("pick-short", "Pick short consolidation")}>Print pick short consolidation</DropdownMenuItem>
          <DropdownMenuItem icon={LayoutGrid} disabledReason={cartReason} description="Which order goes in which cell" onSelect={() => void print("cart-layout", "Mobile cart layout")}>Mobile cart layout</DropdownMenuItem>
          <DropdownMenuItem icon={Package} disabledReason={perm("packingList")} description="One page per order" onSelect={() => void print("packing-list", "Packing list")}>Print packing list</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      ) : null}

      <UpdatePriorityModal open={modal === "priority"} count={jobs.length} onClose={() => setModal(null)} onSave={(priority) => call("priority", { priority }, "updated")} />
      <AssignUserModal open={modal === "assign"} noun="job(s)" warehouseId={jobs[0]?.warehouseId ?? null} onClose={() => setModal(null)} onAssign={(userId) => call("assign", { userId }, "assigned")} />
      <DifferentWarehousesDialog open={modal === "warehouses"} onClose={() => setModal(null)} />
      <ConfirmDialog
        open={modal === "unassign"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="attention"
        title="Unassign the selected jobs?"
        description="The jobs go back to the job pool; any picker can take them."
        cancelLabel="Keep assigned"
        confirmLabel="Unassign"
        onConfirm={() => call("unassign", {}, "unassigned")}
      />
      <ConfirmDialog
        open={modal === "cancel"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="danger"
        title="Attention"
        description={`This action will cancel all pending tasks and release all allocations of ${open.length === 1 ? "the selected job" : `the ${open.length} selected jobs`}; orders not yet picked go back to Open. Work that is already picked is kept, with its packing and loading tasks. How would you like to proceed?`}
        records={{ columns: [{ key: "code", label: "Job code" }, { key: "type", label: "Job type" }, { key: "status", label: "Status" }], rows: open.map((j) => ({ code: j.code, type: j.jobType ?? "", status: <StatusPill status={j.status} domain="job" size="sm" /> })) }}
        cancelLabel="Go back"
        confirmLabel={open.length === 1 ? "Cancel job" : "Cancel jobs"}
        onConfirm={() => call("cancel", {}, "cancelled")}
      />
      <ConfirmDialog
        open={modal === "void"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="danger"
        title="Void the labels of the selected jobs?"
        description="The active shipping label of every order in these jobs is voided with the carrier."
        cancelLabel="Keep labels"
        confirmLabel="Void labels"
        onConfirm={() => labels("void")}
      />
    </span>
  );
}
