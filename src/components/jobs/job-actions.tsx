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
import { bulkToast, errorMessage, plural, postJson, type BulkOutcome } from "./jobs-client";
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
}

const CLOSED = new Set(["Completed", "Cancelled"]);

interface LabelOutcome extends BulkOutcome {
  readonly files: readonly { readonly orderCode: string; readonly trackingNumber: string; readonly fileId: string | null }[];
}

function openPdf(url: string): void {
  const w = window.open(url, "_blank", "noopener");
  if (!w) toast.warning("Pop-up blocked", "Allow pop-ups for KitStak to open printouts in a new tab.");
}

export function JobActions({ jobs, onChanged, compact = false }: { readonly jobs: readonly JobFacts[]; readonly onChanged: () => void; readonly compact?: boolean }) {
  const { permissions } = usePermissionSet();
  const [modal, setModal] = React.useState<null | "priority" | "cancel" | "assign" | "unassign" | "warehouses" | "void">(null);
  const ids = jobs.map((j) => j.id);
  const codes = new Map(jobs.map((j) => [j.id, j.code]));
  const none = jobs.length === 0 ? "Select at least one job" : null;
  const open = jobs.filter((j) => !CLOSED.has(j.status));
  const closedReason = none ?? (open.length === 0 ? "The selected jobs are already completed or cancelled" : null);
  const perm = (key: keyof typeof JOB_PERMS) => (permissions.has(JOB_PERMS[key]) ? null : "You don't have permission for this action");
  const multiWarehouse = new Set(jobs.map((j) => j.warehouseId)).size > 1;

  const call = async (action: string, extra: Record<string, unknown> = {}, verb: string) => {
    try {
      const res = await postJson<BulkOutcome>("/api/jobs/actions", { action, ids, ...extra });
      bulkToast(res, "job", verb, codes);
      onChanged();
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
      onChanged();
    } catch (error) {
      toast.error("Label action failed", errorMessage(error));
    }
  };

  const print = async (doc: string) => {
    openPdf(`/api/jobs/print?doc=${doc}&ids=${encodeURIComponent(ids.join(","))}`);
    if (doc === "pick-list") {
      try {
        await postJson<BulkOutcome>("/api/jobs/actions", { action: "markPrinted", ids });
        onChanged();
      } catch {
        // Printing already opened; the status flag is cosmetic.
      }
    }
  };

  const assignReason = none ?? perm("assign") ?? (open.length === 0 ? "Closed jobs can't be assigned" : null);
  const unassignReason = none ?? perm("unassign") ?? (jobs.some((j) => j.assignedToUserId) ? null : "None of the selected jobs is assigned");
  const pickShortReason = none ?? perm("pickShort") ?? (jobs.some((j) => Boolean(j.hasPickShort)) ? null : "None of the selected jobs has an open pick short");
  const cartReason = none ?? perm("cartLayout") ?? (jobs.some((j) => j.mobileCartId) ? null : "None of the selected jobs uses a mobile cart");
  const picking = jobs.every((j) => !j.operationType || j.operationType === "Picking" || j.operationType === "Work Order");
  const labelReason = none ?? perm("label") ?? (picking ? null : "Labels apply to picking jobs only");

  return (
    <span className="flex items-center gap-1.5">
      <DisabledReason reason={closedReason ?? perm("priority")}>
        <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(closedReason ?? perm("priority"))} aria-label="Update priority" onClick={() => setModal("priority")}>
          <Flag className="h-3.5 w-3.5" aria-hidden />
          <ToolbarLabel always={compact}>Update priority</ToolbarLabel>
        </Button>
      </DisabledReason>
      <DisabledReason reason={closedReason ?? perm("cancel")}>
        <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(closedReason ?? perm("cancel"))} aria-label="Cancel jobs" onClick={() => setModal("cancel")}>
          <Ban className="h-3.5 w-3.5" aria-hidden />
          <ToolbarLabel always={compact}>Cancel</ToolbarLabel>
        </Button>
      </DisabledReason>
      <DropdownMenu>
        <DisabledReason reason={none}>
          <DropdownMenuTrigger asChild disabled={Boolean(none)}>
            <Button variant="secondary" size={compact ? "sm" : undefined} disabled={Boolean(none)} aria-label="User actions">
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
          <DropdownMenuItem icon={Tag} disabledReason={labelReason} description="Buy a shipping label for every order" onSelect={() => void labels("create")}>Create label</DropdownMenuItem>
          <DropdownMenuItem icon={RefreshCcw} disabledReason={labelReason} description="Open the active labels again" onSelect={() => void labels("reprint")}>Reprint label</DropdownMenuItem>
          <DropdownMenuItem icon={XCircle} destructive disabledReason={labelReason} description="Void the active labels" onSelect={() => setModal("void")}>Void label</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
          <DropdownMenuItem icon={ListChecks} disabledReason={perm("pickList")} description="Walking-path order, with check boxes" onSelect={() => void print("pick-list")}>Print job pick list</DropdownMenuItem>
          <DropdownMenuItem icon={FileText} disabledReason={perm("content")} description="Every task of the job" onSelect={() => void print("job-content")}>Print job content</DropdownMenuItem>
          <DropdownMenuItem icon={XCircle} disabledReason={pickShortReason} description="Short lines to re-pick" onSelect={() => void print("pick-short")}>Print pick short consolidation</DropdownMenuItem>
          <DropdownMenuItem icon={LayoutGrid} disabledReason={cartReason} description="Which order goes in which cell" onSelect={() => void print("cart-layout")}>Mobile cart layout</DropdownMenuItem>
          <DropdownMenuItem icon={Package} disabledReason={perm("packingList")} description="One page per order" onSelect={() => void print("packing-list")}>Print packing list</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UpdatePriorityModal open={modal === "priority"} count={jobs.length} onClose={() => setModal(null)} onSave={(priority) => call("priority", { priority }, "updated")} />
      <AssignUserModal open={modal === "assign"} noun="job(s)" warehouseId={jobs[0]?.warehouseId ?? null} onClose={() => setModal(null)} onAssign={(userId) => call("assign", { userId }, "assigned")} />
      <DifferentWarehousesDialog open={modal === "warehouses"} onClose={() => setModal(null)} />
      <ConfirmDialog
        open={modal === "unassign"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="attention"
        title="Unassign the selected jobs?"
        description="The jobs go back to the job pool; any picker can take them."
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={() => call("unassign", {}, "unassigned")}
      />
      <ConfirmDialog
        open={modal === "cancel"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="danger"
        title={`Cancel ${plural(open.length, "job")}?`}
        description="Pending tasks are cancelled, allocations are released and the orders go back to Open."
        records={{ columns: [{ key: "code", label: "Job code" }, { key: "type", label: "Job type" }, { key: "status", label: "Status" }], rows: open.map((j) => ({ code: j.code, type: j.jobType ?? "", status: <StatusPill status={j.status} domain="job" size="sm" /> })) }}
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={() => call("cancel", {}, "cancelled")}
      />
      <ConfirmDialog
        open={modal === "void"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        variant="danger"
        title="Void the labels of the selected jobs?"
        description="The active shipping label of every order in these jobs is voided with the carrier."
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={() => labels("void")}
      />
    </span>
  );
}
