'use client';

/**
 * Create New Count / Edit Count / Show Details drawer (Logiwa 04 §6.1), 2 steps:
 *   1.General  Name* (0/50, CNT code suggested), Warehouse*, Description, Scheduled Count Date*, Lock Locations
 *   2.Tasks    Location Count | SKU Count (switching asks first when lines exist), Remove / Add,
 *              Add Location / Add Product pickers with full filters. Save stays disabled while empty.
 * Inline errors + focus on the first invalid field, unsaved-changes guard, 409 Reload prompt.
 */
import * as React from 'react';
import Link from 'next/link';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Boxes, MapPin, Package, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { apiFetch, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { useMe } from '@/lib/permissions-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Drawer } from '@/components/ui/drawer';
import { FieldError, FieldLabel } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { CountStatusPill } from './count-status-pill';
import { CharacterCount, TextField } from '@/components/ui/text-field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { DisabledReason, Tooltip } from '@/components/ui/tooltip';
import { WizardPills, type StepMeta } from '@/components/ui/wizard';
import { YesNoToggle } from '@/components/ui/yes-no-toggle';
import { WarehouseSelect } from '@/components/shared/entity-pickers';
import { CountPickerModal } from './count-picker-modal';
import { CountSuggestDialog } from './count-suggest-dialog';
import { DateCell, QtyCell } from '@/components/grid/cells';
import {
  COUNT_LOCATION_PICKER_FIELDS,
  COUNT_LP_PICKER_FIELDS,
  COUNT_PRODUCT_PICKER_FIELDS,
} from '@/lib/grid-defs/counts/count-grids';
import type { CountLineListRow, CountPlanListRow } from '@/lib/grid-defs/counts/count-rows';
import { planNameLockedReason } from '@/lib/grid-defs/counts/count-math';
import { useFilterFields, COUNT_QUERY_TIMEOUT_MS } from './counts-client';

export type DrawerMode = 'create' | 'edit' | 'view';

interface TaskItem {
  readonly id: string;
  readonly label: string;
  readonly sub1: string | null;
  readonly sub2: string | null;
  readonly onHand: number | null;
  /** AI Count Plan: why this row was suggested. */
  readonly reasons?: readonly string[];
}

interface PickLocation {
  readonly id: string;
  readonly code: string;
  readonly locationType: string | null;
  readonly locationGroup: string | null;
  readonly zone: string;
  readonly onHand: number;
  readonly allocated?: number;
  readonly skuCount: number;
  readonly isLocked: boolean;
  readonly openCountCode?: string | null;
  readonly abcCode?: string | null;
  readonly aisle?: string | null;
  readonly rack?: string | null;
  readonly level?: string | null;
  readonly preventAllocation?: boolean;
  readonly hasInventory?: boolean;
  readonly lastCountedAt?: string | null;
}
interface PickProduct {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly clientName: string;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly onHand: number;
  readonly allocated?: number;
  readonly openCountCode?: string | null;
  readonly isKit?: boolean;
  readonly trackLot?: boolean;
  readonly trackSerial?: boolean;
  readonly trackExpiry?: boolean;
  readonly status?: string | null;
  readonly lastCountedAt?: string | null;
}

interface DetailPayload {
  readonly plan: CountPlanListRow;
  readonly lines: readonly CountLineListRow[];
}

type CountType = 'Location' | 'SKU' | 'LP';

/** Singular / plural nouns for each count type's task rows. */
const NOUN: Readonly<Record<CountType, readonly [string, string]>> = {
  Location: ['location', 'locations'],
  SKU: ['product', 'products'],
  LP: ['license plate', 'license plates'],
};

interface PickLp {
  readonly id: string;
  readonly number: string;
  readonly lpType: string | null;
  readonly locationCode: string | null;
  readonly clientName: string | null;
  readonly onHand: number;
  readonly allocated?: number;
  readonly skuCount: number;
  readonly openCountCode?: string | null;
}

/** A location / SKU / LP in another open count plan can't be added (server enforces it too). */
const inOpenCount = (r: { readonly openCountCode?: string | null }): boolean => Boolean(r.openCountCode);
const blockedNote = (n: number): string =>
  `${n} on this page ${n === 1 ? 'is' : 'are'} in another open count`;

/** Code cell: the value, plus an "In CNT000146" badge (with tooltip) when another open count holds it. */
function PickCodeCell({ value, openCount }: { readonly value: string; readonly openCount?: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={cn('truncate font-semibold', openCount ? 'text-faint' : 'text-foreground')}>
        {value}
      </span>
      {openCount ? (
        <Tooltip
          content={`Already in open count plan ${openCount}. Finish or cancel it before counting this again.`}
        >
          <span
            tabIndex={0}
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-warning-soft px-1.5 py-px text-2xs font-semibold text-warning"
          >
            In {openCount}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
const pickText = (v: string | null | undefined) =>
  v ? <span className="truncate">{v}</span> : <span className="text-faint">None</span>;
const pickQty = (v: number) => (
  <span className="block w-full text-right tabular-nums">
    <QtyCell value={v} muteZero />
  </span>
);
const pickDate = (v: string | null) =>
  v ? <DateCell value={v} /> : <span className="text-faint">Never</span>;

interface General {
  readonly code: string;
  readonly warehouseId: string | null;
  readonly description: string;
  readonly scheduledAt: Date | null;
  readonly lockLocations: boolean;
}

const generalSchema = z.object({
  code: z.string().trim().min(1, 'Name is required').max(50, 'Use at most 50 characters'),
  warehouseId: z.string({ error: 'Warehouse is required' }).min(1, 'Warehouse is required'),
  description: z.string().max(400, 'Use at most 400 characters'),
  scheduledAt: z.date({ error: 'Scheduled count date is required' }),
});

type FieldKey = 'code' | 'warehouseId' | 'description' | 'scheduledAt';
type Errors = Partial<Record<FieldKey, string>>;

const FIELD_ORDER: readonly FieldKey[] = ['code', 'warehouseId', 'description', 'scheduledAt'];

export interface CountPlanDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly mode: DrawerMode;
  /** Plan id or code for edit / view. */
  readonly planId?: string | null;
  readonly onSaved?: (plan: CountPlanListRow) => void;
}

export function CountPlanDrawer(props: CountPlanDrawerProps) {
  const [dirty, setDirty] = React.useState(false);
  const title =
    props.mode === 'create' ? 'Create New Count' : props.mode === 'edit' ? 'Edit Count' : 'Show Details';
  return (
    <Drawer
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title}
      width={60}
      dirty={dirty && props.mode !== 'view'}
    >
      {props.open ? (
        <Body key={`${props.mode}-${props.planId ?? 'new'}`} {...props} onDirty={setDirty} />
      ) : null}
    </Drawer>
  );
}

function lineItems(detail: DetailPayload): { countType: CountType; items: TaskItem[] } {
  const countType: CountType =
    detail.plan.countType === 'SKU' ? 'SKU' : detail.plan.countType === 'LP' ? 'LP' : 'Location';
  // Same columns as the create pickers: Item Type / Item Group (SKU), Loc Type / Loc Group (Location),
  // LP Type / Location (LP). A SKU plan has one line per stocked location, so on hand is summed per SKU.
  const byId = new Map<string, TaskItem>();
  for (const l of detail.lines) {
    if (l.status === 'Cancelled' || l.isRecountLine) continue;
    const id = countType === 'SKU' ? l.productId : countType === 'LP' ? (l.lpId ?? null) : l.locationId;
    if (!id) continue;
    const prev = byId.get(id);
    if (prev) {
      byId.set(id, { ...prev, onHand: (prev.onHand ?? 0) + l.initialStockQty });
      continue;
    }
    byId.set(
      id,
      countType === 'SKU'
        ? {
            id,
            label: l.sku ?? 'None',
            sub1: l.productType ?? null,
            sub2: l.productGroup ?? null,
            onHand: l.initialStockQty,
          }
        : countType === 'LP'
          ? {
              id,
              label: l.lpNumber ?? 'None',
              sub1: l.lpType ?? null,
              sub2: l.locationCode,
              onHand: l.initialStockQty,
            }
          : {
              id,
              label: l.locationCode ?? 'None',
              sub1: l.locationType ?? null,
              sub2: l.locationGroup ?? null,
              onHand: l.initialStockQty,
            },
    );
  }
  return { countType, items: [...byId.values()] };
}

function Body({
  onOpenChange,
  mode,
  planId,
  onSaved,
  onDirty,
}: CountPlanDrawerProps & { readonly onDirty: (d: boolean) => void }) {
  const me = useMe();
  const isNew = mode === 'create';
  const readOnly = mode === 'view';
  const detail = useApiQuery<DetailPayload>(
    ['count-plan', planId ?? ''],
    isNew ? null : `/api/counts/${encodeURIComponent(planId ?? '')}`,
    { timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  const nextCode = useApiQuery<{ code: string; defaultWarehouseId?: string | null }>(
    ['count-next-code'],
    isNew ? '/api/counts/next-code' : null,
    { staleTime: 0, timeoutMs: COUNT_QUERY_TIMEOUT_MS },
  );
  const meData = me.data?.data;
  const defaultWarehouse =
    meData?.context.warehouseId ??
    (meData?.contextOptions.warehouses.length === 1
      ? (meData.contextOptions.warehouses[0]?.id ?? null)
      : null) ??
    nextCode.data?.data.defaultWarehouseId ??
    null;

  const [step, setStep] = React.useState<0 | 1>(0);
  const [general, setGeneral] = React.useState<General | null>(
    isNew
      ? {
          code: '',
          warehouseId: defaultWarehouse,
          description: '',
          scheduledAt: new Date(),
          lockLocations: false,
        }
      : null,
  );
  const [countType, setCountType] = React.useState<CountType>('Location');
  const [items, setItems] = React.useState<TaskItem[]>([]);
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = React.useState<Errors>({});
  const [pendingType, setPendingType] = React.useState<CountType | null>(null);
  const [picker, setPicker] = React.useState(false);
  const [suggest, setSuggest] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  /** Rows the server refused because another open count holds them: label → plan code. */
  const [taken, setTaken] = React.useState<ReadonlyMap<string, string>>(new Map());
  const [touched, setTouched] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Prefill the suggested code once (create) / the plan (edit, view).
  React.useEffect(() => {
    if (isNew && nextCode.data?.data.code)
      setGeneral((g) => (g && !g.code ? { ...g, code: nextCode.data.data.code } : g));
  }, [isNew, nextCode.data]);
  React.useEffect(() => {
    if (isNew) return;
    const d = detail.data?.data;
    if (!d || general) return;
    setGeneral({
      code: d.plan.code,
      warehouseId: d.plan.warehouseId,
      description: d.plan.description ?? '',
      scheduledAt: new Date(d.plan.scheduledAt),
      lockLocations: d.plan.lockLocations,
    });
    const li = lineItems(d);
    setCountType(li.countType);
    setItems(li.items);
  }, [isNew, detail.data, general]);
  React.useEffect(() => {
    if (isNew && defaultWarehouse)
      setGeneral((g) => (g && !g.warehouseId ? { ...g, warehouseId: defaultWarehouse } : g));
  }, [isNew, defaultWarehouse]);
  React.useEffect(() => onDirty(touched), [touched, onDirty]);

  if (!general) {
    if (detail.error)
      return (
        <Callout variant="error" title="Count plan not available">
          {detail.error.message}
        </Callout>
      );
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const plan = detail.data?.data.plan;
  const status = plan?.status ?? 'Pending';
  const update = (patch: Partial<General>) => {
    setGeneral({ ...general, ...patch });
    setTouched(true);
    const keys = Object.keys(patch) as FieldKey[];
    if (keys.some((k) => errors[k]))
      setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k as FieldKey))));
  };

  const validateGeneral = (): boolean => {
    const parsed = generalSchema.safeParse({
      ...general,
      warehouseId: general.warehouseId ?? undefined,
      scheduledAt: general.scheduledAt ?? undefined,
    });
    if (parsed.success) {
      setErrors({});
      return true;
    }
    const next: Errors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as FieldKey;
      if (!next[key]) next[key] = issue.message;
    }
    setErrors(next);
    const first = FIELD_ORDER.find((k) => next[k]);
    requestAnimationFrame(() =>
      rootRef.current
        ?.querySelector<HTMLElement>(
          `[data-field="${first}"] input, [data-field="${first}"] button, [data-field="${first}"] textarea`,
        )
        ?.focus(),
    );
    return false;
  };

  /* While the default warehouse is still resolving, Next waits instead of flashing "Warehouse is required". */
  const prefilling = isNew && !general?.warehouseId && (nextCode.isPending || me.isPending);
  const goNext = () => {
    if (prefilling) return;
    if (readOnly || validateGeneral()) setStep(1);
  };

  const switchType = (t: CountType) => {
    if (t === countType || readOnly) return;
    if (items.length > 0) {
      setPendingType(t);
      return;
    }
    setCountType(t);
    setTouched(true);
  };

  const save = async () => {
    if (!validateGeneral()) {
      setStep(0);
      return;
    }
    setSaving(true);
    setServerError(null);
    const body = {
      code: general.code.trim(),
      warehouseId: general.warehouseId,
      description: general.description.trim() || null,
      scheduledAt: (general.scheduledAt ?? new Date()).toISOString(),
      lockLocations: general.lockLocations,
      countType,
      locationIds: countType === 'Location' ? items.map((i) => i.id) : [],
      productIds: countType === 'SKU' ? items.map((i) => i.id) : [],
      lpIds: countType === 'LP' ? items.map((i) => i.id) : [],
      isAi: items.some((i) => i.reasons !== undefined),
      ...(isNew ? {} : { version: plan?.version }),
    };
    try {
      const saved = await apiFetch<CountPlanListRow>(
        isNew ? '/api/counts' : `/api/counts/${encodeURIComponent(plan?.id ?? '')}`,
        { method: isNew ? 'POST' : 'PATCH', body },
      );
      toast.show({
        variant: 'success',
        title: 'Success',
        message: isNew
          ? `You have successfully created count plan ${saved.code} (${saved.lineCount} ${saved.lineCount === 1 ? 'line' : 'lines'}).`
          : `Count plan ${saved.code} is updated.`,
        action: {
          label: 'Open plan',
          onClick: () => {
            window.location.assign(`/counts/${encodeURIComponent(saved.code)}`);
          },
        },
      });
      setTouched(false);
      onDirty(false);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      else if (isApiError(error) && error.fieldErrors?.code) {
        setErrors({ code: error.fieldErrors.code[0] });
        setStep(0);
      } else if (isApiError(error) && error.fieldErrors?.warehouseId) {
        setErrors({ warehouseId: error.fieldErrors.warehouseId[0] });
        setStep(0);
      } else if (
        isApiError(error) &&
        (error.fieldErrors?.locationIds || error.fieldErrors?.productIds || error.fieldErrors?.lpIds)
      ) {
        // "MLT1-B-01 is in open count plan CNT000146": flag those rows in the list so they can be removed.
        const msgs = [
          ...(error.fieldErrors.locationIds ?? []),
          ...(error.fieldErrors.productIds ?? []),
          ...(error.fieldErrors.lpIds ?? []),
        ];
        setTaken(
          new Map(
            msgs.flatMap((m) => {
              const at = m.indexOf(' is in open count plan ');
              return at > 0 ? [[m.slice(0, at), m.slice(at + 23)] as [string, string]] : [];
            }),
          ),
        );
        setServerError(error.message);
      } else setServerError(isApiError(error) ? error.message : 'The count plan could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  /** Edit Count on a started / finished plan: only the name and description can change (Logiwa parity). */
  const headerOnly = mode === 'edit' && status !== 'Pending';
  const descriptionOnly = headerOnly && Boolean(planNameLockedReason(status));
  const saveHeader = async () => {
    const code = general.code.trim();
    if (!code) {
      setErrors({ code: 'Name is required' });
      return;
    }
    setSaving(true);
    setServerError(null);
    try {
      const saved = await apiFetch<CountPlanListRow>(
        `/api/counts/${encodeURIComponent(plan?.id ?? '')}/header`,
        {
          method: 'PATCH',
          body: { code, description: general.description.trim() || null, version: plan?.version },
        },
      );
      toast.success('Success', `Count plan ${saved.code} is updated.`);
      setTouched(false);
      onDirty(false);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      else if (isApiError(error) && error.fieldErrors?.code) setErrors({ code: error.fieldErrors.code[0] });
      else setServerError(isApiError(error) ? error.message : 'The count plan could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const steps: StepMeta[] = [
    { key: 'general', label: 'General', status: step === 0 ? 'active' : 'complete', clickable: true },
    {
      key: 'tasks',
      label: 'Tasks',
      status: step === 1 ? 'active' : 'upcoming',
      clickable:
        readOnly || step === 1 || Boolean(general.code && general.warehouseId && general.scheduledAt),
    },
  ];
  const saveReason = saving
    ? 'Saving…'
    : items.length === 0
      ? `Add at least one ${NOUN[countType][0]}`
      : null;

  return (
    <div ref={rootRef} className="flex min-h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <WizardPills steps={steps} onSelect={(k) => (k === 'general' ? setStep(0) : goNext())} />
        {plan ? (
          <span className="flex items-center gap-2">
            <CountStatusPill status={status} domain="count" />
            {readOnly ? (
              <Link
                href={`/counts/${encodeURIComponent(plan.code)}`}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Open count details
              </Link>
            ) : null}
          </span>
        ) : null}
      </div>
      {headerOnly && descriptionOnly ? (
        <Callout variant="info" title="Description only">
          Inventory was posted from this count, so its name, lines and quantities are locked for the audit
          trail (the ledger postings reference the name). You can still update the description; the change is
          recorded in the change log.
        </Callout>
      ) : headerOnly ? (
        <Callout variant="info" title="Name and description only">
          This count has started, so its warehouse, date, lock and lines are fixed. You can still rename it or
          update the description.
        </Callout>
      ) : null}
      {readOnly && plan && plan.status === 'Inventory Updated' ? (
        <Callout variant="attention" title="Locked · Inventory Updated">
          Inventory was posted from this count. The plan name, its lines and its quantities are locked for the
          audit trail. Only the description can still be edited (row menu › Edit description).
        </Callout>
      ) : readOnly && plan && plan.status !== 'Pending' ? (
        <Callout variant="info" title="Read only">
          This count has started, so its plan can no longer be edited. Use the count details page to count,
          recount or update inventory.
        </Callout>
      ) : null}
      {conflict ? (
        <Callout
          variant="attention"
          title="This count plan changed since you opened it"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setConflict(false);
                setGeneral(null);
                void detail.refetch();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Reload
            </Button>
          }
        >
          Someone else saved this count plan. Reload to see the latest version, then repeat your change.
        </Callout>
      ) : null}
      {serverError ? (
        <Callout variant="error" title="Not saved">
          {serverError}
        </Callout>
      ) : null}

      <form
        noValidate
        className="flex flex-1 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (headerOnly && step === 0) {
            if (touched && !saving) void saveHeader();
          } else if (step === 0) goNext();
          else if (!saveReason && !readOnly) void save();
        }}
      >
        {step === 0 ? (
          <GeneralStep
            general={general}
            errors={errors}
            readOnly={readOnly || headerOnly}
            headerEditable={headerOnly}
            nameLocked={descriptionOnly}
            onChange={update}
          />
        ) : (
          <TasksStep
            countType={countType}
            items={items}
            checked={checked}
            readOnly={readOnly || headerOnly}
            onType={switchType}
            onCheck={setChecked}
            onRemove={() => {
              setItems(items.filter((i) => !checked.has(i.id)));
              setChecked(new Set());
              setTouched(true);
            }}
            taken={taken}
            onAdd={() => setPicker(true)}
            onSuggest={countType === 'LP' ? undefined : () => setSuggest(true)}
            warehouseSelected={Boolean(general.warehouseId)}
          />
        )}
        <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-2 border-t border-border bg-surface pt-3 pb-1">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          <div className="flex items-center gap-2">
            {step === 1 ? (
              <Button type="button" variant="secondary" onClick={() => setStep(0)} disabled={saving}>
                Back
              </Button>
            ) : null}
            {step === 0 && headerOnly ? (
              <Button type="button" variant="secondary" onClick={() => setStep(1)}>
                View lines
              </Button>
            ) : null}
            {step === 0 && headerOnly ? (
              <DisabledReason
                reason={saving ? 'Saving…' : touched ? null : 'Change the name or description first'}
              >
                <Button type="submit" variant="primary" disabled={saving || !touched} aria-busy={saving}>
                  {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}Save
                </Button>
              </DisabledReason>
            ) : null}
            {step === 0 && !headerOnly ? (
              <Button type="submit" variant="primary" disabled={prefilling} aria-busy={prefilling}>
                Next
              </Button>
            ) : null}
            {step === 1 && !readOnly && !headerOnly ? (
              <DisabledReason reason={saveReason}>
                <Button type="submit" variant="primary" disabled={Boolean(saveReason)} aria-busy={saving}>
                  {saving ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
                  Save
                </Button>
              </DisabledReason>
            ) : null}
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={pendingType !== null}
        onOpenChange={(o) => (o ? undefined : setPendingType(null))}
        variant="attention"
        title={`Switch to ${pendingType ?? ''} Count?`}
        description={`The ${items.length} ${NOUN[countType][1]} you added will be removed from this plan.`}
        cancelLabel="Keep them"
        confirmLabel="Switch and clear"
        onConfirm={() => {
          if (pendingType) {
            setCountType(pendingType);
            setItems([]);
            setChecked(new Set());
            setTouched(true);
          }
          setPendingType(null);
        }}
      />
      {suggest && general.warehouseId && countType !== 'LP' ? (
        <CountSuggestDialog
          open={suggest}
          onOpenChange={setSuggest}
          warehouseId={general.warehouseId}
          countType={countType}
          exclude={items.map((i) => i.id)}
          onAdd={(rows) => {
            setItems([
              ...items,
              ...rows.map((r) => ({
                id: r.id,
                label: r.label,
                sub1: r.sub1,
                sub2: r.sub2,
                onHand: r.onHand,
                reasons: r.reasons,
              })),
            ]);
            setTouched(true);
          }}
        />
      ) : null}
      {picker && general.warehouseId ? (
        countType === 'Location' ? (
          <LocationPicker
            open={picker}
            onOpenChange={setPicker}
            warehouseId={general.warehouseId}
            planId={isNew ? null : planId}
            exclude={items.map((i) => i.id)}
            onAdd={(rows) => {
              setItems([
                ...items,
                ...rows.map((r) => ({
                  id: r.id,
                  label: r.code,
                  sub1: r.locationType,
                  sub2: r.locationGroup,
                  onHand: r.onHand,
                })),
              ]);
              setTouched(true);
            }}
          />
        ) : countType === 'LP' ? (
          <LpPicker
            open={picker}
            onOpenChange={setPicker}
            warehouseId={general.warehouseId}
            planId={isNew ? null : planId}
            exclude={items.map((i) => i.id)}
            onAdd={(rows) => {
              setItems([
                ...items,
                ...rows.map((r) => ({
                  id: r.id,
                  label: r.number,
                  sub1: r.lpType,
                  sub2: r.locationCode,
                  onHand: r.onHand,
                })),
              ]);
              setTouched(true);
            }}
          />
        ) : (
          <ProductPicker
            open={picker}
            onOpenChange={setPicker}
            warehouseId={general.warehouseId}
            planId={isNew ? null : planId}
            exclude={items.map((i) => i.id)}
            onAdd={(rows) => {
              setItems([
                ...items,
                ...rows.map((r) => ({
                  id: r.id,
                  label: r.sku,
                  sub1: r.productType,
                  sub2: r.productGroup,
                  onHand: r.onHand,
                })),
              ]);
              setTouched(true);
            }}
          />
        )
      ) : null}
    </div>
  );
}

function GeneralStep({
  general,
  errors,
  readOnly,
  headerEditable = false,
  nameLocked = false,
  onChange,
}: {
  readonly general: General;
  readonly errors: Errors;
  readonly readOnly: boolean;
  readonly headerEditable?: boolean;
  readonly nameLocked?: boolean;
  readonly onChange: (p: Partial<General>) => void;
}) {
  const ids = {
    code: 'count-code',
    wh: 'count-warehouse',
    desc: 'count-description',
    date: 'count-date',
    lock: 'count-lock',
  };
  return (
    <section aria-label="General" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div data-field="code" className="flex flex-col gap-1">
        <FieldLabel htmlFor={ids.code} required>
          Name
        </FieldLabel>
        <TextField
          id={ids.code}
          value={general.code}
          maxLength={50}
          placeholder="Count Plan Name"
          disabled={(readOnly && !headerEditable) || nameLocked}
          title={nameLocked ? 'Locked: the ledger postings reference this name' : undefined}
          invalid={Boolean(errors.code)}
          aria-invalid={Boolean(errors.code) || undefined}
          aria-describedby={errors.code ? `${ids.code}-err` : undefined}
          onChange={(e) => onChange({ code: e.target.value })}
        />
        <div className="flex items-start justify-between gap-2">
          <FieldError id={`${ids.code}-err`} message={errors.code} />
          <span className="ml-auto">
            <CharacterCount length={general.code.length} max={50} />
          </span>
        </div>
      </div>
      <div data-field="warehouseId" className="flex flex-col gap-1">
        <FieldLabel htmlFor={ids.wh} required>
          Warehouse
        </FieldLabel>
        <WarehouseSelect
          id={ids.wh}
          value={general.warehouseId}
          onChange={(v) => onChange({ warehouseId: v })}
          disabled={readOnly}
          invalid={Boolean(errors.warehouseId)}
        />
        <FieldError id={`${ids.wh}-err`} message={errors.warehouseId} />
      </div>
      <div data-field="description" className="flex flex-col gap-1 md:col-span-2">
        <FieldLabel htmlFor={ids.desc}>Description</FieldLabel>
        <Textarea
          id={ids.desc}
          value={general.description}
          maxLength={400}
          showCount
          rows={2}
          disabled={readOnly && !headerEditable}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What, where and why this count runs"
        />
        <FieldError id={`${ids.desc}-err`} message={errors.description} />
      </div>
      <div data-field="scheduledAt" className="flex flex-col gap-1">
        <FieldLabel htmlFor={ids.date} required>
          Scheduled Count Date
        </FieldLabel>
        <DateTimePicker
          id={ids.date}
          value={general.scheduledAt}
          onChange={(d) => onChange({ scheduledAt: d })}
          disabled={readOnly}
          invalid={Boolean(errors.scheduledAt)}
          aria-describedby={errors.scheduledAt ? `${ids.date}-err` : undefined}
        />
        <FieldError id={`${ids.date}-err`} message={errors.scheduledAt} />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel
          htmlFor={ids.lock}
          info="While the count is open, stock can't be moved in or out of its locations. The lock lifts when the count is cancelled or inventory is updated."
        >
          Lock Locations
        </FieldLabel>
        <YesNoToggle
          id={ids.lock}
          value={general.lockLocations}
          onChange={(v) => onChange({ lockLocations: v })}
          disabled={readOnly}
          ariaLabel="Lock Locations"
        />
      </div>
    </section>
  );
}

function TasksStep({
  countType,
  items,
  checked,
  readOnly,
  onType,
  onCheck,
  onRemove,
  onAdd,
  onSuggest,
  warehouseSelected,
  taken,
}: {
  readonly countType: CountType;
  readonly items: readonly TaskItem[];
  readonly checked: ReadonlySet<string>;
  readonly readOnly: boolean;
  readonly taken?: ReadonlyMap<string, string>;
  readonly onType: (t: CountType) => void;
  readonly onCheck: (s: ReadonlySet<string>) => void;
  readonly onRemove: () => void;
  readonly onAdd: () => void;
  readonly onSuggest?: () => void;
  readonly warehouseSelected: boolean;
}) {
  const allChecked = items.length > 0 && items.every((i) => checked.has(i.id));
  const toggle = (id: string) => {
    const n = new Set(checked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onCheck(n);
  };
  const loc = countType === 'Location';
  const lp = countType === 'LP';
  const totalOnHand = items.reduce((s, i) => s + (i.onHand ?? 0), 0);
  return (
    <section aria-label="Tasks" className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Count mode" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(['Location', 'SKU', 'LP'] as const).map((t) => {
          const Icon = t === 'Location' ? MapPin : t === 'LP' ? Boxes : Package;
          const active = t === countType;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={readOnly && !active}
              onClick={() => onType(t)}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30',
                active
                  ? 'border-primary bg-primary-soft'
                  : 'border-border bg-surface hover:border-border-strong',
                readOnly && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-md',
                  active ? 'bg-primary text-white' : 'bg-surface-sunken text-secondary',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">{t} Count</span>
                <span className="text-2xs text-secondary">
                  {t === 'Location'
                    ? 'Count everything in chosen locations'
                    : t === 'LP'
                      ? 'Count the contents of chosen license plates'
                      : 'Count chosen SKUs wherever they are stocked'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-secondary">
          <strong className="text-foreground">{items.length}</strong>{' '}
          {loc
            ? items.length === 1
              ? 'location'
              : 'locations'
            : lp
              ? NOUN.LP[items.length === 1 ? 0 : 1]
              : items.length === 1
                ? 'SKU'
                : 'SKUs'}
          <span className="mx-1.5 text-border-strong">|</span>
          <strong className="text-foreground tabular-nums">{totalOnHand}</strong> units on hand
        </p>
        {readOnly ? null : (
          <div className="flex items-center gap-2">
            <DisabledReason reason={checked.size === 0 ? 'Select rows to remove' : null}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={checked.size === 0}
                onClick={onRemove}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remove
              </Button>
            </DisabledReason>
            <DisabledReason reason={warehouseSelected ? null : 'Choose a warehouse in step 1 first'}>
              <Button type="button" size="sm" variant="primary" disabled={!warehouseSelected} onClick={onAdd}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add
              </Button>
            </DisabledReason>
            {onSuggest ? (
              <DisabledReason reason={warehouseSelected ? null : 'Choose a warehouse in step 1 first'}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!warehouseSelected}
                  onClick={onSuggest}
                  title="AI Count Plan: add the riskiest stocked locations or SKUs"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  Suggest
                </Button>
              </DisabledReason>
            ) : null}
          </div>
        )}
      </div>
      <div className="ks-scroll max-h-[52vh] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-surface-sunken text-left text-2xs font-semibold text-faint">
            <tr>
              {readOnly ? null : (
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allChecked}
                    onChange={() => onCheck(allChecked ? new Set() : new Set(items.map((i) => i.id)))}
                    className="accent-[var(--color-primary)]"
                  />
                </th>
              )}
              <th scope="col" className="px-3 py-2">
                {loc ? 'Location' : lp ? 'LP Number' : 'Product Code'}
              </th>
              <th scope="col" className="px-3 py-2">
                {loc ? 'Loc Type' : lp ? 'LP Type' : 'Item Type'}
              </th>
              <th scope="col" className="px-3 py-2">
                {loc ? 'Loc Group' : lp ? 'Location' : 'Item Group'}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                On hand
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center">
                  <p className="text-sm font-semibold text-foreground">No {NOUN[countType][1]} yet</p>
                  <p className="mt-0.5 text-xs text-secondary">
                    {readOnly
                      ? 'This plan has no lines.'
                      : `Use Add to pick the ${loc ? 'locations' : lp ? 'license plates' : 'SKUs'} to count. Save unlocks once the plan has at least one.`}
                  </p>
                </td>
              </tr>
            ) : (
              items.map((i) => (
                <tr
                  key={i.id}
                  className={cn('border-t border-border', checked.has(i.id) && 'bg-primary-soft/60')}
                  onClick={readOnly ? undefined : () => toggle(i.id)}
                >
                  {readOnly ? null : (
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${i.label}`}
                        checked={checked.has(i.id)}
                        onChange={() => toggle(i.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-[var(--color-primary)]"
                      />
                    </td>
                  )}
                  <td className="px-3 py-1.5 font-semibold text-foreground">
                    <span className="flex items-center gap-1.5">
                      {i.label}
                      {taken?.get(i.label) ? (
                        <span
                          className="inline-flex items-center rounded bg-danger-soft px-1.5 py-px text-2xs font-semibold text-danger"
                          title={`Already in open count plan ${taken.get(i.label)}`}
                        >
                          In {taken.get(i.label)}
                        </span>
                      ) : null}
                      {i.reasons ? (
                        <span
                          title={i.reasons.join(' · ') || 'Suggested by AI Count Plan'}
                          className="inline-flex items-center gap-0.5 rounded bg-primary-soft px-1.5 py-px text-2xs font-semibold text-primary"
                        >
                          <Sparkles className="h-2.5 w-2.5" aria-hidden />
                          AI
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-secondary">{i.sub1 ?? 'None'}</td>
                  <td className="px-3 py-1.5 text-secondary">{i.sub2 ?? 'None'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <QtyCell value={i.onHand} muteZero />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Every column renders through the same cell helpers, so header and value share one padding and alignment.
/** "2 alloc." chip: counting below the allocated qty shorts orders, and picked stock can't post (critic r5). */
function AllocatedChip({ allocated, onHand }: { readonly allocated: number; readonly onHand: number }) {
  const full = allocated >= onHand;
  return (
    <span
      title={
        full
          ? `All ${onHand} units are allocated to orders. A shortage here posts only after unpicked orders are shorted; picked stock can't post.`
          : `${allocated} of ${onHand} units are allocated to orders`
      }
      className={
        full
          ? 'rounded bg-warning-soft px-1.5 py-px text-2xs font-semibold text-warning'
          : 'rounded bg-neutral-soft px-1.5 py-px text-2xs font-semibold text-neutral'
      }
    >
      {allocated} alloc.
    </span>
  );
}

const locationColumns: ColumnDef<PickLocation, unknown>[] = [
  {
    id: 'code',
    accessorKey: 'code',
    header: 'Location',
    size: 220,
    meta: { label: 'Location', alwaysVisible: true },
    cell: ({ row }) => <PickCodeCell value={row.original.code} openCount={row.original.openCountCode} />,
  },
  {
    id: 'locationType',
    accessorKey: 'locationType',
    header: 'Loc Type',
    size: 130,
    enableSorting: false,
    meta: { label: 'Loc Type' },
    cell: ({ row }) => pickText(row.original.locationType),
  },
  {
    id: 'locationGroup',
    accessorKey: 'locationGroup',
    header: 'Loc Group',
    size: 140,
    enableSorting: false,
    meta: { label: 'Loc Group' },
    cell: ({ row }) => pickText(row.original.locationGroup),
  },
  {
    id: 'zone',
    accessorKey: 'zone',
    header: 'Zone',
    size: 80,
    meta: { label: 'Zone' },
    cell: ({ row }) => pickText(row.original.zone),
  },
  {
    id: 'abcCode',
    accessorKey: 'abcCode',
    header: 'ABC',
    size: 70,
    enableSorting: false,
    meta: { label: 'ABC Code' },
    cell: ({ row }) => pickText(row.original.abcCode ?? null),
  },
  {
    id: 'aisle',
    accessorKey: 'aisle',
    header: 'Aisle',
    size: 80,
    meta: { label: 'Aisle', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.aisle ?? null),
  },
  {
    id: 'rack',
    accessorKey: 'rack',
    header: 'Rack',
    size: 80,
    enableSorting: false,
    meta: { label: 'Rack', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.rack ?? null),
  },
  {
    id: 'level',
    accessorKey: 'level',
    header: 'Level',
    size: 80,
    meta: { label: 'Level', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.level ?? null),
  },
  {
    id: 'isLocked',
    accessorKey: 'isLocked',
    header: 'Locked',
    size: 90,
    enableSorting: false,
    meta: { label: 'Locked', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.isLocked ? 'Yes' : 'No'),
  },
  {
    id: 'preventAllocation',
    accessorKey: 'preventAllocation',
    header: 'Prevent Alloc.',
    size: 120,
    enableSorting: false,
    meta: { label: 'Prevent Allocation', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.preventAllocation ? 'Yes' : 'No'),
  },
  {
    id: 'lastCountedAt',
    accessorKey: 'lastCountedAt',
    header: 'Last Counted',
    size: 170,
    enableSorting: false,
    meta: { label: 'Last Counted' },
    cell: ({ row }) => pickDate(row.original.lastCountedAt ?? null),
  },
  {
    id: 'skuCount',
    accessorKey: 'skuCount',
    header: 'Num. of SKU',
    size: 120,
    enableSorting: false,
    meta: { label: 'Num. of SKU', align: 'right' },
    cell: ({ row }) => pickQty(row.original.skuCount),
  },
  {
    id: 'onHand',
    accessorKey: 'onHand',
    header: 'On hand',
    size: 160,
    meta: { label: 'On hand', align: 'right', headerClassName: 'pr-8' },
    cell: ({ row }) => (
      <span className="flex w-full items-center justify-end gap-1.5 pr-8">
        {(row.original.allocated ?? 0) > 0 ? (
          <AllocatedChip allocated={row.original.allocated ?? 0} onHand={row.original.onHand} />
        ) : null}
        {pickQty(row.original.onHand)}
      </span>
    ),
  },
];

const productColumns: ColumnDef<PickProduct, unknown>[] = [
  {
    id: 'sku',
    accessorKey: 'sku',
    header: 'Product Code',
    size: 230,
    meta: { label: 'Product Code', alwaysVisible: true },
    cell: ({ row }) => <PickCodeCell value={row.original.sku} openCount={row.original.openCountCode} />,
  },
  {
    id: 'clientName',
    accessorKey: 'clientName',
    header: 'Client',
    size: 150,
    meta: { label: 'Client' },
    cell: ({ row }) => pickText(row.original.clientName),
  },
  {
    id: 'productType',
    accessorKey: 'productType',
    header: 'Item Type',
    size: 120,
    enableSorting: false,
    meta: { label: 'Item Type' },
    cell: ({ row }) => pickText(row.original.productType),
  },
  {
    id: 'productGroup',
    accessorKey: 'productGroup',
    header: 'Item Group',
    size: 120,
    enableSorting: false,
    meta: { label: 'Item Group' },
    cell: ({ row }) => pickText(row.original.productGroup),
  },
  {
    id: 'isKit',
    accessorKey: 'isKit',
    header: 'Kit',
    size: 70,
    enableSorting: false,
    meta: { label: 'Kit', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.isKit ? 'Yes' : 'No'),
  },
  {
    id: 'tracking',
    header: 'Tracking',
    size: 130,
    enableSorting: false,
    meta: { label: 'Lot / Serial / Expiry tracking' },
    cell: ({ row }) =>
      pickText(
        [
          row.original.trackLot ? 'Lot' : null,
          row.original.trackSerial ? 'Serial' : null,
          row.original.trackExpiry ? 'Expiry' : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
      ),
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    size: 90,
    enableSorting: false,
    meta: { label: 'Status', defaultVisible: false },
    cell: ({ row }) => pickText(row.original.status ?? null),
  },
  {
    id: 'lastCountedAt',
    accessorKey: 'lastCountedAt',
    header: 'Last Counted',
    size: 170,
    enableSorting: false,
    meta: { label: 'Last Counted' },
    cell: ({ row }) => pickDate(row.original.lastCountedAt ?? null),
  },
  {
    id: 'onHand',
    accessorKey: 'onHand',
    header: 'On hand',
    size: 160,
    meta: { label: 'On hand', align: 'right', headerClassName: 'pr-8' },
    cell: ({ row }) => (
      <span className="flex w-full items-center justify-end gap-1.5 pr-8">
        {(row.original.allocated ?? 0) > 0 ? (
          <AllocatedChip allocated={row.original.allocated ?? 0} onHand={row.original.onHand} />
        ) : null}
        {pickQty(row.original.onHand)}
      </span>
    ),
  },
];

interface PickerProps<T> {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly warehouseId: string;
  readonly exclude: readonly string[];
  readonly onAdd: (rows: readonly T[]) => void;
  readonly planId?: string | null;
}

function LocationPicker({
  open,
  onOpenChange,
  warehouseId,
  exclude,
  onAdd,
  planId,
}: PickerProps<PickLocation>) {
  const fields = useFilterFields(COUNT_LOCATION_PICKER_FIELDS);
  const [allTypes, setAllTypes] = React.useState(false);
  const extra = React.useMemo(
    () => ({ warehouseId, types: allTypes ? 'all' : 'storage', ...(planId ? { exceptPlanId: planId } : {}) }),
    [warehouseId, allTypes, planId],
  );
  return (
    <CountPickerModal<PickLocation>
      headerExtra={
        <label className="flex items-center gap-2 px-2 pb-1 text-xs text-secondary">
          <input
            type="checkbox"
            checked={allTypes}
            onChange={(e) => setAllTypes(e.target.checked)}
            className="accent-[var(--color-primary)]"
          />
          Include station and virtual locations (not counted by default)
        </label>
      }
      open={open}
      onOpenChange={onOpenChange}
      title="Add Location"
      description="Pick the locations to count. Locations already in this plan or in another open count are greyed out."
      gridKey="count-pick-locations"
      path="/api/counts/pickers/locations"
      extraQuery={extra}
      columns={locationColumns}
      fields={fields}
      getRowId={(r) => r.id}
      excludeIds={exclude}
      isBlocked={inOpenCount}
      blockedNote={blockedNote}
      confirmLabel="Add"
      searchPlaceholder="Search location code or barcode"
      onConfirm={onAdd}
    />
  );
}

function ProductPicker({
  open,
  onOpenChange,
  warehouseId,
  exclude,
  onAdd,
  planId,
}: PickerProps<PickProduct>) {
  const fields = useFilterFields(COUNT_PRODUCT_PICKER_FIELDS);
  const extra = React.useMemo(
    () => ({ warehouseId, ...(planId ? { exceptPlanId: planId } : {}) }),
    [warehouseId, planId],
  );
  return (
    <CountPickerModal<PickProduct>
      open={open}
      onOpenChange={onOpenChange}
      title="Add Product"
      description="Pick the SKUs to count. On hand is for the selected warehouse. SKUs already in another open count are greyed out."
      gridKey="count-pick-products"
      path="/api/counts/pickers/products"
      extraQuery={extra}
      columns={productColumns}
      fields={fields}
      getRowId={(r) => r.id}
      excludeIds={exclude}
      isBlocked={inOpenCount}
      blockedNote={blockedNote}
      confirmLabel="Add"
      searchPlaceholder="Search by SKU"
      onConfirm={onAdd}
    />
  );
}

const lpColumns: ColumnDef<PickLp, unknown>[] = [
  {
    id: 'number',
    accessorKey: 'number',
    header: 'LP Number',
    size: 230,
    meta: { label: 'LP Number', alwaysVisible: true },
    cell: ({ row }) => <PickCodeCell value={row.original.number} openCount={row.original.openCountCode} />,
  },
  {
    id: 'lpType',
    accessorKey: 'lpType',
    header: 'LP Type',
    size: 110,
    meta: { label: 'LP Type' },
    cell: ({ row }) => pickText(row.original.lpType),
  },
  {
    id: 'locationCode',
    accessorKey: 'locationCode',
    header: 'Location',
    size: 140,
    meta: { label: 'Location' },
    cell: ({ row }) => pickText(row.original.locationCode),
  },
  {
    id: 'clientName',
    accessorKey: 'clientName',
    header: 'Client',
    size: 140,
    meta: { label: 'Client' },
    cell: ({ row }) => pickText(row.original.clientName),
  },
  {
    id: 'skuCount',
    accessorKey: 'skuCount',
    header: 'Num. of SKU',
    size: 120,
    meta: { label: 'Num. of SKU', align: 'right' },
    cell: ({ row }) => pickQty(row.original.skuCount),
  },
  {
    id: 'onHand',
    accessorKey: 'onHand',
    header: 'On hand',
    size: 160,
    meta: { label: 'On hand', align: 'right', headerClassName: 'pr-8' },
    cell: ({ row }) => (
      <span className="flex w-full items-center justify-end gap-1.5 pr-8">
        {(row.original.allocated ?? 0) > 0 ? (
          <AllocatedChip allocated={row.original.allocated ?? 0} onHand={row.original.onHand} />
        ) : null}
        {pickQty(row.original.onHand)}
      </span>
    ),
  },
];

function LpPicker({ open, onOpenChange, warehouseId, exclude, onAdd, planId }: PickerProps<PickLp>) {
  const fields = useFilterFields(COUNT_LP_PICKER_FIELDS);
  const extra = React.useMemo(
    () => ({ warehouseId, ...(planId ? { exceptPlanId: planId } : {}) }),
    [warehouseId, planId],
  );
  return (
    <CountPickerModal<PickLp>
      open={open}
      onOpenChange={onOpenChange}
      title="Add License Plate"
      description="Pick the license plates to count. Only license plates placed in a location are listed."
      gridKey="count-pick-lps"
      path="/api/counts/pickers/lps"
      extraQuery={extra}
      columns={lpColumns}
      fields={fields}
      getRowId={(r) => r.id}
      excludeIds={exclude}
      isBlocked={inOpenCount}
      blockedNote={blockedNote}
      confirmLabel="Add"
      searchPlaceholder="Search LP number or location"
      onConfirm={onAdd}
    />
  );
}
