'use client';

/**
 * Purchase order wizard (5 steps). Create (`/receiving/new`, linear) and detail / edit
 * (`/receiving/[id]`, free: every step clickable, opens on Confirm, client locked).
 * The right rail shows the PO status ring, a live price total and Confirm / Save.
 */
import * as React from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import {
  Building2,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  FileCheck2,
  History,
  ListChecks,
  Lock,
  Package,
  Plus,
  Settings2,
} from 'lucide-react';
import { RailRow, Wizard, WizardSuccess, type WizardStep } from '@/components/ui/wizard';
import { ActionCards } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useFormat } from '@/lib/format';
import { applyServerFieldErrors, useApiQuery } from '@/lib/query-client';
import { customFieldsQueryKey } from '@/components/shared/custom-fields-drawer';
import { errorMessage, useInvalidateReceiving, type PoDetail } from '../receiving-shared';
import {
  confirmStepSchema,
  detailsCanProceed,
  detailsStepSchema,
  emptyValues,
  firstIssue,
  linesQty,
  linesTotal,
  productsStepSchema,
  skuCount,
  toPayload,
  valuesFromDetail,
  vendorStepSchema,
  type PoFormValues,
} from './po-form-model';
import { StepConfirm, StepOther } from './step-confirm';
import { StepDetails } from './step-details';
import { StepProducts } from './step-products';
import { StepVendor } from './step-vendor';

export const PO_RAIL_HINT = 'Follow all the steps to complete purchase order';
const CLOSED = new Set(['Completed', 'Cancelled']);

/** Jumps once to `target` after mount (edit opens on Confirm, or on `?step=`). */
function InitialStep({
  goTo,
  target,
  doneRef,
}: {
  readonly goTo: (key: string) => void;
  readonly target: string;
  readonly doneRef: React.MutableRefObject<boolean>;
}) {
  React.useEffect(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (target !== 'details') goTo(target);
  }, [goTo, target, doneRef]);
  return null;
}

/** Marks the Confirm step as shown (see `confirmStepSchema`). */
function MarkReviewed({ form }: { readonly form: UseFormReturn<PoFormValues> }) {
  React.useEffect(() => {
    if (!form.getValues('reviewed')) form.setValue('reviewed', true, { shouldValidate: true });
  }, [form]);
  return null;
}

/**
 * Compact stepper below `lg` (tablet): only the current step keeps its label, the others
 * show their icon, so all five steps fit at 768px (the nav still scrolls on phones).
 */
export const COMPACT_STEPPER =
  'max-lg:[&_nav[aria-label=Progress]_button]:min-w-0 max-lg:[&_nav[aria-label=Progress]_button:not([aria-current])>span:last-child]:hidden max-lg:[&_nav[aria-label=Progress]_li>span]:mx-1.5';

/**
 * The shared wizard's body/rail grid has no explicit column below `lg`, so its implicit `auto`
 * track grows to the widest table's min-content (page-level horizontal scroll at 768px). Pin
 * the single column to `minmax(0,1fr)` and let the grid items shrink, so wide tables scroll
 * inside their own card (shared fix filed as REQ-R2-18).
 */
export const WIZARD_GRID_FIT = 'max-lg:[&>div.grid]:grid-cols-[minmax(0,1fr)] [&>div.grid>div]:min-w-0';

export interface PoWizardProps {
  readonly po: PoDetail | null;
  /** Step to open on in edit mode (default Confirm). */
  readonly initialStep?: string;
  /** Extra rail content (detail page: other actions, summary, billing, printouts). */
  readonly railExtra?: React.ReactNode;
  readonly onSaved?: (po: PoDetail) => void;
  readonly defaults?: { readonly warehouseId?: string | null; readonly clientId?: string | null };
  /** Create mode: "Create another" success card. */
  readonly onCreateAnother?: () => void;
  /** Create mode: notified once the PO is created (the page hides "Cancel order"). */
  readonly onCreated?: (po: PoDetail) => void;
  /** Detail without the edit permission: read-only review, no Save / Edit / step links. */
  readonly readOnly?: boolean;
  /** Overrides the read-only explainer (view mode: the viewer can edit but hasn't asked to). */
  readonly readOnlyNote?: string;
}

/** Read-only purchase order (view mode, or roles without `inventory.purchase_orders.edit`). */
function ReadOnlyPo({
  po,
  railExtra,
  note,
}: {
  readonly po: PoDetail;
  readonly railExtra?: React.ReactNode;
  readonly note?: string;
}) {
  const fmt = useFormat();
  const values = React.useMemo(() => valuesFromDetail(po), [po]);
  const form = useForm<PoFormValues>({ defaultValues: values });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 rounded-lg border border-border bg-surface p-5 shadow-xs">
        <header className="mb-4">
          <h2 className="text-base font-semibold text-foreground">Order review</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-secondary">
            <Lock className="h-3 w-3" aria-hidden />
            {note ??
              (po.status === 'Cancelled'
                ? 'View only. A cancelled purchase order can’t be edited.'
                : 'View only. You don’t have permission to edit purchase orders.')}
          </p>
        </header>
        <StepConfirm
          form={form}
          duplicate={null}
          onDismissDuplicate={() => undefined}
          goTo={() => undefined}
          receiving={po.receivedQuantity > 0}
          readOnly
          vendorFallback={po.vendor}
        />
      </div>
      <aside className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-xs shadow-xs lg:sticky lg:top-4">
        <div className="rounded-md bg-surface-sunken px-3 py-2">
          <p className="text-2xs font-semibold text-faint">Price</p>
          <p className="text-lg font-bold tabular-nums text-foreground">
            Total {fmt.money(linesTotal(values.lines))}
          </p>
        </div>
        <RailRow label="Number of SKU">{skuCount(values.lines)}</RailRow>
        <RailRow label="Total qty">{linesQty(values.lines).toLocaleString()}</RailRow>
        {railExtra}
      </aside>
    </div>
  );
}

