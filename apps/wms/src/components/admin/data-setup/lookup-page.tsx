'use client';

/**
 * One Data Setup lookup (`/settings/data-setup/<slug>`): H1, Create New …, grid (Name, Status,
 * type-specific columns, scope, Used by), a read-only Show details drawer (with Edit) and a
 * create / edit drawer with the type's fields (`lookup-type-fields.tsx`).
 * Values in use can't be deleted — the guard offers Deactivate instead.
 * `variant="section"` renders the same grid as an embeddable card (Return Process › Return reasons).
 */
import * as React from 'react';
import { Eye, History, Link2, Pencil, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useFormState } from 'react-hook-form';
import { apiRequest, isApiError } from '@/lib/api-client';
import { applyServerFieldErrors } from '@/lib/query-client';
import {
  LOOKUP_FIELDS,
  lookupCreateDefaults,
  lookupFormSchema,
  lookupFormValues,
  lookupGridKey,
  lookupIssues,
  MERGE_CRITERIA,
  MERGE_INHERITANCE,
  packingTriggerLabel,
  SO_TYPE_FLAGS,
  soTypeFlagLabel,
  ZONE_PUTAWAY_SETTINGS_ENFORCED,
  type LookupDef,
  type LookupFormValues,
} from '@/lib/grid-defs/admin/lookups';
import {
  DataGrid,
  DateCell,
  GridToolbar,
  useGrid,
  type BulkAction,
  type GridColumnDef,
  type RowAction,
} from '@/components/grid';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Form, FormGrid, SubmitBar, useZodForm } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import type { LookupGridRow } from '@/server/repositories/company-lookups';
import {
  armDestructive,
  EntityChangeLogDrawer,
  Muted,
  NO_PERMISSION,
  toastBulk,
  toFilterFields,
  useAction,
  useAdminOptions,
  useGridPatch,
  usePagePerms,
  type BulkResponse,
} from '../admin-shared';
import { NumberField, SelectField, TextInput, YesNoField } from '../form-controls';
import { DataSetupShell } from './data-setup-shell';
import {
  ComingSoonBadge,
  CUSTOM_CARRIER_STEPS,
  CustomCarrierStep,
  LookupTypeFields,
  TextAreaField,
  TYPES_WITH_DESCRIPTION,
} from './lookup-type-fields';
import { useLookupNames } from './use-lookup-names';
import { ZoneGroupsDialog } from './zone-groups-dialog';

type F = LookupFormValues;

const yesNo = (on: boolean) => (
  <Badge tone={on ? 'success' : 'neutral'} size="sm" shape="pill">
    {on ? 'Yes' : 'No'}
  </Badge>
);
const num = (v: unknown) => (
  <span className="block text-right tabular-nums">
    {typeof v === 'number' ? v.toLocaleString('en-US') : '—'}
  </span>
);

