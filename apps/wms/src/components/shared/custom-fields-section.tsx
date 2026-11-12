'use client';

/**
 * Custom Fields section for entity forms: renders the entity's active custom field
 * definitions (`GET /api/custom-fields?entityType=`) as inputs bound to a
 * `slot → value` record, plus a "Create Custom Field" entry point (permission-gated by
 * the caller through `canManage`).
 */
import * as React from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { formatInputDateTime, parseInputDateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TextField } from '@/components/ui/text-field';
import { YesNoToggle } from '@/components/ui/yes-no-toggle';
import { customFieldDefSchema, parseList, type CustomFieldDef } from './contracts';
import { CustomFieldsDrawer, customFieldsQueryKey } from './custom-fields-drawer';
import { slotType } from './custom-fields-model';

export type CustomFieldValue = string | boolean | null;
export type CustomFieldValues = Readonly<Record<string, CustomFieldValue>>;

export interface CustomFieldsSectionProps {
  readonly entityType: string;
  readonly values: CustomFieldValues;
  readonly onChange: (values: CustomFieldValues) => void;
  readonly canManage?: boolean;
  readonly disabled?: boolean;
}

function FieldInput({
  def,
  value,
  onChange,
  disabled,
}: {
  readonly def: CustomFieldDef;
  readonly value: CustomFieldValue;
  readonly onChange: (v: CustomFieldValue) => void;
  readonly disabled?: boolean;
}) {
  switch (slotType(def.slot)) {
    case 'dropDown':
      return (
        <Select
          aria-label={def.name}
          disabled={disabled}
          clearable
          value={typeof value === 'string' ? value : null}
          onChange={(v) => onChange(v)}
          options={(def.options ?? []).map((o) => ({ value: o, label: o }))}
          placeholder="Select"
        />
      );
    case 'date':
      return (
        <DatePicker
          disabled={disabled}
          clearable
          value={typeof value === 'string' && value ? parseInputDateTime(value) : null}
          onChange={(d) => onChange(d ? formatInputDateTime(d).slice(0, 10) : null)}
        />
      );
    case 'toggle':
      return (
        <YesNoToggle
          ariaLabel={def.name}
          disabled={disabled}
          value={typeof value === 'boolean' ? value : null}
          onChange={(v) => onChange(v)}
        />
      );
    default:
      return (
        <TextField
          aria-label={def.name}
          disabled={disabled}
          maxLength={500}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

export function CustomFieldsSection({
  entityType,
  values,
  onChange,
  canManage = false,
  disabled,
}: CustomFieldsSectionProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const query = useApiQuery<unknown>(customFieldsQueryKey(entityType), '/api/custom-fields', {
    query: { entityType },
  });
  const all = parseList(customFieldDefSchema, query.data?.data);
  const active = all.filter((d) => d.isActive);

  return (
    <section aria-labelledby={`cf-${entityType}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3
          id={`cf-${entityType}`}
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-secondary" aria-hidden />
          Custom Fields
        </h3>
        {canManage ? (
          <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Create Custom Field
          </Button>
        ) : null}
      </div>
      {query.isPending ? (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : query.error ? (
        <p className="text-xs text-danger">
          Custom fields could not be loaded.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : active.length === 0 ? (
        <p className="text-xs text-faint">No custom fields are configured for this item type.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {active.map((def) => (
            <label key={def.id} className="flex flex-col gap-1 text-xs font-semibold text-secondary">
              {def.name}
              <FieldInput
                def={def}
                disabled={disabled}
                value={values[def.slot] ?? null}
                onChange={(v) => onChange({ ...values, [def.slot]: v })}
              />
            </label>
          ))}
        </div>
      )}
      {canManage ? (
        <CustomFieldsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          entityType={entityType}
          existing={all}
        />
      ) : null}
    </section>
  );
}
