"use client";

/**
 * Edit shipment order (`/orders/[id]`): the same six-step wizard in free mode with field
 * locks (warehouse / client always; lines once picking starts; everything but notes and
 * return info once shipped or cancelled), the right rail, workflow-blocked banner,
 * activity timeline, notes and documents. Saves send only changed fields + `version`
 * (409 → Reload prompt).
 */
import * as React from "react";
import { OrderStatusPill } from "../order-status-pill";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { useApiQuery } from "@/lib/query-client";
import { useCan, usePermissionSet } from "@/lib/permissions-client";
import { CHECKING_PERMISSIONS, useOrderPermissions } from "../use-order-permissions";
import { ORDER_PERMISSIONS } from "@/lib/grid-defs/orders/shipment-orders";
import { buttonVariants, Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import { ActivityTimeline, DocumentsViewer, NotesPanel } from "@/components/shared";
import { PageHeader } from "@/components/layout/page-header";
import { orderCrumbs, orderListCrumb } from "../order-crumbs";
import { errorMessage, orderDetailKey, useInvalidateOrders, useOrderOptions, type OrderDetail } from "../orders-client";
import { addressNeedsAttention, requiredCompletion, updateBody, valuesFromDetail, type OrderFormValues } from "../wizard/order-form-model";
import { carrierLookup, reportSaveError } from "../wizard/order-save";
import { buildOrderSteps } from "../wizard/order-steps";
import { RailCard, StatusCard } from "../wizard/order-summary";
import { OrderWizardProvider, type OrderLocks } from "../wizard/order-wizard-context";
import { OrderWizardShell } from "../wizard/order-wizard-shell";
import type { WizardController } from "@/components/ui/wizard";
import { UnderlineTabs } from "@/components/ui/tabs";
import { DocumentsCards, JobsCard, OrderActionsMenu, SummaryCard } from "./order-detail-rail";
import { OrderLinesTab, OrderOverviewCards, OrderShipmentsTab, type OrderDetailTab } from "./order-detail-tabs";

const ORDER_DETAIL_TABS = ["overview", "edit", "shipments", "activity"] as const;

/** Reads `?tab=` / `?step=`; a known step implies the Edit tab. */
export function initialTabFromUrl(search: string, stepKeys: readonly string[]): { readonly tab: OrderDetailTab | null; readonly step: string | null } {
  const params = new URLSearchParams(search);
  const t = params.get("tab");
  const s = params.get("step");
  const step = s && stepKeys.includes(s) ? s : null;
  const tab = t && (ORDER_DETAIL_TABS as readonly string[]).includes(t) ? (t as OrderDetailTab) : step ? "edit" : null;
  return { tab, step: tab === "edit" ? step : null };
}

/** Badge on JOBS & SHIPMENTS: assigned jobs plus packages (either can exist without the other). */
export function jobsAndShipmentsCount(detail: Pick<OrderDetail, "jobs" | "shipments"> & { readonly order: { readonly jobId: string | null } }): number {
  const jobs = detail.jobs.length || (detail.order.jobId ? 1 : 0);
  return jobs + detail.shipments.length;
}

/** The change log is read-only history: anyone who can see the order can read it (grid kebab and detail agree). */
export function canViewChangeLog(permissions: ReadonlySet<string>): boolean {
  return permissions.has(ORDER_PERMISSIONS.changeLog) || permissions.has(ORDER_PERMISSIONS.view);
}
import { CHANGE_LOG_PAGE_SIZE } from "@/components/shared/change-log-drawer";

export const SHOW_DOCUMENTS_EVENT = "order:show-documents";

const TERMINAL = new Set(["Shipped", "Partially Shipped", "Delivered", "Cancelled"]);

export function orderLocks(detail: OrderDetail, canEdit: boolean, permissionsReady = true): OrderLocks {
  // Never show denial copy while /api/me is still loading: lock quietly with a neutral reason.
  if (!permissionsReady) return { header: CHECKING_PERMISSIONS, lines: CHECKING_PERMISSIONS };
  if (!canEdit) return { header: "You don't have permission to edit shipment orders.", lines: "You don't have permission to edit shipment orders." };
  const status = detail.order.status;
  if (TERMINAL.has(status)) return { header: `This order is ${status}. Only notes and return info can still change.`, lines: `Lines can't change on a ${status} order.` };
  const allocated = detail.lines.some((l) => l.allocatedQuantity > 0 || l.pickedQuantity > 0);
  if (detail.actions.editLines) return { header: null, lines: detail.actions.editLines };
  if (allocated) return { header: null, lines: "Lines are locked while stock is allocated. Remove the order from its job to change them." };
  return { header: null, lines: null };
}

/** On Hold: who held it, when, and the optional reason (critic r5: the reason must be visible, not only logged). */
function HoldBanner({ detail }: { readonly detail: OrderDetail }) {
  const hold = detail.hold;
  if (!hold) return null;
  const when = hold.at ? new Date(hold.at).toLocaleString() : null;
  return (
    <Callout variant="attention" title="This order is on hold">
      {hold.reason ? <>Reason: <strong className="text-foreground">{hold.reason}</strong>. </> : "No hold reason was given. "}
      {when || hold.by ? `Held${hold.by ? ` by ${hold.by}` : ""}${when ? ` on ${when}` : ""}. ` : ""}
      It can&apos;t be allocated, picked or shipped until the hold is released.
    </Callout>
  );
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
  const perms = useOrderPermissions();
  const canEdit = perms.can(ORDER_PERMISSIONS.edit);
  const options = useOrderOptions(detail.order.warehouseId, detail.order.clientId);
  const steps = React.useMemo(() => buildOrderSteps("edit"), []);
  const initialValues = React.useMemo(() => valuesFromDetail(detail), [detail]);
  const wizardRef = React.useRef<WizardController<OrderFormValues> | null>(null);
  const locks = orderLocks(detail, canEdit, perms.ready);
  const [tab, setTabState] = React.useState<OrderDetailTab>("overview");
  // The active tab lives in `?tab=` so it survives reloads and can be linked to.
  const setTab = React.useCallback((next: OrderDetailTab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    if (next !== "edit") url.searchParams.delete("step");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  // `?tab=edit&step=customer` (grid kebab "Edit") opens the editable form at that step.
  const pendingStep = React.useRef<string | null>(null);
  React.useEffect(() => {
    const target = initialTabFromUrl(window.location.search, steps.map((s) => s.key));
    if (target.tab) setTabState(target.tab);
    if (target.step) {
      pendingStep.current = target.step;
      if (wizardRef.current) {
        wizardRef.current.goTo(target.step);
        pendingStep.current = null;
      }
    }
  }, [steps]);
  // Warm the change-log cache with the drawer's exact key so "Show change log" opens instantly.
  useApiQuery<unknown>(["change-log", "shipment_order", detail.order.id], canViewChangeLog(permissions) ? "/api/change-log" : null, {
    query: { entityType: "shipment_order", entityId: detail.order.id, page: 1, ps: CHANGE_LOG_PAGE_SIZE },
    staleTime: 15_000,
  });
  React.useEffect(() => {
    const show = () => {
      setTab("overview");
      window.setTimeout(() => document.getElementById("order-documents")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    };
    window.addEventListener(SHOW_DOCUMENTS_EVENT, show);
    return () => window.removeEventListener(SHOW_DOCUMENTS_EVENT, show);
  }, [setTab]);

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
    optionsRefreshing: options.isPlaceholderData,
    locks,
    detail,
    canCreateProduct: permissions.has(ORDER_PERMISSIONS.createProduct),
    canManageCustomFields: permissions.has(ORDER_PERMISSIONS.customFields),
  };
  const onChanged = () => void refresh();

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title={`Shipment order ${detail.order.code}`}
        breadcrumbs={orderCrumbs(orderListCrumb(detail.order.status), detail.order.code)}
        helper={`${detail.clientName} · ${detail.warehouseLabel}`}
        actions={
          <>
            <OrderStatusPill status={detail.order.status} />
            <Link href={orderListCrumb(detail.order.status).href ?? "/orders"} className={buttonVariants({ variant: "secondary" })}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to list
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-6">
        <WorkflowBanner detail={detail} onChanged={onChanged} />
        <HoldBanner detail={detail} />
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
              if (pendingStep.current) {
                const target = pendingStep.current;
                pendingStep.current = null;
                w.goTo(target);
              }
            }}
            attention={(v) => (addressNeedsAttention(v) ? ["customer"] : [])}
            rail={(values, wizard) => (
              <>
                <StatusCard
                  percent={requiredCompletion(values)}
                  subtitle={(perms.ready ? locks.header : null) ?? (!canEdit ? "Read only: you can view this order" : requiredCompletion(values) >= 100 ? "All required fields are complete" : "Some required fields are missing")}
                  saveLabel="Save shipment order"
                  // Save lives on the Edit tab only, and only for roles that can edit.
                  onSave={tab === "edit" && canEdit ? () => void wizard.submit() : undefined}
                  saving={wizard.submitting}
                  disabledReason={perms.reason(ORDER_PERMISSIONS.edit, "You don't have permission to edit shipment orders") ?? wizard.saveDisabledReason}
                />
                <OrderActionsMenu detail={detail} onChanged={onChanged} />
                <SummaryCard detail={detail} />
                <JobsCard detail={detail} onChanged={onChanged} />
                <DocumentsCards detail={detail} onChanged={onChanged} />
              </>
            )}
            header={
              <div className="rounded-lg border border-border bg-surface shadow-xs">
                <UnderlineTabs
                  ariaLabel="Order sections"
                  className="px-4"
                  active={tab}
                  onChange={(k) => setTab(k as OrderDetailTab)}
                  tabs={[
                    // Capitalised so the accessible name matches the uppercase visual label.
                    { key: "overview", label: "OVERVIEW", count: detail.lines.length },
                    { key: "edit", label: canEdit && (!perms.ready || !locks.header) ? "EDIT ORDER" : "ORDER DETAILS" },
                    // Jobs and packages both live on this tab, so the badge counts both.
                    { key: "shipments", label: "JOBS & SHIPMENTS", count: jobsAndShipmentsCount(detail) },
                    { key: "activity", label: "ACTIVITY" },
                  ]}
                />
              </div>
            }
            main={
              tab === "edit" ? undefined : (
                <div role="tabpanel" aria-label={tab} className="flex min-w-0 flex-col gap-5">
                  {tab === "overview" ? (
                    <>
                      <RailCard title="Lines">
                        <OrderLinesTab detail={detail} />
                      </RailCard>
                      <OrderOverviewCards detail={detail} />
                      <div className="grid gap-5 xl:grid-cols-2">
                        <div className="rounded-lg border border-border bg-surface p-4 shadow-xs">
                          <NotesPanel entityType="shipment_order" entityId={detail.order.id} canEdit={perms.ready && canEdit} />
                        </div>
                        <div id="order-documents" className="scroll-mt-4 rounded-lg border border-border bg-surface p-4 shadow-xs">
                          <DocumentsViewer entityType="shipment_order" entityId={detail.order.id} canEdit={permissions.has(ORDER_PERMISSIONS.documentsUpload)} />
                        </div>
                      </div>
                    </>
                  ) : tab === "shipments" ? (
                    <RailCard title="Jobs & shipments">
                      <OrderShipmentsTab detail={detail} />
                    </RailCard>
                  ) : (
                    <RailCard title="Activity">
                      <ActivityTimeline entityType="shipment_order" entityId={detail.order.id} ledgerPath={`/api/orders/${encodeURIComponent(detail.order.id)}/ledger`} />
                    </RailCard>
                  )}
                </div>
              )
            }
          />
        </OrderWizardProvider>
      </div>
    </div>
  );
}