function typeColumns(
  def: LookupDef,
  damageNames: ReadonlyMap<string, string>,
): GridColumnDef<LookupGridRow>[] {
  const m = (r: LookupGridRow) => r.meta ?? {};
  const list = (r: LookupGridRow, k: string) => (Array.isArray(m(r)[k]) ? (m(r)[k] as unknown[]) : []);
  switch (def.type) {
    case 'vas_type':
      return [
        {
          id: 'calc',
          header: 'VAS calculation type',
          size: 170,
          cell: ({ row }) => (m(row.original).calculationType as string) ?? <Muted />,
        },
      ];
    case 'mobile_cart_type':
      return [
        {
          id: 'levels',
          header: 'Levels',
          size: 80,
          meta: { align: 'right' },
          cell: ({ row }) => num(m(row.original).levels),
        },
        {
          id: 'columns',
          header: 'Columns',
          size: 90,
          meta: { align: 'right' },
          cell: ({ row }) => num(m(row.original).columns),
        },
        {
          id: 'cells',
          header: 'Cells',
          size: 80,
          meta: { align: 'right' },
          cell: ({ row }) =>
            num(Number(m(row.original).levels ?? 0) * Number(m(row.original).columns ?? 0) || undefined),
        },
        {
          id: 'operation',
          header: 'Operation type',
          size: 130,
          cell: ({ row }) => (m(row.original).operation as string) ?? <Muted />,
        },
        {
          id: 'multiJob',
          header: 'Allow multiple jobs',
          size: 150,
          cell: ({ row }) => yesNo(m(row.original).allowMultipleJobs === true),
        },
      ];
    case 'order_merge_rule':
      return [
        {
          id: 'criteria',
          header: 'Merge when identical',
          size: 340,
          cell: ({ row }) => {
            const keys = (m(row.original).criteria as string[] | undefined) ?? [];
            return keys.length ? (
              <span className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <Badge key={k} tone="info" size="sm" shape="pill">
                    {MERGE_CRITERIA.find((c) => c.key === k)?.label ?? k}
                  </Badge>
                ))}
              </span>
            ) : (
              <Muted />
            );
          },
        },
        {
          id: 'inherit',
          header: 'Data inheritance',
          size: 170,
          cell: ({ row }) =>
            MERGE_INHERITANCE.find((x) => x.value === (m(row.original).inheritFrom ?? 'oldest'))?.title ?? (
              <Muted />
            ),
        },
      ];
    case 'damage_reason':
      return [
        {
          id: 'damaged',
          header: 'Counts as damaged',
          size: 150,
          cell: ({ row }) => yesNo(m(row.original).countsAsDamaged !== false),
        },
      ];
    case 'so_type':
      return [
        {
          id: 'flags',
          header: 'Behaviours on',
          size: 300,
          cell: ({ row }) => {
            const flags = (m(row.original).flags ?? {}) as Record<string, unknown>;
            const on = SO_TYPE_FLAGS.filter((k) => flags[k] === true);
            if (!on.length) return <Muted>Defaults</Muted>;
            return (
              <span className="flex flex-wrap gap-1" title={on.map(soTypeFlagLabel).join('\n')}>
                {on.slice(0, 2).map((k) => (
                  <Badge key={k} tone="info" size="sm" shape="pill">
                    {soTypeFlagLabel(k)}
                  </Badge>
                ))}
                {on.length > 2 ? (
                  <Badge tone="neutral" size="sm" shape="pill">
                    +{on.length - 2}
                  </Badge>
                ) : null}
              </span>
            );
          },
        },
      ];
    case 'location_zone':
      return [
        {
          id: 'code',
          header: 'Zone code',
          size: 120,
          cell: ({ row }) =>
            row.original.code ? <code className="font-mono text-xs">{row.original.code}</code> : <Muted />,
        },
        {
          id: 'priority',
          header: 'Priority',
          size: 90,
          meta: { align: 'right' },
          cell: ({ row }) => num(m(row.original).priority),
        },
        {
          id: 'maxLoc',
          header: 'Max loc. per SKU',
          size: 130,
          meta: { align: 'right' },
          cell: ({ row }) => num(m(row.original).maxLocationsPerSku),
        },
        {
          id: 'groups',
          header: 'Product groups',
          size: 130,
          meta: { align: 'right' },
          cell: ({ row }) => num(list(row.original, 'productGroupIds').length || undefined),
        },
      ];
    case 'packing_warning_type':
      return [
        {
          id: 'showWhen',
          header: 'Show warning when',
          size: 220,
          cell: ({ row }) => packingTriggerLabel(m(row.original).showWhen) ?? <Muted />,
        },
        {
          id: 'skip',
          header: 'Skip confirmation',
          size: 140,
          cell: ({ row }) => yesNo(m(row.original).skipConfirmation === true),
        },
      ];
    case 'custom_carrier':
      return [
        {
          id: 'code',
          header: 'Carrier code',
          size: 120,
          cell: ({ row }) =>
            row.original.code ? <code className="font-mono text-xs">{row.original.code}</code> : <Muted />,
        },
        {
          id: 'logo',
          header: 'Logo',
          size: 70,
          cell: ({ row }) =>
            typeof m(row.original).logoUrl === 'string' && m(row.original).logoUrl ? (
              <img
                src={m(row.original).logoUrl as string}
                alt=""
                className="h-6 w-auto max-w-[56px] object-contain"
              />
            ) : (
              <Muted />
            ),
        },
        {
          id: 'services',
          header: 'Service qty',
          size: 100,
          meta: { align: 'right' },
          cell: ({ row }) => num(list(row.original, 'services').length),
        },
        {
          id: 'packages',
          header: 'Package qty',
          size: 100,
          meta: { align: 'right' },
          cell: ({ row }) => num(list(row.original, 'packages').length),
        },
      ];
    case 'return_reason':
      return [
        {
          id: 'customer',
          header: 'Customer reason',
          size: 124,
          cell: ({ row }) => yesNo(m(row.original).customerReason !== false),
        },
        {
          id: 'actual',
          header: 'Actual reason',
          size: 112,
          cell: ({ row }) => yesNo(m(row.original).actualReason !== false),
        },
        {
          id: 'linked',
          header: 'Linked damage reason',
          size: 160,
          cell: ({ row }) => {
            const id = m(row.original).linkedDamageReasonId;
            return typeof id === 'string' ? (damageNames.get(id) ?? <Muted>Removed</Muted>) : <Muted />;
          },
        },
      ];
    default:
      return [];
  }
}

