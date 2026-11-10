"use client";

/**
 * Edit shipment order (`/orders/[id]`): the same six-step wizard in free mode with field
 * locks (warehouse / client always; lines once picking starts; everything but notes and
 * return info once shipped or cancelled), the right rail, workflow-blocked banner,
 * activity timeline, notes and documents. Saves send only changed fields + `version`
 * (409 → Reload prompt).
 */
import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useCan, usePermissionSet } from "@/lib/permissions-client";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { buttonVariants, Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { ActivityTimeline, DocumentsViewer, NotesPanel } from "@/components/shared";
import { PageHeader } from "@/components/layout/page-header";
import { errorMessage, orderDetailKey, useInvalidateOrders, useOrderOptions, type OrderDetail } from "../orders-client";
import { addressNeedsAttention, updateBody, valuesFromDetail, type OrderFormValues } from "../wizard/order-form-model";
import { carrierLookup, reportSaveError } from "../wizard/order-save";
import { buildOrderSteps } from "../wizard/order-steps";
import { RailCard, StatusCard } from "../wizard/order-summary";
import { OrderWizardProvider, type OrderLocks } from "../wizard/order-wizard-context";
import { OrderWizardShell } from "../wizard/order-wizard-shell";
import type { WizardController } from "@/components/ui/wizard";
import { DocumentsCards, JobsCard, OrderActionsMenu, SummaryCard } from "./order-detail-rail";

const TERMINAL = new Set(["Shipped", "Partially Shipped", "Delivered", "Cancelled"]);

export function orderLocks(detail: OrderDetail, canEdit: boolean): OrderLocks {
  if (!canEdit) return { header: "You don't have permission to edit shipment orders.", lines: "You don't have permission to edit shipment orders." };
  const status = detail.order.status;
  if (TERMINAL.has(status)) return { header: `This order is ${status}. Only notes and return info can still change.`, lines: `Lines can't change on a ${status} order.` };
  const allocated = detail.lines.some((l) => l.allocatedQuantity > 0 || l.pickedQuantity > 0);
  if (detail.actions.editLines) return { header: null, lines: detail.actions.editLines };
  if (allocated) return { header: null, lines: "Lines are locked while stock is allocated. Remove the order from its job to change them." };
  return { header: null, lines: null };
}

function WorkflowBanner({ detail, onChanged }: { readonly detail: OrderDetail; readonly onChanged: () => void }) {
  const canRelease = useCan(ORDER_PERMISSIONS.edit).allowed;
  const [busy, setBusy] = React.useState(false);
  const block = detail.workflowBlock;
  if (!block) return null;
  const release = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${detail.order.id}/release-block`, { method: "POST", body: { version: detail.order.version } });
      toast.success("Block released", `${detail.order.code} can be allocated and picked again.`);
      onChanged();
    } catch (error) {
      toast.error("Couldn't release the block", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Callout
      variant="error"
      title={`${block.blockType === "Fully" ? "Fully" : "Partially"} blocked by workflow “${block.workflowName}”`}
      action={
        <DisabledReason reason={canRelease ? null : "You don't have permission to release workflow blocks"}>
          <Button size="sm" variant="secondary" onClick={() => void release()} disabled={busy || !canRelease}>
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Release
          </Button>
        </DisabledReason>
      }
    >
      {block.blockType === "Fully" ? "The order can't be allocated or picked until the block is released." : "Some actions are held until the block is released."}
      {block.actions.length ? ` Actions: ${block.actions.join(", ")}.` : ""}
    </Callout>
  );
}

export function OrderDetailPage({ initial }: { readonly initial: OrderDetail }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateOrders();
  const key = orderDetailKey(initial.order.id);
  const query = useApiQuery<OrderDetail>(key, `/api/orders/${initial.order.id}`, { initialData: { data: initial }, staleTime: 5_000 });
  const detail = query.data?.data ?? initial;
  const { permissions } = usePermissionSet();
  const canEdit = permissions.has(ORDER_PERMISSIONS.edit);
  const options = useOrderOptions(detail.order.warehouseId, detail.order.clientId);
  const steps = React.useMemo(() => buildOrderSteps("edit"), []);
  const initialValues = React.useMemo(() => valuesFromDetail(detail), [detail]);
  const wizardRef = React.useRef<WizardController<OrderFormValues> | null>(null);
  const locks = orderLocks(detail, canEdit);

  const refresh = React.useCallback(async () => {
    await qc.invalidateQueries({ queryKey: key });
    await invalidate();
  }, [qc, key, invalidate]);

  const save = async (values: OrderFormValues) => {
    const body = updateBody(initialValues, values, detail.order.version, carrierLookup(options.data?.data));
    if (Object.keys(body.patch).length === 0 && !body.lines) {
      toast.info("No changes to save", `${detail.order.code} is already up to date.`);
      throw new Error("no-op");
    }
    try {
      await apiFetch(`/api/orders/${detail.order.id}`, { method: "PATCH", body });
      toast.success("Success", `${detail.order.code} was saved.`);
      await refresh();
    } catch (error) {
      reportSaveError(error, wizardRef.current, "save");
      throw error;
    }
  };

  const ctx = {
    mode: "edit" as const,
    options: options.data?.data,
    optionsLoading: options.isLoading,
    locks,
    detail,
    canCreateProduct: permissions.has(ORDER_PERMISSIONS.createProduct),
    canManageCustomFields: permissions.has(ORDER_PERMISSIONS.customFields),
  };
  const onChanged = () => void refresh();

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="Edit shipment order"
        crumbLabel={detail.order.code}
        helper={`${detail.clientName} · ${detail.warehouseLabel}`}
        actions={
          <>
            <StatusPill status={detail.order.status} domain="shipmentOrder" />
            <Link href={["Shipped", "Partially Shipped", "Delivered", "Cancelled"].includes(detail.order.status) ? "/orders/shipped" : "/orders"} className={buttonVariants({ variant: "secondary" })}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to list
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-6">
        <WorkflowBanner detail={detail} onChanged={onChanged} />
        {query.isError ? <Callout variant="error" title="Couldn't refresh this order" action={<Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry</Button>}>{query.error.message}</Callout> : null}
        <OrderWizardProvider value={ctx}>
          <OrderWizardShell<OrderFormValues>
            key={`${detail.order.id}:${detail.order.version}`}
            steps={steps}
            mode="free"
            defaultValues={initialValues}
            draftScope={false}
            stickyRail={false}
            onComplete={save}
            onController={(w) => {
              wizardRef.current = w;
            }}
            attention={(v) => (addressNeedsAttention(v) ? ["customer"] : [])}
            rail={(_values, wizard) => (
              <>
                <StatusCard
                  percent={wizard.percent}
                  subtitle={locks.header ?? (wizard.percent >= 100 ? "All required fields are complete" : "Some required fields are missing")}
                  saveLabel="Save shipment order"
                  onSave={() => void wizard.submit()}
                  saving={wizard.submitting}
                  disabledReason={!canEdit ? "You don't have permission to edit shipment orders" : wizard.saveDisabledReason}
                />
                <OrderActionsMenu detail={detail} onChanged={onChanged} />
                <SummaryCard detail={detail} />
                <JobsCard detail={detail} onChanged={onChanged} />
                <DocumentsCards detail={detail} onChanged={onChanged} />
              </>
            )}
            below={
              <div className="grid gap-5 xl:grid-cols-2">
                <RailCard title="Activity" className="xl:col-span-2">
                  <ActivityTimeline entityType="shipment_order" entityId={detail.order.id} ledgerPath={`/api/orders/${encodeURIComponent(detail.order.id)}/ledger`} />
                </RailCard>
                <RailCard title="Notes">
                  <NotesPanel entityType="shipment_order" entityId={detail.order.id} canEdit={canEdit} />
                </RailCard>
                <div id="order-documents" className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 shadow-xs">
                  <DocumentsViewer entityType="shipment_order" entityId={detail.order.id} canEdit={permissions.has(ORDER_PERMISSIONS.documentsUpload)} />
                </div>
              </div>
            }
          />
        </OrderWizardProvider>
      </div>
    </div>
  );
}
