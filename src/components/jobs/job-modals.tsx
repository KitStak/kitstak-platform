"use client";

/**
 * Modals behind the Job Management / Task Details bulk menus (Logiwa 02 §1, §7):
 * Update Priority (attention modal with cards), Assign User (3-character user search) and
 * the "Different Warehouses Selected" guard.
 */
import * as React from "react";
import { AlertTriangle, ArrowUp, Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { DisabledReason } from "@/components/ui/tooltip";
import { UserPicker } from "@/components/shared";
import { labelClass } from "@/components/ui/control-styles";
import { JOB_PRIORITY_CHOICES } from "@/lib/grid-defs/jobs/jobs";

export function AttentionBand({ title, tone = "warning" }: { readonly title: string; readonly tone?: "warning" | "danger" }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-t-lg px-5 py-4", tone === "warning" ? "bg-warning-soft" : "bg-danger-soft")}>
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-white", tone === "warning" ? "bg-warning" : "bg-danger")}>
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </span>
      <DialogHeader title={title} className="p-0" />
    </div>
  );
}

/** "Attention — Different Warehouses Selected" with an OK button. */
export function DifferentWarehousesDialog({ open, onClose, noun = "jobs" }: { readonly open: boolean; readonly onClose: () => void; readonly noun?: string }) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm">
        <AttentionBand title="Attention" />
        <DialogBody className="flex flex-col gap-2">
          <p className="text-[14px] font-semibold text-foreground">Different warehouses selected</p>
          <p className="text-[13px] leading-5 text-body">
            Assign and unassign can only be performed for {noun} in the same warehouse. Please update your selection and try again.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onClose} autoFocus>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PRIORITY_COPY: Readonly<Record<(typeof JOB_PRIORITY_CHOICES)[number], { readonly hint: string; readonly tone: string }>> = {
  None: { hint: "No priority tag", tone: "text-secondary" },
  Low: { hint: "Picked after everything else", tone: "text-[#2E7D32]" },
  Medium: { hint: "Ahead of low and untagged jobs", tone: "text-[#B26A00]" },
  High: { hint: "Pickers see these first", tone: "text-[#E55B56]" },
};

export function UpdatePriorityModal({ open, count, onClose, onSave }: { readonly open: boolean; readonly count: number; readonly onClose: () => void; readonly onSave: (priority: string) => Promise<void> }) {
  const [choice, setChoice] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) setChoice(null);
  }, [open]);
  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      await onSave(choice);
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="md">
        <AttentionBand title="Attention" />
        <DialogBody className="flex flex-col gap-3">
          <p className="text-[13px] leading-5 text-body">Previously assigned/selected priorities will change after your new priority selection.</p>
          <p className="text-[13px] font-semibold text-foreground">Set priority for {count === 1 ? "the selected job" : `${count} selected jobs`}.</p>
          <div role="radiogroup" aria-label="Priority" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {JOB_PRIORITY_CHOICES.map((p) => {
              const active = choice === p;
              const Icon = p === "High" ? ArrowUp : p === "None" ? Minus : null;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setChoice(p)}
                  className={cn(
                    "relative flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    active ? "border-primary bg-primary-soft shadow-sm" : "border-border hover:border-border-strong hover:bg-surface-sunken",
                  )}
                >
                  <span className={cn("flex items-center gap-1 text-[13px] font-semibold", PRIORITY_COPY[p].tone)}>
                    {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
                    {p}
                  </span>
                  <span className="text-[11px] leading-4 text-faint">{PRIORITY_COPY[p].hint}</span>
                  {active ? <Check className="absolute right-2 top-2 h-3.5 w-3.5 text-primary" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <DisabledReason reason={choice ? null : "Choose a priority"}>
            <Button variant="primary" onClick={() => void save()} disabled={!choice || saving} aria-busy={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
              Save
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignUserModal({ open, warehouseId, noun, onClose, onAssign }: { readonly open: boolean; readonly warehouseId: string | null; readonly noun: string; readonly onClose: () => void; readonly onAssign: (userId: string) => Promise<void> }) {
  const [userId, setUserId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (open) setUserId(null);
  }, [open]);
  const assign = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      await onAssign(userId);
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogHeader title="Assign user" description={`Assign a user to the selected ${noun}.`} />
        <DialogBody className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="assign-user">User <span className="text-danger">*</span></label>
          <UserPicker id="assign-user" warehouseId={warehouseId} value={userId} onChange={(v) => setUserId(v)} placeholder="Search user" />
          <p className="text-[11px] text-faint">Only users with access to this warehouse are listed.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <DisabledReason reason={userId ? null : "Choose a user"}>
            <Button variant="primary" onClick={() => void assign()} disabled={!userId || saving} aria-busy={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" label="Assigning" /> : null}
              Assign
            </Button>
          </DisabledReason>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