function columns(
  def: LookupDef,
  onEdit: (r: LookupGridRow) => void,
  damageNames: ReadonlyMap<string, string>,
  onToggle: ((r: LookupGridRow) => void) | null,
  compact = false,
): GridColumnDef<LookupGridRow>[] {
  const all: GridColumnDef<LookupGridRow>[] = [
    {
      id: 'name',
      header: 'Name',
      size: 220,
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <button
          type="button"
          title={row.original.name}
          onClick={(e) => {
            e.stopPropagation();
            onEdit(row.original);
          }}
          className="block max-w-full truncate text-left font-medium text-primary hover:underline"
        >
          {row.original.name}
        </button>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      size: 130,
      meta: { headerTip: onToggle ? 'Switch a value on or off right here' : undefined },
      cell: ({ row }) => (
        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {onToggle ? (
            <Switch
              size="sm"
              checked={row.original.isActive}
              onCheckedChange={() => onToggle(row.original)}
              aria-label={`${row.original.isActive ? 'Deactivate' : 'Activate'} ${row.original.name}`}
            />
          ) : null}
          <StatusPill status={row.original.status} size="sm" />
        </span>
      ),
    },
    ...typeColumns(def, damageNames),
    ...(def.scope === 'warehouse'
      ? [
          {
            id: 'warehouseCode',
            header: 'Warehouse',
            size: 110,
            cell: ({ row }: { row: { original: LookupGridRow } }) =>
              row.original.warehouseCode ?? <Muted>All</Muted>,
          } as GridColumnDef<LookupGridRow>,
        ]
      : []),
    ...(def.scope === 'client'
      ? [
          {
            id: 'clientName',
            header: 'Client',
            size: 180,
            cell: ({ row }: { row: { original: LookupGridRow } }) =>
              row.original.clientName ?? <Muted>All clients</Muted>,
          } as GridColumnDef<LookupGridRow>,
        ]
      : []),
    {
      id: 'usageCount',
      header: 'Used by',
      size: 100,
      meta: { align: 'right', headerTip: 'Records that use this value' },
      cell: ({ row }) => (
        <span className="block text-right tabular-nums">
          {row.original.usageCount.toLocaleString('en-US')}
        </span>
      ),
    },
    {
      id: 'sortOrder',
      header: 'Sort order',
      size: 100,
      meta: { defaultVisible: false, align: 'right' },
      cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.sortOrder}</span>,
    },
    {
      id: 'updatedAt',
      header: 'Updated',
      size: 180,
      cell: ({ row }) => <DateCell value={row.original.updatedAt} />,
    },
  ];
  // Embedded card (Return Process): no Updated / Sort order, so every column fits without truncation.
  return compact ? all.filter((c) => c.id !== 'updatedAt' && c.id !== 'sortOrder') : all;
}

