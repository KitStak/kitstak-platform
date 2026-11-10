"use client";

/**
 * Shipment Orders bulk menus (Logiwa parity + KitStaks additions):
 *   Backlog  Label ▾ · Warehouse Ops ▾ · Print ▾ · Delete ▾ · Tag
 *   Shipped  Label ▾ · Create RMA · Print ▾ · Tag
 * Every item is disabled until rows are selected (with a reason tooltip); guarded
 * actions open Logiwa's guard modal; destructive ones confirm with a records table.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Ban, ChevronDown, ClipboardList, FileBox, FileText, GitBranch, Layers, ListChecks, PackageCheck, PackageMinus, PauseCircle, PlayCircle,
  Printer, RotateCcw, ScanBarcode, Scissors, Tag, Trash2, Truck, Undo2, Warehouse, Wrench, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { PrintOptionsModal, TagPopover } from "@/components/shared";
import { OrderJobModal, type JobOrderRef } from "./order-job-modal";
import { apiFetch } from "@/lib/api-client";
import { usePermissionSet } from "@/lib/permissions-client";
import { ORDER_BULK_PERMISSIONS, ORDER_PERMISSIONS, type OrderView } from "@/lib/grid-defs/orders/shipment-orders";
import { bulkToast, errorMessage, fetchPrintRecords, openFiles, ORDER_INVALIDATE, runBulk, runLabels, type OrderRow } from "../orders-client";
import { eligibility, guardChecks, LOGIWA_GUARDS, partition, shipConfirmText, type EligibilityRow } from "./order-eligibility";
import { BackorderModal, CancelOrdersModal, ChangeWarehouseModal, GuardModal, ReturnInfoDrawer, type GuardState } from "./order-modals";

type Modal =
  | { kind: "cancel" } | { kind: "warehouse" } | { kind: "backorder" } | { kind: "jobs"; ids: readonly string[]; allocated?: boolean } | { kind: "ship" }
  | { kind: "delete" } | { kind: "serials" } | { kind: "returnInfo" } | { kind: "print"; typeKeys: readonly string[]; records: readonly unknown[]; title: string; clientId: string | null };

export interface OrderBulkMenusProps {
  readonly view: OrderView;
  readonly rows: readonly OrderRow[];
  readonly onChanged: () => void;
  readonly returnInfoOpen?: boolean;
  readonly onReturnInfoOpenChange?: (open: boolean) => void;
}

const NONE = "Select at least one order";
const NO_PERMISSION = "You don't have permission for this action";

function MenuButton({ label, icon: Icon, reason, children }: { readonly label: string; readonly icon: React.ComponentType<{ className?: string }>; readonly reason: string | null; readonly children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DisabledReason reason={reason}>
        <DropdownMenuTrigger asChild disabled={Boolean(reason)}>
          <Button variant="secondary" disabled={Boolean(reason)}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
      </DisabledReason>
      <DropdownMenuContent align="end" className="min-w-[230px]">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Job modal inputs; back-order parents are already allocated (Ready to Pick) even if the grid row is stale. */
function jobRefs(rows: readonly OrderRow[], ids: readonly string[], allocated: boolean): readonly JobOrderRef[] {
  return rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, code: r.code, warehouseId: r.warehouseId, status: allocated ? "Ready to Pick" : r.status }));
}

