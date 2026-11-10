"use client";

/**
 * Create Billing Form (`/billing/new`): name, client, warehouse, calc. start date and
 * frequency with a live Summary card. Save opens the new form's edit page to add fees.
 * `?clientId=` pre-selects the client (from Client details).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest, isApiError } from "@/lib/api-client";
import { applyServerFieldErrors } from "@/lib/query-client";
import { CONTRACT_DEFAULTS, contractSchema } from "@/lib/grid-defs/organization/billing";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Form, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { NO_PERMISSION, usePagePerms, useWarehouseOptions } from "@/components/facility/facility-shared";
import { ContractFields, ContractSummary } from "./contract-form";

export function BillingCreatePage() {
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePagePerms("settings.billing", ["create"] as const);
  const warehouses = useWarehouseOptions();
  const form = useZodForm(contractSchema, { ...CONTRACT_DEFAULTS, clientId: params.get("clientId") ?? "", calcStartDate: new Date().toISOString().slice(0, 8) + "01" }, { mode: "onSubmit" });
  React.useEffect(() => {
    if (warehouses.defaultId && !form.getValues("warehouseId")) form.setValue("warehouseId", warehouses.defaultId);
  }, [warehouses.defaultId, form]);
  if (!perms.loading && !perms.create) return <div className="p-6"><EmptyState title="You can't create billing forms" description={NO_PERMISSION} /></div>;
  const submit = async (values: unknown) => {
    try {
      const { data } = await apiRequest<{ id: string; name: string }>("/api/billing", { method: "POST", body: values });
      toast.success("Success", `Billing form ${data.name} created. Add its fees next.`);
      form.reset(form.getValues());
      router.push(`/billing/${data.id}`);
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error("Couldn't create the billing form", isApiError(error) ? error.message : "Something went wrong");
      throw error;
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Create billing form" helper="Start with who is billed and how often; fees are added on the next screen." />
      <Form form={form} onSubmit={submit} guardUnsaved className="px-6 pb-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-xs">
            <FormSection title="Billing form" description="Client and warehouse can't change once bills exist."><ContractFields /></FormSection>
            <SubmitBar submitLabel="Create and add fees" onCancel={() => router.push("/billing")} />
          </div>
          <ContractSummary feeCount={0} />
        </div>
      </Form>
    </div>
  );
}