function Dirty({
  control,
  onDirty,
}: {
  readonly control: ReturnType<typeof useZodForm<typeof lookupFormSchema>>['control'];
  readonly onDirty: (d: boolean) => void;
}) {
  const { isDirty } = useFormState({ control });
  React.useEffect(() => onDirty(isDirty), [isDirty, onDirty]);
  return null;
}

const codeLabel = (def: LookupDef) =>
  def.type === 'location_zone' ? 'Zone code' : def.type === 'custom_carrier' ? 'Carrier code' : 'Code';

function LookupForm({
  def,
  row,
  readOnly,
  onEdit,
  onDone,
  onCancel,
  onDirty,
}: {
  readonly def: LookupDef;
  readonly row: LookupGridRow | null;
  readonly readOnly: boolean;
  readonly onEdit?: () => void;
  readonly onDone: () => void;
  readonly onCancel: () => void;
  readonly onDirty: (d: boolean) => void;
}) {
  const options = useAdminOptions();
  const qc = useQueryClient();
  const schema = React.useMemo(
    () =>
      lookupFormSchema.superRefine((v, ctx) => {
        for (const i of lookupIssues(def, v))
          ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
      }),
    [def],
  );
  const initial: F = row ? lookupFormValues(row) : lookupCreateDefaults(def);
  const form = useZodForm(schema, initial);
  const [conflict, setConflict] = React.useState(false);
  const locked = Boolean(row && row.usageCount > 0);
  // Custom Carrier: stepped wizard (General, Services, Packages, Advanced); General must be valid to move on.
  const wizard = def.type === 'custom_carrier' && !readOnly;
  const [step, setStep] = React.useState(0);
  const lastStep = CUSTOM_CARRIER_STEPS.length - 1;
  const goTo = async (target: number) => {
    if (target > 0 && step === 0 && !(await form.trigger(['name', 'code', 'logoUrl', 'description']))) return;
    setStep(Math.max(0, Math.min(lastStep, target)));
  };
  const submit = async (values: unknown) => {
    try {
      const body = { ...(values as object), version: row?.version };
      if (row) await apiRequest(`/api/company/lookups/${def.type}/${row.id}`, { method: 'PATCH', body });
      else await apiRequest(`/api/company/lookups/${def.type}`, { method: 'POST', body });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['grid', lookupGridKey(def.type)] }),
        qc.invalidateQueries({ queryKey: ['lookup-counts'] }),
        qc.invalidateQueries({ queryKey: ['lookups', def.type] }),
      ]);
      toast.success(
        row ? `${def.noun} has been updated successfully.` : `${def.noun} has been created successfully.`,
        `${(values as F).name} is ${(values as F).isActive ? 'available now' : 'saved as inactive'}.`,
      );
      form.reset(values as F);
      onDone();
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') setConflict(true);
      applyServerFieldErrors(form, error);
      toast.error(
        `Couldn't save the ${def.noun.toLowerCase()}`,
        isApiError(error) ? error.message : 'Something went wrong',
      );
    }
  };
  return (
    <Form form={form} onSubmit={submit} className="flex flex-col gap-4">
      <Dirty control={form.control} onDirty={onDirty} />
      {conflict ? (
        <Callout
          variant="attention"
          title="This value changed since you opened it"
          action={
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        >
          Reload to see the latest version.
        </Callout>
      ) : null}
      {row && row.usageCount > 0 ? (
        <Callout variant="info" title={`Used by ${row.usageCount.toLocaleString('en-US')} records`}>
          Deactivate it to stop new use; existing records keep it.
        </Callout>
      ) : null}
      {wizard ? (
        <ol className="flex items-center gap-2" aria-label="Custom carrier steps">
          {CUSTOM_CARRIER_STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              {i > 0 ? <span className="h-px w-5 bg-border" aria-hidden /> : null}
              <button
                type="button"
                onClick={() => void goTo(i)}
                aria-current={i === step ? 'step' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${i === step ? 'bg-primary-soft font-semibold text-primary' : 'text-secondary hover:text-foreground'}`}
              >
                <span
                  aria-hidden
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-2xs font-semibold ${i === step ? 'bg-primary text-white' : i < step ? 'bg-success-soft text-success' : 'bg-neutral-soft text-secondary'}`}
                >
                  {i < step ? '✓' : i + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {wizard && step > 0 ? (
        <div className="flex min-w-0 flex-col gap-4">
          <CustomCarrierStep step={step} />
        </div>
      ) : null}
      <fieldset
        disabled={readOnly}
        hidden={wizard && step > 0}
        className="flex min-w-0 flex-col gap-4 disabled:opacity-100"
      >
        <TextInput<F>
          name="name"
          label={`${def.noun} name`}
          required
          maxLength={120}
          placeholder={`e.g. ${def.type === 'so_cancel_reason' ? 'Customer changed mind' : def.type === 'vas_type' ? 'Gift wrapping' : def.type === 'location_zone' ? 'Fast movers' : 'New value'}`}
        />
        {def.hasCode ? (
          <TextInput<F>
            name="code"
            label={codeLabel(def)}
            required={def.type === 'location_zone' || def.type === 'custom_carrier'}
            maxLength={60}
            transform={(v) => v.toUpperCase()}
            info={
              def.type === 'custom_carrier'
                ? 'Printed on labels and manifests'
                : 'Short code shown on location labels'
            }
          />
        ) : null}
        {def.scope === 'warehouse' ? (
          <SelectField<F>
            name="warehouseId"
            label="Warehouse"
            required={def.scopeRequired}
            clearable={!def.scopeRequired}
            placeholder={def.scopeRequired ? 'Select' : 'All warehouses'}
            options={options.warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))}
            disabled={locked || readOnly}
            info={
              locked
                ? 'Locked while in use'
                : def.scopeRequired
                  ? undefined
                  : 'Leave empty to offer it in every warehouse'
            }
          />
        ) : null}
        {def.scope === 'client' ? (
          <SelectField<F>
            name="clientId"
            label="Client"
            clearable
            placeholder="All clients"
            options={options.clients.map((c) => ({ value: c.id, label: c.name }))}
            info="Leave empty to offer it for every client"
            disabled={readOnly}
          />
        ) : null}
        {TYPES_WITH_DESCRIPTION.has(def.type) ? (
          <TextAreaField name="description" label="Description" maxLength={500} />
        ) : null}
        {wizard ? <CustomCarrierStep step={0} /> : <LookupTypeFields def={def} />}
        <FormGrid>
          <YesNoField<F> name="isActive" label="Active" info="Inactive values are hidden from dropdowns" />
          <NumberField<F>
            name="sortOrder"
            label="Sort order"
            min={0}
            max={100000}
            info="Lower numbers are listed first"
          />
        </FormGrid>
      </fieldset>
      {readOnly ? (
        <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
          {onEdit ? (
            <Button variant="primary" onClick={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Button>
          ) : null}
        </div>
      ) : wizard && !row && step < lastStep ? (
        <div
          data-sticky-footer=""
          className="sticky bottom-0 z-10 -mx-5 flex items-center justify-between gap-2 border-t border-border bg-surface px-5 py-3"
        >
          <div>
            {step > 0 ? (
              <Button variant="secondary" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void goTo(step + 1)}>
              Next: {CUSTOM_CARRIER_STEPS[step + 1]}
            </Button>
          </div>
        </div>
      ) : (
        <SubmitBar
          submitLabel={row ? 'Save' : `Create ${def.noun.toLowerCase()}`}
          onCancel={onCancel}
          requireDirty={Boolean(row)}
          sticky
          secondary={
            wizard ? (
              <>
                {step > 0 ? (
                  <Button variant="secondary" onClick={() => setStep(step - 1)}>
                    Back
                  </Button>
                ) : null}
                {row && step < lastStep ? (
                  <Button variant="ghost" onClick={() => void goTo(step + 1)}>
                    Next: {CUSTOM_CARRIER_STEPS[step + 1]}
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
      )}
    </Form>
  );
}

/**
 * `variant="section"` embeds the same grid + drawers as a card inside another settings page
 * (e.g. Return Reasons on Return Process), without the Data Setup frame or page header.
 */
export function LookupPage({
  def,
  variant = 'page',
  sectionTitle,
  sectionDescription,
}: {
  readonly def: LookupDef;
  readonly variant?: 'page' | 'section';
  readonly sectionTitle?: string;
  readonly sectionDescription?: string;
}) {
  const perms = usePagePerms('settings.data_setup', ['view'] as const);
  const canEdit = perms.view;
  const options = useAdminOptions();
  const gridKey = lookupGridKey(def.type);
  const fields = React.useMemo(
    () =>
      toFilterFields(
        LOOKUP_FIELDS.filter((f) =>
          f.field === 'warehouseId'
            ? def.scope === 'warehouse'
            : f.field === 'clientId'
              ? def.scope === 'client'
              : true,
        ),
        {
          warehouseId: options.warehouses.map((w) => ({ value: w.id, label: w.code })),
          clientId: options.clients.map((c) => ({ value: c.id, label: c.name })),
        },
      ),
    [def.scope, options.warehouses, options.clients],
  );
  const g = useGrid<LookupGridRow>({ gridKey, path: `/api/company/lookups/${def.type}`, fields });
  const [drawer, setDrawer] = React.useState<{ open: boolean; row: LookupGridRow | null; readOnly: boolean }>(
    { open: false, row: null, readOnly: false },
  );
  const damage = useLookupNames(def.type === 'return_reason' ? 'damage_reason' : null);
  const damageNames = React.useMemo(() => new Map(damage.map((d) => [d.id, d.name])), [damage]);
  const [dirty, setDirty] = React.useState(false);
  const [log, setLog] = React.useState<LookupGridRow | null>(null);
  const [toDelete, setToDelete] = React.useState<readonly LookupGridRow[] | null>(null);
  const [inUse, setInUse] = React.useState<readonly LookupGridRow[] | null>(null);
  const [matchGroups, setMatchGroups] = React.useState(false);
  const action = useAction([['grid', gridKey], ['lookup-counts'], ['lookups', def.type]]);
  const patchRows = useGridPatch<LookupGridRow>(gridKey);
  const selected = (ids: readonly string[]) => g.rows.filter((r) => ids.includes(r.id));
  const edit = (row: LookupGridRow | null) =>
    setDrawer({ open: true, row, readOnly: !canEdit && row !== null });
  const details = (row: LookupGridRow) => setDrawer({ open: true, row, readOnly: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- edit only depends on canEdit
  const cols = React.useMemo(
    () =>
      columns(
        def,
        edit,
        damageNames,
        canEdit ? (r) => void setActive([r], !r.isActive) : null,
        variant === 'section',
      ),
    [def, damageNames, canEdit, variant],
  );
  const setActive = async (rows: readonly LookupGridRow[], isActive: boolean) => {
    const result = await action.run<BulkResponse>(`/api/company/lookups/${def.type}/bulk-status`, 'POST', {
      ids: rows.map((r) => r.id),
      isActive,
    });
    if (result) {
      const done = new Set(result.succeeded);
      patchRows((rs) =>
        rs.map((r) => (done.has(r.id) ? { ...r, isActive, status: isActive ? 'Active' : 'Inactive' } : r)),
      );
      toastBulk(result, def.noun.toLowerCase(), isActive ? 'activated' : 'deactivated');
      g.clearSelection();
    }
  };
  const askDelete = (rows: readonly LookupGridRow[]) => {
    const used = rows.filter((r) => r.usageCount > 0);
    if (used.length === rows.length) setInUse(used);
    else setToDelete(rows);
  };
  const bulkActions: readonly BulkAction[] = [
    {
      key: 'activate',
      label: 'Activate',
      icon: Power,
      onSelect: (ids) => void setActive(selected(ids), true),
      disabledReason: canEdit ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => r.isActive) ? 'Already active' : null),
    },
    {
      key: 'deactivate',
      label: 'Deactivate',
      icon: PowerOff,
      onSelect: (ids) => void setActive(selected(ids), false),
      disabledReason: canEdit ? null : NO_PERMISSION,
      eligibility: (ids) => (selected(ids).every((r) => !r.isActive) ? 'Already inactive' : null),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: (ids) => askDelete(selected(ids)),
      disabledReason: canEdit ? null : NO_PERMISSION,
    },
  ];
  const rowActions = (row: LookupGridRow): readonly RowAction[] => [
    { key: 'details', label: 'Show details', icon: Eye, onSelect: () => details(row) },
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      onSelect: () => edit(row),
      disabledReason: canEdit ? null : NO_PERMISSION,
    },
    row.isActive
      ? {
          key: 'deactivate',
          label: 'Deactivate',
          icon: PowerOff,
          onSelect: () => void setActive([row], false),
          disabledReason: canEdit ? null : NO_PERMISSION,
        }
      : {
          key: 'activate',
          label: 'Activate',
          icon: Power,
          onSelect: () => void setActive([row], true),
          disabledReason: canEdit ? null : NO_PERMISSION,
        },
    { key: 'log', label: 'Change log', icon: History, onSelect: () => setLog(row) },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => askDelete([row]),
      disabledReason: canEdit ? null : NO_PERMISSION,
    },
  ];
  const filtered = g.grid.query.filters.length > 0 || Boolean(g.grid.query.q);
  const close = () => {
    setDirty(false);
    setDrawer((d) => ({ ...d, open: false }));
  };
  const createButton = (label: string, variantName: 'primary' | 'secondary' = 'primary') => (
    <DisabledReason reason={canEdit ? null : NO_PERMISSION}>
      <Button variant={variantName} disabled={!canEdit} onClick={() => edit(null)}>
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </Button>
    </DisabledReason>
  );
  const body = (
    <>
      <GridToolbar
        {...g.toolbarProps}
        searchPlaceholder="Search by name"
        bulkActions={bulkActions.map((a) => armDestructive(a, g.toolbarProps.selectedIds))}
        bulkNoun={def.noun.toLowerCase()}
      />
      <DataGrid<LookupGridRow>
        {...g.gridProps}
        columns={cols}
        getRowId={(r) => r.id}
        rowActions={(row) => rowActions(row).map((a) => armDestructive(a))}
        onRowClick={(r) => details(r)}
        emptyTitle={
          filtered ? `No ${def.title.toLowerCase()} match these filters` : `No ${def.title.toLowerCase()} yet`
        }
        emptyDescription={filtered ? 'Clear a filter or search for another name.' : def.description}
        emptyAction={
          canEdit && !filtered ? (
            <Button variant="primary" onClick={() => edit(null)}>
              <Plus className="h-4 w-4" />
              Create new {def.noun.toLowerCase()}
            </Button>
          ) : undefined
        }
      />
      <Drawer
        open={drawer.open}
        onOpenChange={(o) => (o ? undefined : close())}
        dirty={dirty}
        width={35}
        bodyClassName="pb-0"
        title={
          drawer.row
            ? `${drawer.readOnly ? '' : 'Edit '}${drawer.readOnly ? drawer.row.name : def.noun.toLowerCase()}`
            : `Create new ${def.noun.toLowerCase()}`
        }
        description={drawer.readOnly ? `${def.noun} details` : def.description}
      >
        {drawer.open ? (
          <LookupForm
            key={`${drawer.row?.id ?? 'new'}-${drawer.readOnly}`}
            def={def}
            row={drawer.row}
            readOnly={drawer.readOnly}
            onEdit={canEdit ? () => setDrawer((d) => ({ ...d, readOnly: false })) : undefined}
            onDone={close}
            onCancel={close}
            onDirty={setDirty}
          />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </Drawer>
      <EntityChangeLogDrawer
        open={log !== null}
        onOpenChange={(o) => !o && setLog(null)}
        path={log ? `/api/company/lookups/${def.type}/${log.id}/change-log` : null}
        title={`${def.noun} change log · ${log?.name ?? ''}`}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        variant="danger"
        title={`Delete ${toDelete?.length === 1 ? `"${toDelete[0]?.name}"` : `${toDelete?.length ?? 0} values`}?`}
        description="Values still in use are skipped. Deactivate those instead."
        confirmLabel="Yes, delete"
        cancelLabel="No"
        records={{
          columns: [
            { key: 'name', label: def.noun },
            { key: 'used', label: 'Used by' },
          ],
          rows: (toDelete ?? []).map((r) => ({ name: r.name, used: r.usageCount })),
        }}
        onConfirm={async () => {
          const result = await action.run<BulkResponse>(
            `/api/company/lookups/${def.type}/bulk-delete`,
            'POST',
            { ids: (toDelete ?? []).map((r) => r.id) },
          );
          if (result) {
            const done = new Set(result.succeeded);
            patchRows((rs) => rs.filter((r) => !done.has(r.id)));
            toastBulk(result, def.noun.toLowerCase(), 'deleted');
            g.clearSelection();
          }
          setToDelete(null);
        }}
      />
      <ConfirmDialog
        open={inUse !== null}
        onOpenChange={(o) => !o && setInUse(null)}
        variant="attention"
        icon={PowerOff}
        title={
          inUse?.length === 1 ? `"${inUse[0]?.name}" is in use` : `${inUse?.length ?? 0} values are in use`
        }
        description="Values used by records can't be deleted. Deactivate them to hide them from dropdowns; existing records keep them."
        confirmLabel="Deactivate instead"
        cancelLabel="Cancel"
        records={{
          columns: [
            { key: 'name', label: def.noun },
            { key: 'used', label: 'Used by' },
          ],
          rows: (inUse ?? []).map((r) => ({ name: r.name, used: r.usageCount })),
        }}
        onConfirm={async () => {
          if (inUse)
            await setActive(
              inUse.filter((r) => r.isActive),
              false,
            );
          setInUse(null);
        }}
      />
      {def.type === 'location_zone' ? (
        <ZoneGroupsDialog
          open={matchGroups}
          onOpenChange={setMatchGroups}
          canEdit={canEdit}
          onSaved={() => g.refetch()}
        />
      ) : null}
    </>
  );
  if (variant === 'section') {
    return (
      <section
        aria-labelledby={`lookup-section-${def.type}`}
        className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={`lookup-section-${def.type}`} className="text-base font-semibold text-foreground">
              {sectionTitle ?? def.title}
            </h2>
            <p className="mt-0.5 text-xs text-secondary">{sectionDescription ?? def.description}</p>
          </div>
          {createButton('Add new', 'secondary')}
        </header>
        <div className="flex h-[420px] min-h-0 flex-col">{body}</div>
      </section>
    );
  }
  return (
    <DataSetupShell>
      <PageHeader
        title={def.title}
        helper={def.description}
        crumbLabel={def.title}
        actions={
          def.type === 'location_zone' ? (
            <>
              {ZONE_PUTAWAY_SETTINGS_ENFORCED ? (
                <Button variant="secondary" onClick={() => setMatchGroups(true)}>
                  <Link2 className="h-4 w-4" aria-hidden />
                  Match With Product Groups
                </Button>
              ) : (
                <DisabledReason reason="Coming soon: put-away doesn't suggest zones by product group yet. Matches saved earlier are kept and shown in the Product groups column.">
                  <Button variant="secondary" disabled>
                    <Link2 className="h-4 w-4" aria-hidden />
                    Match With Product Groups
                    <ComingSoonBadge />
                  </Button>
                </DisabledReason>
              )}
              {createButton(`Create new ${def.noun.toLowerCase()}`)}
            </>
          ) : (
            createButton(`Create new ${def.noun.toLowerCase()}`)
          )
        }
      />
      {body}
    </DataSetupShell>
  );
}