/**
 * A restored draft (reload mid-wizard) can carry `codeChecking: true` from a PO-number check
 * that never finished, which would block Next / Confirm forever. Past step 1 no check is in
 * flight, so the flag is cleared on mount; the POST still rejects a duplicate number (409).
 */
function StaleCodeCheckReset({ form }: { readonly form: UseFormReturn<PoFormValues> }) {
  React.useEffect(() => {
    if (form.getValues('codeChecking')) form.setValue('codeChecking', false);
  }, [form]);
  return null;
}

export function PoWizard(props: PoWizardProps) {
  if (props.readOnly && props.po)
    return <ReadOnlyPo po={props.po} railExtra={props.railExtra} note={props.readOnlyNote} />;
  return <EditablePoWizard {...props} />;
}

function EditablePoWizard({
  po,
  initialStep = 'confirm',
  railExtra,
  onSaved,
  defaults,
  onCreateAnother,
  onCreated,
}: PoWizardProps) {
  const fmt = useFormat();
  const invalidate = useInvalidateReceiving();
  const editing = po !== null;
  const closed = po ? CLOSED.has(po.status) : false;
  const formRef = React.useRef<UseFormReturn<PoFormValues> | null>(null);
  const jumped = React.useRef(false);
  const [duplicate, setDuplicate] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<PoDetail | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const defaultValues = React.useMemo(
    () => (po ? valuesFromDetail(po) : emptyValues(defaults)),
    [po, defaults],
  );
  // Warm Step 4's custom-field definitions (same cache entry as CustomFieldsSection) so the
  // step renders its fields at once instead of skeletons.
  useApiQuery<unknown>(customFieldsQueryKey('purchase_order'), '/api/custom-fields', {
    query: { entityType: 'purchase_order' },
    staleTime: 60_000,
  });

  const bind = (form: UseFormReturn<PoFormValues>) => {
    formRef.current = form;
  };

  const steps: readonly WizardStep<PoFormValues>[] = [
    {
      key: 'details',
      label: 'PO details',
      icon: ClipboardList,
      schema: detailsStepSchema,
      canProceed: (v) => detailsCanProceed(v),
      description: 'Warehouse, client, number, type and dates.',
      render: ({ form, goTo }) => {
        bind(form);
        return (
          <>
            {editing ? <InitialStep goTo={goTo} target={initialStep} doneRef={jumped} /> : null}
            <StepDetails form={form} editing={editing} poId={po?.id ?? null} />
          </>
        );
      },
    },
    {
      key: 'products',
      label: 'Products',
      icon: Package,
      schema: productsStepSchema,
      canProceed: (v) => (closed ? true : firstIssue(productsStepSchema, v)),
      description: closed
        ? "Lines of a closed purchase order can't change."
        : "Search the client's products and set quantity and price.",
      render: ({ form }) => {
        bind(form);
        return (
          <>
            <StaleCodeCheckReset form={form} />
            <StepProducts form={form} readOnly={closed} exportName={po?.code} />
          </>
        );
      },
    },
    {
      key: 'vendor',
      label: 'Vendor',
      icon: Building2,
      schema: vendorStepSchema,
      canProceed: (v) => firstIssue(vendorStepSchema, v),
      description: 'Select the vendor that ships this order.',
      render: ({ form }) => {
        bind(form);
        return (
          <>
            <StaleCodeCheckReset form={form} />
            <StepVendor form={form} />
          </>
        );
      },
    },
    {
      key: 'other',
      label: 'Other info',
      icon: Settings2,
      isOptional: true,
      render: ({ form }) => {
        bind(form);
        return (
          <>
            <StaleCodeCheckReset form={form} />
            <StepOther form={form} disabled={false} />
          </>
        );
      },
    },
    {
      key: 'confirm',
      label: 'Confirm',
      icon: FileCheck2,
      schema: confirmStepSchema,
      description: editing
        ? 'Review the order. Click any step to change it.'
        : 'Review and confirm the purchase order.',
      render: ({ form, goTo }) => {
        bind(form);
        return (
          <>
            {editing ? <InitialStep goTo={goTo} target={initialStep} doneRef={jumped} /> : null}
            <MarkReviewed form={form} />
            <StaleCodeCheckReset form={form} />
            <StepConfirm
              form={form}
              duplicate={duplicate}
              onDismissDuplicate={() => setDuplicate(null)}
              goTo={goTo}
              receiving={Boolean(po && po.receivedQuantity > 0)}
              vendorFallback={po?.vendor ?? null}
            />
          </>
        );
      },
    },
  ];

  const submit = async (values: PoFormValues) => {
    setDuplicate(null);
    try {
      const body = toPayload(values, po?.version);
      if (po) {
        // Save on an unchanged form is a no-op with feedback (no empty PATCH, no version bump).
        if (formRef.current && !formRef.current.formState.isDirty) {
          toast.info('No changes to save', `${po.code} is unchanged.`);
          return;
        }
        const { data } = await apiRequest<PoDetail>(`/api/purchase-orders/${po.id}`, {
          method: 'PATCH',
          body: { ...body, clientId: undefined },
        });
        toast.success('Success', `Purchase order ${data.code} saved.`);
        await invalidate();
        onSaved?.(data);
      } else {
        const { data } = await apiRequest<PoDetail>('/api/purchase-orders', { method: 'POST', body });
        // Show the success screen at once; list caches refresh in the background.
        setCreated(data);
        onCreated?.(data);
        void invalidate();
      }
    } catch (error) {
      const form = formRef.current;
      if (isApiError(error) && error.code === 'DUPLICATE') {
        setDuplicate(error.message);
        form?.setValue('codeConflict', error.message);
      } else if (form) {
        applyServerFieldErrors(form, error);
      }
      toast.error('Error', errorMessage(error));
      throw error;
    }
  };

  const railSummary = (v: PoFormValues) => (
    <>
      {editing ? (
        <p
          role="status"
          aria-live="polite"
          className={`flex items-center gap-1.5 text-xs font-medium ${dirty ? 'text-warning' : 'text-success'}`}
        >
          {dirty ? (
            <CircleDot className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {dirty ? 'Unsaved changes' : 'All changes saved'}
        </p>
      ) : (
        <p className="text-xs text-secondary">{PO_RAIL_HINT}</p>
      )}
      <div className="rounded-md bg-surface-sunken px-3 py-2">
        <p className="text-2xs font-semibold text-faint">Price</p>
        <p className="text-lg font-bold tabular-nums text-foreground" aria-live="polite">
          Total {fmt.money(linesTotal(v.lines ?? []))}
        </p>
      </div>
      {/* Detail: PO number / client / vendor live in the Summary card below (no duplicates). */}
      {editing ? null : (
        <>
          <RailRow label="PO number">{v.code || '—'}</RailRow>
          <RailRow label="Client">{v.clientLabel || '—'}</RailRow>
          <RailRow label="Vendor">{v.vendorLabel || '—'}</RailRow>
        </>
      )}
      <RailRow label="Number of SKU">{skuCount(v.lines ?? [])}</RailRow>
      <RailRow label="Total qty">{linesQty(v.lines ?? []).toLocaleString()}</RailRow>
      {railExtra}
    </>
  );

  const success = created ? (
    <div className="rounded-lg border border-border bg-surface p-8 shadow-xs">
      <WizardSuccess
        entity={
          <>
            a new purchase order:{' '}
            <a className="text-primary hover:underline" href={`/receiving/${created.id}`}>
              {created.code}
            </a>
          </>
        }
        verb="created"
        description={`${created.lines.length} line${created.lines.length === 1 ? '' : 's'} · ${created.totalQuantity.toLocaleString()} units · ${fmt.money(created.purchasePrice)} · Status: ${created.status}`}
        options={[]}
      />
      {/* The three next steps sit in one row on desktop (Logiwa parity), never 2 + 1. */}
      <p className="mt-6 text-center text-xs font-semibold text-faint">What can you do next?</p>
      <ActionCards
        className="mx-auto mt-3 max-w-[980px] lg:grid-cols-3"
        cards={[
          {
            title: 'Go to the purchase order list',
            description: 'See all purchase orders, filter them and receive them in bulk.',
            icon: ListChecks,
            href: '/receiving',
          },
          {
            title: 'Create another purchase order',
            description: 'Start a new purchase order for the same or another client.',
            icon: Plus,
            onClick: onCreateAnother,
          },
          {
            title: 'View receiving history',
            description: 'See every receipt with its quantities, locations and who received it.',
            icon: History,
            href: '/receiving/history',
          },
        ]}
      />
    </div>
  ) : null;

  return (
    <Wizard<PoFormValues>
      className={`${COMPACT_STEPPER} ${WIZARD_GRID_FIT}`}
      steps={steps}
      mode={editing ? 'free' : 'linear'}
      defaultValues={defaultValues}
      onComplete={submit}
      submitLabel={editing ? 'Save purchase order' : 'Confirm purchase order'}
      draftScope={editing ? false : undefined}
      // On edit the rail names the PO's lifecycle ("Completed · 15/15 received"), not form progress.
      railTitle={
        po
          ? `${po.status} · ${po.receivedQuantity.toLocaleString()}/${po.totalQuantity.toLocaleString()} received`
          : 'PO status'
      }
      railSummary={railSummary}
      onDirtyChange={editing ? setDirty : undefined}
      success={success}
    />
  );
}
