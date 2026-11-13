'use client';

/**
 * Edit Billing Form (`/billing/[id]`): header card with pencil (Edit info dialog), Show
 * change log, Approve / Cancel approval, Calculate, Print (contract printout); fee cards
 * with search + operation filter, the inline Create / Edit Fee form, a Summary grid, and
 * the contract's recent bills. Fees lock while the contract is approved.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  Calculator,
  CheckCircle2,
  Copy,
  History,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { applyServerFieldErrors, useApiQuery, type ApiQueryData } from '@/lib/query-client';
import { BILLING_OPERATION_TYPES } from '@/lib/enums';
import {
  chargeUnit,
  contractSchema,
  PRICING_MODE_META,
  type ContractInput,
} from '@/lib/grid-defs/organization/billing';
import { AutoBreadcrumbs } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Form, SubmitBar, useZodForm } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import {
  EntityChangeLogDrawer,
  NO_PERMISSION,
  toastBulk,
  useAction,
  usePagePerms,
  type BulkResponse,
} from '@/components/facility/facility-shared';
import type { ContractDetail, FeeView } from '@/server/repositories/billing';
import type { ReportRow } from '@/server/repositories/billing-reports';
import {
  BillingPill,
  CalculateDialog,
  OperationPill,
  useBillingDates,
  FREQUENCY_LABELS,
  moneyGrid,
  moneyRail,
  printContract,
} from './billing-shared';
import { ContractFields } from './contract-form';
import { FeeForm } from './fee-form';

const PERMS = ['view', 'edit', 'delete', 'change_log', 'calculate', 'copy'] as const;

/** From GET /api/billing/[id]: when the period-end scheduler next bills the contract. */
type AutoRun = { readonly periodStart: string; readonly periodEnd: string; readonly runDay: string };