export function OrderBulkMenus({ view, rows, onChanged, returnInfoOpen, onReturnInfoOpenChange }: OrderBulkMenusProps) {
  const router = useRouter();
  const { permissions } = usePermissionSet();
  const can = (key: string) => permissions.has(key);
  const [modal, setModal] = React.useState<Modal | null>(null);
  const [guard, setGuard] = React.useState<GuardState | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const ids = rows.map((r) => r.id);
  const codes = React.useMemo(() => new Map(rows.map((r) => [r.id, r.code])), [rows]);
  const empty = rows.length === 0 ? NONE : null;
  const reasonFor = (permission: string, check: string | null) => empty ?? (can(permission) ? check : NO_PERMISSION);

  const done = () => {
    onChanged();
  };

  /** Guarded actions: Logiwa guard modal when nothing qualifies; otherwise run on the eligible rows. */
  const guarded = (check: (r: EligibilityRow) => boolean, message: string, run: (eligible: readonly OrderRow[]) => void | Promise<void>) => {
    const { eligible, skipped } = partition(rows, check);
    if (eligible.length === 0) {
      setGuard({ title: "Warning", message });
      return;
    }
    if (skipped.length > 0) toast.info("Some orders skipped", `${skipped.length} order${skipped.length === 1 ? "" : "s"} skipped: ${message}`);
    void run(eligible as readonly OrderRow[]);
  };

  const labels = async (action: "create" | "void" | "reprint" | "return" | "void-return", target: readonly OrderRow[], verb: string) => {
    setBusy(action);
    try {
      const result = await runLabels(action, target.map((r) => r.id));
      bulkToast(result, verb, codes);
      openFiles(result.fileIds);
      if (action !== "reprint") done();
    } catch (error) {
      toast.error("Label operation failed", errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const simple = async (action: "hold" | "release" | "resolve-pick-short" | "resolve-pack-short" | "unmerge" | "cancel-picking", target: readonly OrderRow[], verb: string) => {
    setBusy(action);
    try {
      const result = await runBulk(action, { ids: target.map((r) => r.id) });
      bulkToast(result, verb, codes);
      done();
    } catch (error) {
      toast.error("Action failed", errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const print = async (type: string, title: string, guardMessage?: string) => {
    setBusy(type);
    try {
      const res = await fetchPrintRecords(type, ids);
      if (res.records.length === 0) {
        setGuard({
          title: type === "pick-short-label" ? "Information" : "Warning",
          heading: type === "pick-short-label" ? "Ineligible order(s) selected" : undefined,
          message: guardMessage ?? res.ineligible[0]?.reason ?? "Nothing to print for the selected orders.",
          orders: type === "pick-short-label" && res.ineligible.length === 0 ? [] : undefined,
        });
        return;
      }
      if (res.ineligible.length > 0) toast.info("Some orders skipped", `${res.ineligible.length} order${res.ineligible.length === 1 ? "" : "s"} skipped: ${res.ineligible[0]?.reason}`);
      const clientId = rows.every((r) => r.clientId === rows[0]?.clientId) ? rows[0]?.clientId ?? null : null;
      setModal({ kind: "print", typeKeys: [res.typeKey], records: res.records, title, clientId });
    } catch (error) {
      toast.error("Print failed", errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const reprintLabels = () =>
    guarded((r) => guardChecks.reprint(r), LOGIWA_GUARDS.reprint, async (target) => {
      const res = await fetchPrintRecords("shipping-label", target.map((r) => r.id));
      if (!res.fileIds?.length) setGuard({ title: "Warning", message: LOGIWA_GUARDS.reprint });
      else openFiles(res.fileIds);
    });

  const confirmShip = async () => {
    const result = await apiFetch<{ succeeded: string[]; failed: { id: string; code: string; message: string }[] }>("/api/ops/shipping/ship", { method: "POST", body: { ids } });
    bulkToast(result, "shipped", codes);
    done();
  };

  const confirmDelete = async () => {
    const result = await runBulk("delete", { ids });
    bulkToast(result, "deleted", codes);
    done();
  };

  const confirmRemoveSerials = async () => {
    const result = await runBulk("remove-serials", { ids: rows.filter((r) => r.hasSerials).map((r) => r.id) });
    bulkToast(result, "updated", codes);
    done();
  };

  const createRma = () => {
    const target = rows.filter((r) => ["Shipped", "Partially Shipped", "Delivered"].includes(r.status));
    if (target.length === 0) {
      setGuard({ title: "Warning", message: "RMAs can only be created for shipped orders." });
      return;
    }
    router.push(`/orders/returns/new?orderIds=${encodeURIComponent(target.map((r) => r.id).join(","))}`);
  };

  const recordTable = {
    columns: [{ key: "code", label: "Order code" }, { key: "date", label: "Order date" }, { key: "status", label: "Status" }],
    rows: rows.map((r) => ({ code: r.code, date: new Date(String(r.orderDate)).toLocaleString(), status: <StatusPill status={r.status} domain="shipmentOrder" size="sm" /> })),
  };

  const tagButton = (
    <TagPopover
      entityType="shipment_order"
      scope="shipment_order"
      ids={ids}
      appliedTagIds={rows.length === 1 ? rows[0]?.tags.map((t) => t.id) : []}
      disabledReason={reasonFor(ORDER_PERMISSIONS.tag, null)}
      invalidate={ORDER_INVALIDATE}
      onApplied={done}
      trigger={
        <Button variant="secondary" disabled={Boolean(reasonFor(ORDER_PERMISSIONS.tag, null))} aria-label="Tag">
          <Tag className="h-3.5 w-3.5" aria-hidden />
          Tag
        </Button>
      }
    />
  );

  const item = (key: string, label: string, icon: React.ComponentType<{ className?: string }>, permission: string, check: string | null, onSelect: () => void, extra: { destructive?: boolean; description?: string } = {}) => (
    <DropdownMenuItem key={key} icon={icon} destructive={extra.destructive} description={extra.description} disabledReason={busy === key ? "Working…" : reasonFor(permission, check)} onSelect={onSelect}>
      {label}
    </DropdownMenuItem>
  );

  const P = ORDER_PERMISSIONS;
  const B = ORDER_BULK_PERMISSIONS;
  const anyReason = (keys: readonly string[]) => empty ?? (keys.some(can) ? null : NO_PERMISSION);

  const backlogMenus = (
    <>
      <MenuButton label="Label" icon={ScanBarcode} reason={anyReason([P.createLabel, P.reprintLabel, P.voidLabel, P.createReturnLabel, P.createRetailerLabel, P.reprintRetailerLabel])}>
        {item("create", "Create label", ScanBarcode, P.createLabel, eligibility.createLabel(rows), () => void labels("create", rows, "labeled"), { description: "Buys labels and opens the PDF in a new tab" })}
        {item("reprint", "Reprint label", Printer, P.reprintLabel, null, reprintLabels)}
        {item("void", "Void label", XCircle, P.voidLabel, null, () => guarded((r) => guardChecks.void(r), LOGIWA_GUARDS.void, (t) => labels("void", t, "voided")))}
        {item("return", "Create return label", Undo2, P.createReturnLabel, eligibility.returnLabel(rows), () => void labels("return", rows, "labeled"))}
        <DropdownMenuSeparator />
        {item("retailer", "Create retailer label", FileBox, P.createRetailerLabel, eligibility.retailerLabel(rows), () => setModal({ kind: "print", typeKeys: ["retailer-case-label"], records: rows.map((r) => ({ orderCode: r.code })), title: "Create retailer label", clientId: null }))}
        {item("retailer-reprint", "Reprint retailer label", FileBox, P.reprintRetailerLabel, eligibility.retailerLabel(rows), () => setModal({ kind: "print", typeKeys: ["retailer-case-label"], records: rows.map((r) => ({ orderCode: r.code })), title: "Reprint retailer label", clientId: null }))}
      </MenuButton>
      <MenuButton label="Warehouse ops" icon={Wrench} reason={anyReason([P.ship, P.jobs, ...Object.values(B)])}>
        <DropdownMenuLabel>Fulfillment</DropdownMenuLabel>
        {item("ship", "Ship order", Truck, P.ship, eligibility.ship(rows), () => setModal({ kind: "ship" }))}
        {item("backorder", "Create backorder", GitBranch, B.backorder, eligibility.backorder(rows), () => setModal({ kind: "backorder" }))}
        {item("jobs", "Picking / job operations", ClipboardList, P.jobs, eligibility.jobs(rows), () => setModal({ kind: "jobs", ids }))}
        {item("cancel-picking", "Cancel picking", RotateCcw, B["cancel-picking"], null, () => guarded((r) => guardChecks.cancelPicking(r), LOGIWA_GUARDS.cancelPicking, (t) => simple("cancel-picking", t, "updated")))}
        {item("warehouse", "Change warehouse", Warehouse, B["change-warehouse"], eligibility.changeWarehouse(rows), () => setModal({ kind: "warehouse" }))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        {item("hold", "Put on hold", PauseCircle, B.hold, eligibility.hold(rows), () => void simple("hold", rows, "put on hold"))}
        {item("release", "Release hold", PlayCircle, B.release, eligibility.release(rows), () => void simple("release", rows.filter((r) => r.status === "On Hold"), "released"))}
        {item("resolve-pick-short", "Resolve pick short", PackageCheck, B["resolve-pick-short"], eligibility.resolvePickShort(rows), () => void simple("resolve-pick-short", rows, "resolved"))}
        {item("resolve-pack-short", "Resolve pack short", PackageMinus, B["resolve-pack-short"], eligibility.resolvePackShort(rows), () => void simple("resolve-pack-short", rows, "resolved"))}
        {item("unmerge", "Unmerge order", Scissors, B.unmerge, eligibility.unmerge(rows), () => void simple("unmerge", rows, "unmerged"))}
        <DropdownMenuSeparator />
        {item("cancel", "Cancel order", Ban, B.cancel, eligibility.cancel(rows), () => setModal({ kind: "cancel" }), { destructive: true })}
      </MenuButton>
      <MenuButton label="Print" icon={Printer} reason={anyReason([P.printPickList, P.batchPickList, P.printPackingSlip, P.printManifest, P.pickPackShortLabel])}>
        {item("picking-list", "Picking list", ListChecks, P.printPickList, null, () => void print("picking-list", "Print picking list", LOGIWA_GUARDS.pickList))}
        {item("consolidated-picking-list", "Batch picking list", Layers, P.batchPickList, null, () => void print("consolidated-picking-list", "Print batch picking list", LOGIWA_GUARDS.pickList))}
        {item("packing-slip", "Packing slip", FileText, P.printPackingSlip, null, () => void print("packing-slip", "Print packing slip"))}
        {item("manifest-bol", "Manifest / BOL", FileBox, P.printManifest, null, () => void print("manifest-bol", "Print manifest / BOL"))}
        {item("pick-short-label", "Pick / pack short label", ScanBarcode, P.pickPackShortLabel, null, () => void print("pick-short-label", "Print pick / pack short label", LOGIWA_GUARDS.issueLabel))}
      </MenuButton>
      <MenuButton label="Delete" icon={Trash2} reason={anyReason([P.delete, B["remove-serials"]])}>
        {item("delete", "Delete shipment order", Trash2, P.delete, eligibility.delete(rows), () => setModal({ kind: "delete" }), { destructive: true })}
        {item("serials", "Remove serial number", XCircle, B["remove-serials"], null, () => guarded((r) => guardChecks.removeSerials(r), LOGIWA_GUARDS.removeSerials, () => setModal({ kind: "serials" })), { destructive: true })}
      </MenuButton>
    </>
  );

  const shippedMenus = (
    <>
      <MenuButton label="Label" icon={ScanBarcode} reason={anyReason([P.createReturnLabel, P.voidLabel, P.reprintLabel])}>
        {item("return", "Create return label", Undo2, P.createReturnLabel, eligibility.returnLabel(rows), () => void labels("return", rows, "labeled"))}
        {item("void-return", "Void return label", XCircle, P.voidLabel, null, () => void labels("void-return", rows, "voided"))}
        {item("reprint", "Reprint label", Printer, P.reprintLabel, null, reprintLabels)}
      </MenuButton>
      <DisabledReason reason={reasonFor(P.createRma, null)}>
        <Button variant="secondary" disabled={Boolean(reasonFor(P.createRma, null))} onClick={createRma}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Create RMA
        </Button>
      </DisabledReason>
      <MenuButton label="Print" icon={Printer} reason={anyReason([P.reprintLabel, P.printPackingSlip, P.printManifest])}>
        {item("reprint-p", "Reprint label", Printer, P.reprintLabel, null, reprintLabels)}
        {item("packing-slip", "Packing slip", FileText, P.printPackingSlip, null, () => void print("packing-slip", "Print packing slip"))}
        {item("manifest-bol", "Manifest / BOL", FileBox, P.printManifest, null, () => void print("manifest-bol", "Print manifest / BOL"))}
      </MenuButton>
    </>
  );

  return (
    <>
      {view === "backlog" ? backlogMenus : shippedMenus}
      {tagButton}

      <GuardModal state={guard} onClose={() => setGuard(null)} />
      <CancelOrdersModal rows={rows} open={modal?.kind === "cancel"} onOpenChange={(o) => setModal(o ? { kind: "cancel" } : null)} onDone={done} />
      <ChangeWarehouseModal rows={rows} open={modal?.kind === "warehouse"} onOpenChange={(o) => setModal(o ? { kind: "warehouse" } : null)} onDone={done} />
      <BackorderModal
        rows={rows}
        open={modal?.kind === "backorder"}
        onOpenChange={(o) => setModal(o ? { kind: "backorder" } : null)}
        onCreated={(parentIds) => {
          done();
          setModal(parentIds.length ? { kind: "jobs", ids: parentIds, allocated: true } : null);
        }}
      />
      <OrderJobModal
        open={modal?.kind === "jobs"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        orders={modal?.kind === "jobs" ? jobRefs(rows, modal.ids, Boolean(modal.allocated)) : []}
        onDone={done}
      />
      <ConfirmDialog
        open={modal?.kind === "ship"}
        onOpenChange={(o) => setModal(o ? { kind: "ship" } : null)}
        variant="info"
        icon={Truck}
        title="Are you sure you want to ship orders?"
        description={shipConfirmText(rows.length)}
        records={recordTable}
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={confirmShip}
      />
      <ConfirmDialog
        open={modal?.kind === "delete"}
        onOpenChange={(o) => setModal(o ? { kind: "delete" } : null)}
        variant="danger"
        title={`Are you sure you want to delete ${rows.length === 1 ? "your order" : `${rows.length} orders`}?`}
        description="Deleted orders leave every list. The change log keeps a Delete entry."
        records={recordTable}
        cancelLabel="No"
        confirmLabel="Yes"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={modal?.kind === "serials"}
        onOpenChange={(o) => setModal(o ? { kind: "serials" } : null)}
        variant="danger"
        title="Are you sure?"
        description="All serial numbers in this shipment order will be removed."
        records={{ ...recordTable, rows: recordTable.rows.filter((_, i) => rows[i]?.hasSerials) }}
        cancelLabel="Cancel"
        confirmLabel="Remove"
        onConfirm={confirmRemoveSerials}
      />
      <PrintOptionsModal
        open={modal?.kind === "print"}
        onOpenChange={(o) => (o ? undefined : setModal(null))}
        typeKeys={modal?.kind === "print" ? modal.typeKeys : []}
        records={modal?.kind === "print" ? modal.records : []}
        clientId={modal?.kind === "print" ? modal.clientId : null}
        title={modal?.kind === "print" ? modal.title : "Print options"}
      />
      {view === "shipped" ? (
        <ReturnInfoDrawer rows={rows} open={Boolean(returnInfoOpen)} onOpenChange={(o) => onReturnInfoOpenChange?.(o)} onDone={done} />
      ) : null}
    </>
  );
}
