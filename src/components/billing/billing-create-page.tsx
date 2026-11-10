"use client";

/**
 * Create Billing Form (`/billing/new`): name, client, warehouse, calc. start date and
 * frequency with a live Summary card. Save opens the new form's edit page to add fees.
 * `?clientId=` pre-selects the client (from Client details).
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiRequest, isApiError } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { applyServerFieldErrors, type ApiQueryData } from "@/lib/query-client";
import type { ContractDetail } from "@/server/repositories/billing";
import { CONTRACT_DEFAULTS, contractSchema } from "@/lib/grid-defs/organization/billing";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormSection, SubmitBar, useZodForm } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { NO_PERMISSION, usePagePerms, useWarehouseOptions } from "@/components/facility/facility-shared";
import { ContractFields, ContractSummary } from "./contract-form";

export function BillingCreatePage() {
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePagePerms("settings.billing", ["create"] as const);
  const warehouses = useWarehouseOptions();
  const qc = useQueryClient();
  // After a 201 the form stays locked until the route change lands, so a second click can never create a duplicate.
  const [navigating, startNavigation] = React.useTransition();
  const createdId = React.useRef<string | null>(null);
  const form = useZodForm(contractSchema, { ...CONTRACT_DEFAULTS, clientId: params.get("clientId") ?? "", calcStartDate: new Date().toISOString().slice(0, 8) + "01" }, { mode: "onSubmit" });
  React.useEffect(() => {
    if (warehouses.defaultId && !form.getValues("warehouseId")) form.setValue("warehouseId", warehouses.defaultId);
  }, [warehouses.defaultId, form]);
  if (perms.loading) return <div className="flex flex-col gap-4 p-6" aria-busy="true"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (!perms.create) return <div className="p-6"><EmptyState title="You can't create billing forms" description={`${NO_PERMISSION}. Ask an administrator for 3PL Billing create access.`} action={<Button onClick={() => router.push("/billing")}>Back to 3PL Billing</Button>} /></div>;
  const submit = async (values: unknown) => {
    if (createdId.current) return;
    try {
      const { data } = await apiRequest<ContractDetail>("/api/billing", { method: "POST", body: values });
      // Seed the detail cache so the edit page paints its header immediately (no skeleton).
      if (Array.isArray(data.fees)) qc.setQueryData<ApiQueryData<ContractDetail>>(["billing-contract", data.id], { data } as ApiQueryData<ContractDetail>);
      toast.success("Success", `Billing form ${data.name} created. Add its fees next.`);
      createdId.current = data.id;
      form.reset(form.getValues());
      startNavigation(() => router.replace(`/billing/${data.id}`));
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
            <fieldset disabled={navigating || createdId.current !== null} className="contents" aria-busy={navigating || undefined}>
              <FormSection title="Billing form" description="Client and warehouse can't change once bills exist."><ContractFields /></FormSection>
            </fieldset>
            <SubmitBar submitLabel={navigating || createdId.current ? "Opening billing form…" : "Create and add fees"} pending={navigating || createdId.current !== null} onCancel={() => router.push("/billing")} />
          </div>
          <ContractSummary feeCount={0} />
        </div>
      </Form>
    </div>
  );
}