function EditInfoDialog({
  contract,
  open,
  onOpenChange,
  onSaved,
}: {
  readonly contract: ContractDetail;
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly onSaved: () => void;
}) {
  const initial: ContractInput = {
    name: contract.name,
    clientId: contract.clientId,
    warehouseId: contract.warehouseId,
    calcStartDate: contract.calcStartDate,
    frequency: contract.frequency,
  };
  const form = useZodForm(contractSchema, initial, { mode: 'onSubmit' });
  const [conflict, setConflict] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      form.reset(initial);
      setConflict(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (values: unknown) => {
    try {
      await apiRequest(`/api/billing/${contract.id}`, {
        method: 'PATCH',
        body: { ...(values as object), version: contract.version },
      });
      toast.success('Success', 'Billing form updated.');
      onSaved();
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error("Couldn't save", isApiError(error) ? error.message : 'Something went wrong');
      throw error;
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Edit billing form" description="Client and warehouse lock once bills exist." />
        <Form form={form} onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-0">
          <DialogBody>
            {conflict ? (
              <Callout
                variant="attention"
                title="This bill changed since you opened it"
                action={
                  <Button size="sm" onClick={() => window.location.reload()}>
                    Reload
                  </Button>
                }
              >
                Someone else saved this billing form.
              </Callout>
            ) : null}
            <ContractFields
              lockedScope={contract.reportCount > 0 ? 'Locked: this contract already has bills' : null}
            />
          </DialogBody>
          <DialogFooter>
            <SubmitBar onCancel={() => onOpenChange(false)} requireDirty className="w-full" />
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function priceLines(f: FeeView, currency: string): string[] {
  const unit = chargeUnit(f.chargeBy);
  if (f.calculationType === 'Split Month Storage')
    return [
      `${moneyGrid(f.standardRate, currency)} per ${unit} through day ${f.splitDay}`,
      `${moneyGrid(f.alternateRate, currency)} per ${unit} after (first receipts)`,
    ];
  const first = f.tiers[0];
  if (f.pricingMode === 'perUnit' && first) return [`${moneyGrid(first.rate, currency)} per ${unit}`];
  if (f.pricingMode === 'fromQuantity' && first)
    return [`${moneyGrid(first.rate, currency)} per ${unit} from ${first.fromQty ?? 1}`];
  return f.tiers.map((t) =>
    f.tiers.length === 1 && (t.fromQty ?? 1) <= 1 && t.toQty === null
      ? `${moneyGrid(t.rate, currency)} per ${unit}`
      : `${t.fromQty ?? 1}–${t.toQty ?? '∞'} @ ${moneyGrid(t.rate, currency)}`,
  );
}

function FeeBadges({ fee }: { readonly fee: FeeView }) {
  return (
    <>
      <OperationPill operation={fee.operationType} />
      {fee.calculationType ? (
        <Badge tone="neutral" shape="pill">
          {fee.calculationType}
        </Badge>
      ) : null}
      {fee.vasTypeName ? (
        <Badge tone="neutral" shape="pill">
          {fee.vasTypeName}
        </Badge>
      ) : null}
      {fee.calculationType !== 'Split Month Storage' && fee.tiers.length > 1 ? (
        <Badge tone="outline" shape="pill">
          {PRICING_MODE_META[fee.pricingMode].title}
        </Badge>
      ) : null}
      {fee.chargeOneTime ? (
        <Badge tone="info" shape="pill" title="Billed on the next successful bill only, then skipped">
          One-time
        </Badge>
      ) : null}
    </>
  );
}

function FeeCard({
  fee,
  currency,
  locked,
  onEdit,
  onDelete,
}: {
  readonly fee: FeeView;
  readonly currency: string;
  readonly locked: string | null;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs transition hover:-translate-y-px hover:shadow-sm">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{fee.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <FeeBadges fee={fee} />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${fee.name}`}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem icon={Pencil} onSelect={onEdit} disabledReason={locked}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={Trash2} destructive onSelect={onDelete} disabledReason={locked}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-faint">Fee by</dt>
        <dd className="text-body">{fee.feeBy}</dd>
        <dt className="text-faint">Charge by</dt>
        <dd className="text-body">{fee.chargeBy}</dd>
      </dl>
      <div className="rounded-lg bg-surface-sunken/70 px-3 py-2">
        {priceLines(fee, currency).map((l) => (
          <div key={l} className="text-sm font-semibold tabular-nums text-foreground">
            {l}
          </div>
        ))}
        {fee.useMinPrice || fee.useMaxPrice ? (
          <div className="mt-1 text-2xs text-secondary">
            {[
              fee.useMinPrice ? `Min ${moneyRail(fee.minPrice, currency)}` : '',
              fee.useMaxPrice ? `Max ${moneyRail(fee.maxPrice, currency)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        ) : null}
      </div>
      {fee.conditions.length ? (
        <ul className="flex flex-col gap-1">
          {fee.conditions.map((c) => (
            <li key={c.text} className="text-xs text-secondary">
              If {c.text}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function BillingEditPage({ id }: { readonly id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const perms = usePagePerms('settings.billing', PERMS);
  const dates = useBillingDates();
  const q = useApiQuery<ContractDetail & { readonly nextAutoRun?: AutoRun | null }>(
    ['billing-contract', id],
    `/api/billing/${id}`,
    { staleTime: 0 },
  );
  const bills = useApiQuery<readonly ReportRow[]>(['billing-contract-bills', id], `/api/billing-reports`, {
    query: { contractId: id, ps: 100, sort: '-calculatedAt' },
  });
  const [feeEditor, setFeeEditor] = React.useState<{ fee: FeeView | null } | null>(null);
  const [feeBusy, setFeeBusy] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [opFilter, setOpFilter] = React.useState<string | null>(null);
  const [editInfo, setEditInfo] = React.useState(params.get('edit') === '1');
  const [log, setLog] = React.useState(false);
  const [calc, setCalc] = React.useState(false);
  const [confirm, setConfirm] = React.useState<
    'approve' | 'cancel' | 'delete' | 'duplicate' | { fee: FeeView } | null
  >(null);
  const action = useAction([
    ['billing-contract', id],
    ['billing-contract-bills', id],
    ['grid', 'billing-contracts'],
  ]);
  const qc = useQueryClient();
  const c = q.data?.data;
  const refetch = () => {
    void q.refetch();
    void bills.refetch();
  };
  /** Patches the cached contract immediately (pill, lock, last calculation); `refresh` re-syncs from the server afterwards. */
  const patchContract = (patch: Partial<ContractDetail>, refresh = true) => {
    qc.setQueryData<ApiQueryData<ContractDetail>>(['billing-contract', id], (old) =>
      old ? { ...old, data: { ...old.data, ...patch } } : old,
    );
    if (refresh)
      for (const queryKey of [
        ['billing-contract', id],
        ['billing-contract-bills', id],
        ['grid', 'billing-contracts'],
      ])
        void qc.invalidateQueries({ queryKey });
  };
  const setApproval = async (approve: boolean) => {
    if (!c || approving) return;
    // Never approve while a fee is open or saving: the approval would lock fees under the pending save.
    if (approve && (feeBusy || feeEditor)) {
      toast.warning('Finish the fee first', "Save or cancel the fee you're editing, then approve.");
      return;
    }
    const before = c.approvalStatus;
    setApproving(true);
    // Send the request first; the optimistic pill only shows once it is really in flight.
    const request = apiRequest<BulkResponse>(
      approve ? '/api/billing/approve' : '/api/billing/cancel-approval',
      { method: 'POST', body: { ids: [c.id] } },
    );
    void qc.cancelQueries({ queryKey: ['billing-contract', id] });
    patchContract({ approvalStatus: approve ? 'Approved' : 'Draft' }, false);
    try {
      const { data: r } = await request;
      if (r.failed.length) patchContract({ approvalStatus: before }, false);
      toastBulk(r, 'billing form', approve ? 'approved' : 'set back to draft');
    } catch (error) {
      patchContract({ approvalStatus: before }, false);
      toast.error(
        approve ? "Couldn't approve" : "Couldn't cancel the approval",
        isApiError(error) ? error.message : 'Something went wrong',
      );
    } finally {
      setApproving(false);
      // Reconcile with the server whatever happened.
      for (const queryKey of [
        ['billing-contract', id],
        ['grid', 'billing-contracts'],
      ])
        void qc.invalidateQueries({ queryKey });
    }
  };

  if (q.isPending)
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  if (q.isError || !c) {
    const missing = isApiError(q.error) && q.error.code === 'NOT_FOUND';
    return (
      <div className="p-6">
        <EmptyState
          title={missing ? 'Billing form not found' : "Couldn't load this billing form"}
          description={missing ? "It may have been deleted, or it's outside your scope." : q.error?.message}
          action={
            missing ? (
              <Button onClick={() => router.push('/billing')}>Back to 3PL Billing</Button>
            ) : (
              <Button onClick={() => void q.refetch()}>Retry</Button>
            )
          }
        />
      </div>
    );
  }
  const locked = !perms.edit
    ? NO_PERMISSION
    : c.approvalStatus === 'Approved'
      ? 'Cancel the approval before changing fees'
      : null;
  const fees = c.fees.filter(
    (f) =>
      (!opFilter || f.operationType === opFilter) &&
      (!search.trim() ||
        `${f.name} ${f.feeBy} ${f.chargeBy} ${f.operationType}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const deleteReason = !perms.delete
    ? NO_PERMISSION
    : c.approvalStatus === 'Approved'
      ? 'Cancel the approval first'
      : c.reportCount > 0
        ? "Contracts with bills can't be deleted"
        : null;
  const billRows = bills.data?.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* One title: the contract name in the header card; the breadcrumb gives the context. */}
      <div className="px-6 pt-3">
        <AutoBreadcrumbs currentLabel={c.name} />
      </div>
      <div className="flex flex-col gap-5 px-6 pb-10 pt-2">
        <section
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
          aria-label="Billing form header"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="min-w-0 break-words text-lg font-semibold leading-tight text-foreground">
                  {c.name}
                </h1>
                <DisabledReason reason={perms.edit ? null : NO_PERMISSION}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit billing form info"
                    disabled={!perms.edit}
                    onClick={() => setEditInfo(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </DisabledReason>
                <BillingPill status={c.approvalStatus} />
              </div>
              <p className="mt-0.5 text-sm text-secondary">
                <Link href={`/clients/${c.clientId}`} className="text-primary hover:underline">
                  {c.clientName}
                </Link>{' '}
                · {c.warehouseCode} · {c.currency}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setLog(true)}>
                <History className="h-4 w-4" />
                Show change log
              </Button>
              <Button onClick={() => printContract(c, dates)}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <DisabledReason
                reason={
                  !perms.calculate
                    ? NO_PERMISSION
                    : c.fees.length === 0
                      ? 'Add fees before calculating'
                      : null
                }
              >
                <Button disabled={!perms.calculate || c.fees.length === 0} onClick={() => setCalc(true)}>
                  <Calculator className="h-4 w-4" />
                  Calculate
                </Button>
              </DisabledReason>
              {c.approvalStatus === 'Approved' ? (
                <DisabledReason reason={perms.edit ? null : NO_PERMISSION}>
                  <Button
                    disabled={!perms.edit || approving}
                    aria-busy={approving}
                    onClick={() => setConfirm('cancel')}
                  >
                    <Ban className="h-4 w-4" />
                    Cancel approval
                  </Button>
                </DisabledReason>
              ) : (
                <DisabledReason
                  reason={
                    !perms.edit
                      ? NO_PERMISSION
                      : c.fees.length === 0
                        ? 'Add at least one fee first'
                        : feeBusy
                          ? 'Wait for the fee to finish saving'
                          : feeEditor
                            ? "Save or cancel the fee you're editing first"
                            : null
                  }
                >
                  <Button
                    variant="primary"
                    disabled={
                      !perms.edit || c.fees.length === 0 || feeBusy || feeEditor !== null || approving
                    }
                    aria-busy={approving}
                    onClick={() => setConfirm('approve')}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </Button>
                </DisabledReason>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" aria-label="More actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    icon={Copy}
                    disabledReason={perms.copy ? null : NO_PERMISSION}
                    onSelect={() => setConfirm('duplicate')}
                  >
                    Duplicate billing form
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    icon={Trash2}
                    destructive
                    disabledReason={deleteReason}
                    onSelect={() => setConfirm('delete')}
                  >
                    Delete billing form
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 border-t border-border pt-4 text-sm md:grid-cols-3 lg:grid-cols-6">
            {[
              ['Calc. start date', dates.day(c.calcStartDate)],
              ['Billing period', FREQUENCY_LABELS[c.frequency] ?? c.frequency],
              [
                'Next auto-run',
                c.nextAutoRun
                  ? `${dates.day(c.nextAutoRun.runDay)} · bills ${dates.period(c.nextAutoRun.periodStart, c.nextAutoRun.periodEnd)}`
                  : 'Off until approved',
              ],
              ['Last calculation', c.lastCalculatedAt ? dates.at(c.lastCalculatedAt) : 'Never'],
              ['Fees', String(c.fees.length)],
              [
                'Last bill',
                c.lastReport
                  ? `${c.lastReport.billNumber} · ${moneyRail(c.lastReport.totalPrice, c.currency)}`
                  : 'None yet',
              ],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-2xs font-semibold text-faint">{k}</dt>
                <dd className="mt-0.5 tabular-nums text-foreground">
                  {c.lastReport && k === 'Last bill' ? (
                    <Link
                      className="text-primary hover:underline"
                      href={`/billing/reports/${c.lastReport.id}`}
                    >
                      {v}
                    </Link>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {c.approvalStatus === 'Approved' ? (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-sunken/60 px-3.5 py-2.5 text-sm"
          >
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
            <div>
              <p className="font-semibold text-foreground">Approved: fees are locked</p>
              <p className="text-secondary">
                The scheduler checks every hour and bills this contract at each period end
                {c.nextAutoRun ? (
                  <>
                    ; next automatic calculation{' '}
                    <strong className="text-foreground">{dates.day(c.nextAutoRun.runDay)}</strong> for{' '}
                    {dates.period(c.nextAutoRun.periodStart, c.nextAutoRun.periodEnd)}
                  </>
                ) : null}
                . Cancel the approval to change fees.
              </p>
            </div>
          </div>
        ) : null}

        <section className="flex flex-col gap-3" aria-label="Fees">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-base font-semibold text-foreground">
              Fees <span className="font-normal text-faint">({c.fees.length})</span>
            </h2>
            <div className="w-60">
              <TextField
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
                placeholder="Search fees"
                leading={<Search className="h-4 w-4" />}
                aria-label="Search fees"
              />
            </div>
            <div className="w-48">
              <Select
                aria-label="Filter by operation"
                placeholder="All operations"
                clearable
                value={opFilter}
                onChange={setOpFilter}
                options={BILLING_OPERATION_TYPES.map((o) => ({ value: o, label: o }))}
              />
            </div>
            <DisabledReason reason={locked}>
              <Button
                variant="primary"
                disabled={Boolean(locked) || feeEditor !== null}
                onClick={() => setFeeEditor({ fee: null })}
              >
                <Plus className="h-4 w-4" />
                Create fee
              </Button>
            </DisabledReason>
          </div>
          {feeEditor ? (
            <FeeForm
              key={feeEditor.fee?.id ?? 'new'}
              contractId={c.id}
              fee={feeEditor.fee}
              onBusyChange={setFeeBusy}
              onCancel={() => setFeeEditor(null)}
              onDone={() => {
                setFeeEditor(null);
                refetch();
              }}
            />
          ) : null}
          {c.fees.length === 0 && !feeEditor ? (
            <EmptyState
              title="No fees yet"
              description="Add receiving, storage, pick and pack, shipment, VAS or recurring fees. Each fee can have tiers, conditions and a minimum or maximum."
              action={
                locked ? undefined : (
                  <Button variant="primary" onClick={() => setFeeEditor({ fee: null })}>
                    <Plus className="h-4 w-4" />
                    Create fee
                  </Button>
                )
              }
            />
          ) : fees.length === 0 && c.fees.length > 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-secondary">
              No fees match.{' '}
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => {
                  setSearch('');
                  setOpFilter(null);
                }}
              >
                Clear search
              </button>
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {fees.map((f) => (
                <FeeCard
                  key={f.id}
                  fee={f}
                  currency={c.currency}
                  locked={locked}
                  onEdit={() => setFeeEditor({ fee: f })}
                  onDelete={() => setConfirm({ fee: f })}
                />
              ))}
            </div>
          )}
        </section>

        {c.fees.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="Summary">
            <h2 className="text-base font-semibold text-foreground">Summary</h2>
            <div
              className="relative overflow-x-auto rounded-lg border border-border bg-surface"
              tabIndex={0}
              aria-label="Fee summary table, scrolls horizontally"
            >
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-surface-sunken text-2xs font-semibold text-secondary">
                  <tr>
                    {[
                      'Fee',
                      'Operation',
                      'Calculation',
                      'Fee by',
                      'Charge by',
                      'Price',
                      'Min',
                      'Max',
                      'Conditions',
                    ].map((h, i) => (
                      <th
                        key={h}
                        className={
                          i === 0
                            ? 'sticky left-0 z-10 bg-surface-sunken px-3 py-2 shadow-[1px_0_0_var(--border)]'
                            : 'px-3 py-2'
                        }
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {c.fees.map((f) => (
                    <tr key={f.id} className="group/row align-top hover:bg-surface-sunken/40">
                      <td className="sticky left-0 z-10 max-w-[220px] bg-surface px-3 py-2 font-medium text-foreground shadow-[1px_0_0_var(--border)] group-hover/row:bg-surface-sunken">
                        {f.name}
                        {f.chargeOneTime ? (
                          <Badge tone="info" shape="pill" size="sm" className="ml-1.5 align-middle">
                            One-time
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <OperationPill operation={f.operationType} />
                      </td>
                      <td className="px-3 py-2">{f.calculationType ?? 'None'}</td>
                      <td className="px-3 py-2">{f.feeBy}</td>
                      <td className="px-3 py-2">{f.chargeBy}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {priceLines(f, c.currency).map((l) => (
                          <div key={l}>{l}</div>
                        ))}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {f.useMinPrice ? moneyGrid(f.minPrice, c.currency) : 'None'}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {f.useMaxPrice ? moneyGrid(f.maxPrice, c.currency) : 'None'}
                      </td>
                      <td className="px-3 py-2 text-secondary">
                        {f.conditions.length ? f.conditions.map((x) => x.text).join('; ') : 'None'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2" aria-label="Bills">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">
              Bills <span className="font-normal text-faint">({billRows.length})</span>
            </h2>
            {billRows.length ? (
              <Link
                className="text-sm font-semibold text-primary hover:underline"
                href={`/billing/reports?f.contractName=eq:${encodeURIComponent(c.name)}`}
              >
                Open in Billing Report
              </Link>
            ) : null}
          </div>
          {billRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-secondary">
              No bills yet. Calculate to create the first one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-sunken text-2xs font-semibold text-secondary">
                  <tr>
                    {['Bill number', 'Period', 'Calculation', 'Status', 'Total', 'Calculated'].map((h) => (
                      <th key={h} className="px-3 py-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {billRows.slice(0, 12).map((b) => (
                    <tr key={b.id} className="hover:bg-surface-sunken/40">
                      <td className="px-3 py-2">
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`/billing/reports/${b.id}`}
                        >
                          {b.billNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{dates.period(b.periodStart, b.periodEnd)}</td>
                      <td className="px-3 py-2">
                        <BillingPill status={b.calcStatus} />
                      </td>
                      <td className="px-3 py-2">
                        <BillingPill status={b.billStatus} />
                      </td>
                      <td className="px-3 py-2 tabular-nums">{moneyGrid(b.totalPrice, b.currency)}</td>
                      <td className="px-3 py-2 tabular-nums">{dates.at(b.calculatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <EditInfoDialog contract={c} open={editInfo} onOpenChange={setEditInfo} onSaved={refetch} />
      <EntityChangeLogDrawer
        open={log}
        onOpenChange={setLog}
        path={log ? `/api/billing/${c.id}/change-log` : null}
        title={`Change log · ${c.name}`}
      />
      <CalculateDialog
        open={calc}
        onOpenChange={setCalc}
        contracts={[{ id: c.id, name: c.name }]}
        onDone={(reports) => {
          if (!reports.length) return;
          const now = new Date().toISOString();
          // periodEnd from the API is the inclusive last day; stored bills end at 23:59:59.999 of that day.
          const fresh: ReportRow[] = reports.map(
            (r) =>
              ({
                id: r.reportId,
                contractId: c.id,
                contractName: c.name,
                billNumber: r.billNumber,
                calcStatus: r.status,
                clientId: c.clientId,
                clientName: c.clientName,
                warehouseId: c.warehouseId,
                warehouseCode: c.warehouseCode,
                calculatedAt: now,
                createdByName: null,
                periodStart: r.periodStart ? `${r.periodStart}T00:00:00.000Z` : now,
                periodEnd: r.periodEnd ? `${r.periodEnd}T23:59:59.999Z` : now,
                billStatus: 'Draft',
                totalPrice: r.totalPrice,
                currency: 'USD',
                exportedToIntegration: false,
                errorMessage: r.errorMessage,
                frequency: c.frequency,
                createdAt: now,
              }) as ReportRow,
          );
          // Show the new bill(s) at once; the background refetch replaces them with the server rows.
          const replaced = new Set(reports.flatMap((r) => r.replaced ?? []));
          qc.setQueriesData<ApiQueryData<readonly ReportRow[]>>(
            { queryKey: ['billing-contract-bills', id] },
            (old) =>
              old
                ? {
                    ...old,
                    data: [
                      ...fresh,
                      ...old.data
                        .filter((row) => !fresh.some((f) => f.id === row.id))
                        .map((row) =>
                          replaced.has(row.billNumber) ? { ...row, billStatus: 'Canceled' as const } : row,
                        ),
                    ],
                  }
                : old,
          );
          const ok = reports.filter((r) => r.status === 'Successful').length;
          if (ok) patchContract({ lastCalculatedAt: now, reportCount: c.reportCount + ok });
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        variant={
          confirm === 'approve' || confirm === 'duplicate'
            ? 'info'
            : confirm === 'cancel'
              ? 'attention'
              : 'danger'
        }
        title={
          confirm === 'approve'
            ? `Approve ${c.name}?`
            : confirm === 'cancel'
              ? `Cancel the approval of ${c.name}?`
              : confirm === 'delete'
                ? `Delete ${c.name}?`
                : confirm === 'duplicate'
                  ? `Duplicate ${c.name}?`
                  : confirm
                    ? `Delete fee ${confirm.fee.name}?`
                    : ''
        }
        description={
          confirm === 'approve'
            ? 'Fees lock and the scheduler bills the contract at each period end.'
            : confirm === 'cancel'
              ? 'The contract goes back to Draft and stops auto-billing until approved again.'
              : confirm === 'delete'
                ? "The billing form and its fees are removed. This can't be undone."
                : confirm === 'duplicate'
                  ? `The copy keeps every fee, tier and condition, starts as Draft, and opens when it's ready.${c.approvalStatus === 'Approved' ? ' This contract stays approved: cancel its approval before approving the copy, or both would bill the same activity.' : ''}`
                  : 'The fee is removed from this billing form; existing bills keep their lines.'
        }
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={async () => {
          if (confirm === 'duplicate') {
            const r = await action.run<
              BulkResponse & {
                created?: readonly { id: string; name: string }[];
                warnings?: readonly string[];
              }
            >('/api/billing/duplicate', 'POST', { ids: [c.id] });
            setConfirm(null);
            const copy = r?.created?.[0];
            if (r) toastBulk(r, 'billing form', 'duplicated');
            for (const w of r?.warnings ?? []) toast.warning('Copy is Draft', w);
            if (copy) router.push(`/billing/${copy.id}`);
            return;
          }
          if (confirm === 'approve' || confirm === 'cancel') {
            const approve = confirm === 'approve';
            setConfirm(null);
            await setApproval(approve);
            return;
          } else if (confirm === 'delete') {
            const r = await action.run<BulkResponse>('/api/billing/bulk-delete', 'POST', { ids: [c.id] });
            if (r) {
              toastBulk(r, 'billing form', 'deleted');
              if (r.succeeded.length) router.push('/billing');
            }
          } else if (confirm) {
            const r = await action.run(`/api/billing/${c.id}/fees/${confirm.fee.id}`, 'DELETE');
            if (r) toast.success('Success', `Fee ${confirm.fee.name} deleted.`);
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}
