"use client";

/** Manual PO status change (rail pencil): allowed state-machine targets only, with a reason. */
import * as React from "react";
import { z } from "zod";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Form, useZodForm } from "@/components/ui/form";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { apiRequest } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { AreaF, SelectF } from "./fields";
import { errorMessage, type PoDetail } from "./receiving-shared";

const schema = z.object({
  status: z.string().min(1, "Choose the new status"),
  reason: z.string().trim().min(3, "Enter a reason (at least 3 characters)").max(250, "Use at most 250 characters"),
});

const HINTS: Readonly<Record<string, string>> = {
  Started: "Marks the order as being received.",
  Completed: "Closes the order. Actual receiving and completed dates are stamped; it can't be received any more.",
  Cancelled: "Cancels the order. It can't be received or changed afterwards.",
  Pending: "Returns the order to Pending.",
};

export function PoStatusModal({ po, open, onOpenChange, onChanged }: { readonly po: PoDetail; readonly open: boolean; readonly onOpenChange: (open: boolean) => void; readonly onChanged: (po: PoDetail) => void }) {
  const form = useZodForm(schema, { status: po.allowedStatuses[0] ?? "", reason: "" });
  const [busy, setBusy] = React.useState(false);
  const status = form.watch("status");
  const options = po.allowedStatuses.map((s) => ({ value: s, label: <StatusPill status={s} domain="purchaseOrder" size="sm" />, textValue: s, description: HINTS[s] }));

  const save = async (v: z.output<typeof schema>) => {
    setBusy(true);
    try {
      const { data } = await apiRequest<PoDetail>(`/api/purchase-orders/${po.id}/status`, { method: "POST", body: { ...v, version: po.version } });
      toast.success("Success", `${po.code} is now ${data.status}.`);
      onChanged(data);
      onOpenChange(false);
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Change status" description={`${po.code} is ${po.status}. Only the transitions the order allows are listed.`} />
        <Form form={form} onSubmit={save}>
          <DialogBody className="flex flex-col gap-4">
            {options.length === 0 ? (
              <Callout variant="info" title="No status change available">{`A ${po.status.toLowerCase()} purchase order can't move to another status.`}</Callout>
            ) : (
              <>
                <SelectF name="status" label="New status" required options={options} />
                {status && HINTS[status] ? <p className="-mt-2 text-[12px] text-secondary">{HINTS[status]}</p> : null}
                <AreaF name="reason" label="Reason" required maxLength={250} rows={3} placeholder="Why is the status changing?" />
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={busy || options.length === 0} aria-busy={busy}>
              {busy ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
              Change status
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
