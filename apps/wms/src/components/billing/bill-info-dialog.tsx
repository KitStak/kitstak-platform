"use client";

/** Edit Info dialog for a bill: bill number and status (Draft → Approved / Canceled; Approved → Draft / Canceled). */
import * as React from "react";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { BILL_STATUSES } from "@/lib/enums";
import { billInfoSchema, canTransitionBill, type BillInfoInput } from "@/lib/grid-defs/organization/billing-reports";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Form, FormGrid, SubmitBar, useZodForm } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { SelectField, TextInput } from "@/components/facility/form-controls";

export interface BillInfoTarget {
  readonly id: string;
  readonly billNumber: string;
  readonly billStatus: (typeof BILL_STATUSES)[number];
  readonly calcStatus: "Successful" | "Failed";
  readonly version: number;
}

export function BillInfoDialog({ bill, onOpenChange, onSaved }: { readonly bill: BillInfoTarget | null; readonly onOpenChange: (o: boolean) => void; readonly onSaved: () => void }) {
  const initial: BillInfoInput = { billNumber: bill?.billNumber ?? "", billStatus: bill?.billStatus ?? "Draft" };
  const form = useZodForm(billInfoSchema, initial, { mode: "onSubmit" });
  const [conflict, setConflict] = React.useState(false);
  React.useEffect(() => { if (bill) { form.reset({ billNumber: bill.billNumber, billStatus: bill.billStatus }); setConflict(false); } }, [bill, form]);
  const options = BILL_STATUSES.map((s) => {
    const allowed = bill ? canTransitionBill(bill.billStatus, s) && !(s === "Approved" && bill.calcStatus === "Failed") : true;
    return { value: s, label: s, disabled: !allowed, description: allowed ? undefined : bill?.billStatus === "Canceled" ? "Canceled bills are final" : s === "Approved" ? "Failed calculations can't be approved" : "Not allowed from this status" };
  });
  const submit = async (values: unknown) => {
    if (!bill) return;
    try {
      await apiRequest(`/api/billing-reports/${bill.id}`, { method: "PATCH", body: { ...(values as object), version: bill.version } });
      toast.success("Success", "Bill info updated.");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === "CONFLICT") setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't update the bill", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <Dialog open={bill !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Edit info" description="Bill number and status. Approved bills lock their period's VAS operations." />
        <Form form={form} onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-0">
          <DialogBody>
            {conflict ? <Callout variant="attention" title="This record changed since you opened it" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>Reload to see the latest bill.</Callout> : null}
            <FormGrid columns={1}>
              <TextInput<BillInfoInput> name="billNumber" label="Bill number" required maxLength={40} />
              <SelectField<BillInfoInput> name="billStatus" label="Bill status" required options={options} />
            </FormGrid>
          </DialogBody>
          <DialogFooter><SubmitBar requireDirty onCancel={() => onOpenChange(false)} className="w-full" /></DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
