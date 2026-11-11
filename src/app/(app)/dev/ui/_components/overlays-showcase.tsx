"use client";

import * as React from "react";
import { ClipboardList, Copy, MoreHorizontal, Package, Pencil, Printer, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { openTransactionsTray } from "@/lib/transactions-events";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, type DialogSize } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageTabs, SegmentedTabs, UnderlineTabs, VerticalNav } from "@/components/ui/tabs";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { DisabledReason, Tooltip } from "@/components/ui/tooltip";
import { GroupTabs } from "@/components/layout/page-header";
import { ShowcaseSection, Specimen } from "./showcase-section";

const SIZES: readonly DialogSize[] = ["sm", "md", "lg", "xl"];
const CONFIRM_DEMO_DELAY_MS = 600;

/** 0.3 feedback contract: the toast title names the outcome, the message names the records. */
export const CONFIRM_RESULT: Readonly<Record<"danger" | "attention" | "type", { readonly title: string; readonly message: string }>> = {
  danger: { title: "Orders cancelled", message: "SO010421, SO010422 cancelled (demo)." },
  attention: { title: "Released from hold", message: "SO010421, SO010422 released from hold (demo)." },
  type: { title: "Orders deleted", message: "SO010421, SO010422 deleted (demo)." },
};

function DrawerDemo() {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open drawer (unsaved guard)</Button>
      <Drawer
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setName(""); }}
        title="New vendor"
        width={35}
        dirty={name.length > 0}
        footer={<div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!name} onClick={() => { toast.success("Saved", `${name} created.`); setName(""); setOpen(false); }}>Save</Button></div>}
      >
        <label htmlFor="drawer-vendor" className="mb-1 block text-xs font-semibold text-body">Vendor name <span className="text-danger">*</span></label>
        <TextField id="drawer-vendor" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type, then press Esc to see the guard" />
      </Drawer>
    </>
  );
}

function ConfirmDemo() {
  const [open, setOpen] = React.useState<"danger" | "attention" | "type" | null>(null);
  const records = { columns: [{ key: "code", label: "Order" }, { key: "status", label: "Status" }], rows: [
    { code: "SO010421", status: <StatusPill status="Open" domain="shipmentOrder" size="sm" /> },
    { code: "SO010422", status: <StatusPill status="Ready to Pick" domain="shipmentOrder" size="sm" /> },
  ] };
  return (
    <>
      <Button variant="danger" onClick={() => setOpen("danger")}>Cancel 2 orders</Button>
      <Button onClick={() => setOpen("attention")}>Attention confirm</Button>
      <Button onClick={() => setOpen("type")}>Type-to-confirm</Button>
      <ConfirmDialog
        open={open !== null}
        onOpenChange={(next) => (next ? undefined : setOpen(null))}
        variant={open === "attention" ? "attention" : "danger"}
        title={open === "type" ? "Delete 2 orders permanently?" : open === "attention" ? "Release orders from hold?" : "Are you sure you want to cancel these orders?"}
        description="This writes a change-log entry for each record."
        records={records}
        typeToConfirm={open === "type" ? "DELETE" : undefined}
        onConfirm={async () => {
          const result = CONFIRM_RESULT[open ?? "danger"];
          await new Promise((resolve) => setTimeout(resolve, CONFIRM_DEMO_DELAY_MS));
          toast.success(result.title, result.message);
        }}
      />
    </>
  );
}

function NavigationShowcase() {
  const [tab, setTab] = React.useState("backlog");
  const [segment, setSegment] = React.useState("new");
  const [vertical, setVertical] = React.useState("general");
  return (
    <ShowcaseSection id="navigation" title="Tabs & navigation" description="Route tabs come from src/config/page-tabs.ts; every tab is a real URL.">
      <Specimen label="Route tab group (page-tabs: orders)"><div className="w-full"><GroupTabs group="orders" /></div></Specimen>
      <Specimen label="Page tabs (explicit)"><div className="w-full"><PageTabs tabs={[{ href: "/dev/ui", label: "UI Showcase" }, { href: "/notifications", label: "Notifications" }]} /></div></Specimen>
      <Specimen label="Underline tabs (state)"><div className="w-full"><UnderlineTabs active={tab} onChange={setTab} tabs={[{ key: "backlog", label: "Order backlog", count: 412 }, { key: "shipped", label: "Shipped", count: 9120 }, { key: "returns", label: "Returns", disabled: true }]} /></div></Specimen>
      <Specimen label="Segmented tabs"><SegmentedTabs active={segment} onChange={setSegment} tabs={[{ key: "new", label: "New" }, { key: "saved", label: "Saved" }]} /></Specimen>
      <Specimen label="Vertical nav">
        <div className="w-56 rounded-lg border border-border p-1">
          <VerticalNav active={vertical} onChange={setVertical} items={[{ key: "general", label: "General", icon: Package }, { key: "shipping", label: "Shipping", icon: Truck, count: 3 }, { key: "printouts", label: "Printouts", icon: Printer }]} />
        </div>
      </Specimen>
    </ShowcaseSection>
  );
}

export function OverlaysShowcase() {
  const [dialogSize, setDialogSize] = React.useState<DialogSize | null>(null);
  return (
    <>
      <ShowcaseSection id="overlays" title="Overlays & menus" description="Dialogs, confirm, drawer with unsaved-changes guard, toasts, tooltips, popovers and menus.">
        <Specimen label="Dialogs">
          {SIZES.map((size) => <Button key={size} onClick={() => setDialogSize(size)}>Dialog {size}</Button>)}
          <Dialog open={dialogSize !== null} onOpenChange={(open) => (open ? undefined : setDialogSize(null))}>
            <DialogContent size={dialogSize ?? "md"}>
              <DialogHeader title={`Dialog (${dialogSize ?? "md"})`} description="Esc, the X and the overlay all close it." />
              <DialogBody><p className="text-sm text-secondary">Dialog body content.</p></DialogBody>
              <DialogFooter><Button onClick={() => setDialogSize(null)}>Close</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </Specimen>
        <Specimen label="Confirm dialog"><ConfirmDemo /></Specimen>
        <Specimen label="Drawer"><DrawerDemo /></Specimen>
        <Specimen label="Toasts">
          <Button onClick={() => toast.success("Success", "Order SO010421 shipped.")}>Success</Button>
          <Button onClick={() => toast.error("Error", "Label creation failed: address invalid.")}>Error</Button>
          <Button onClick={() => toast.warning("Warning", "3 of 4 orders shipped · 1 failed")}>Warning</Button>
          <Button onClick={() => toast.show({ variant: "info", title: "Export started", message: "Preparing the Excel file. It appears in Transactions when ready.", action: { label: "Open transactions", onClick: openTransactionsTray } })}>Info + action</Button>
        </Specimen>
        <Specimen label="Tooltips, info tips, disabled reasons">
          <Tooltip content="Tooltips explain icons and disabled actions"><Button>Hover me</Button></Tooltip>
          <span className="flex items-center gap-1 text-sm text-body">Batch size <InfoTip content="Orders per job when creating jobs in bulk." /></span>
          <DisabledReason reason="Select at least one order"><Button variant="primary" disabled>Create job</Button></DisabledReason>
        </Specimen>
        <Specimen label="Popover & dropdown menu">
          <Popover>
            <PopoverTrigger asChild><Button>Popover</Button></PopoverTrigger>
            <PopoverContent className="w-64"><p className="text-sm text-body">Popover content with any controls.</p></PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button>Other actions <MoreHorizontal className="h-4 w-4" aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuLabel>Order</DropdownMenuLabel>
              <DropdownMenuItem icon={Pencil} onSelect={() => toast.info("Edit", "Edit selected")}>Edit</DropdownMenuItem>
              <DropdownMenuItem icon={Copy} description="Creates a copy in Open status" onSelect={() => toast.info("Duplicate", "Duplicate selected")}>Duplicate</DropdownMenuItem>
              <DropdownMenuItem icon={ClipboardList} disabledReason="Only Open orders can be picked">Create job</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={Printer}>Print</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => toast.info("Print", "Packing slip")}>Packing slip</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => toast.info("Print", "Picking list")}>Picking list</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={Trash2} destructive onSelect={() => toast.error("Delete", "Delete selected")}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Specimen>
      </ShowcaseSection>
      <NavigationShowcase />
    </>
  );
}
