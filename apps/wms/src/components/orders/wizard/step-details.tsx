'use client';

/** Step 1 — Order details: warehouse, client, code (auto + inline uniqueness), type, dates, note, priority. */
import * as React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { FormGrid, FormGridFull } from '@/components/ui/form';
import { Spinner } from '@/components/ui/spinner';
import { AreaF, ComboF, DateTimeF, NumF, SelectF, StaticF, TextF } from './fields';
import { NOTE_MAX, ORDER_CODE_MAX, type OrderFormValues } from './order-form-model';
import { LOCKED_FIELD_REASON, useOrderWizard } from './order-wizard-context';

interface CodeCheck {
  readonly code: string;
  readonly available: boolean;
  readonly suggested: string;
}

const CODE_DEBOUNCE_MS = 350;

/** Inline message for a code another order already uses. */
export function codeTakenMessage(code: string): string {
  return `Order code ${code} is already taken`;
}

function useOrderCode(enabled: boolean, excludeId: string | null) {
  const { setValue, getValues, control, setError, clearErrors, getFieldState } =
    useFormContext<OrderFormValues>();
  const code = useWatch({ control, name: 'code' });
  const [checking, setChecking] = React.useState(false);
  /** The first sequence value is still loading: the field reads "Generating…" and is never flagged as empty. */
  const [generating, setGenerating] = React.useState(() => enabled && !getValues('code'));

  /**
   * `userAction` = the "auto generated" link. The initial fill is a default, not an edit: it is
   * written without `shouldDirty`, so the unsaved-changes guard fires only after a real user edit.
   */
  const regenerate = React.useCallback(
    async (userAction: boolean) => {
      setChecking(true);
      if (!userAction) setGenerating(true);
      try {
        const res = await apiFetch<CodeCheck>('/api/orders/code-check');
        if (!userAction && getValues('code')) return; // the user typed a code while the sequence loaded
        setValue('codeSuggested', res.suggested);
        setValue('code', res.suggested, userAction ? { shouldDirty: true, shouldValidate: true } : {});
        setValue('codeTaken', false);
        // An "Enter an order code" raised while the suggestion was loading no longer applies.
        if (getFieldState('code').error) clearErrors('code');
      } catch {
        // Sequence unavailable: leave the field empty for the user; the required rule applies again.
      } finally {
        setChecking(false);
        setGenerating(false);
      }
    },
    [setValue, getValues, getFieldState, clearErrors],
  );

  /* Fill the next sequence value on a fresh create. */
  React.useEffect(() => {
    if (enabled && !getValues('code')) void regenerate(false);
  }, [enabled, getValues, regenerate]);

  /* Inline uniqueness check (debounced). */
  React.useEffect(() => {
    const value = (code ?? '').trim();
    if (!enabled || !value) return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setChecking(true);
      apiFetch<CodeCheck>('/api/orders/code-check', {
        query: { code: value, excludeId: excludeId ?? undefined },
        signal: ctrl.signal,
      })
        .then((res) => {
          if (getValues('code').trim() !== value) return;
          // A stale auto code (restored draft, or another user saved it): swap in the next free one silently.
          if (!res.available && value === getValues('codeSuggested')) {
            const dirty = getFieldState('code').isDirty;
            setValue('codeSuggested', res.suggested);
            setValue('code', res.suggested, dirty ? { shouldDirty: true, shouldValidate: true } : {});
            setValue('codeTaken', false);
            return;
          }
          setValue('codeTaken', !res.available, { shouldValidate: false });
          // Say why at once, without waiting for Next.
          if (!res.available) setError('code', { type: 'taken', message: codeTakenMessage(value) });
          else if (getFieldState('code').error?.type === 'taken') clearErrors('code');
        })
        .catch(() => undefined)
        .finally(() => setChecking(false));
    }, CODE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [code, enabled, excludeId, getValues, setValue, setError, clearErrors, getFieldState]);

  /* Never show "Enter an order code" for an empty field that is still being filled. */
  const codeError = getFieldState('code').error;
  React.useEffect(() => {
    if (generating && codeError && codeError.type !== 'taken') clearErrors('code');
  }, [generating, codeError, clearErrors]);

  return { checking, generating, regenerate };
}

export function StepDetails() {
  const { mode, options, optionsLoading, locks, detail } = useOrderWizard();
  const { setValue, getValues, control, trigger, formState, getFieldState, clearErrors } =
    useFormContext<OrderFormValues>();
  const warehouseId = useWatch({ control, name: 'warehouseId' });
  const codeTaken = useWatch({ control, name: 'codeTaken' });
  const orderTypeId = useWatch({ control, name: 'orderTypeId' });
  const orderTypeName = useWatch({ control, name: 'orderTypeName' });
  const create = mode === 'create';
  const { checking, generating, regenerate } = useOrderCode(create, detail?.order.id ?? null);
  const headerLock = locks.header;

  /* Re-run the code rule (format / length) once the user touched the field. The "taken" error is
     set by the debounced check itself so it shows without pressing Next. */
  React.useEffect(() => {
    if (formState.touchedFields.code && !codeTaken) void trigger('code');
  }, [codeTaken, trigger, formState.touchedFields.code]);

  /* Preselect the only warehouse and the default order type. These are defaults, not edits: they are
     written without `shouldDirty`, so an untouched form never raises the unsaved-changes prompt. */
  React.useEffect(() => {
    if (!create || !options) return;
    if (!getValues('warehouseId') && options.warehouses.length === 1)
      setValue('warehouseId', options.warehouses[0]?.value ?? '');
    if (!getValues('orderTypeId') && options.orderTypes.length > 0) {
      const preferred = options.orderTypes.find((o) => /d2c/i.test(o.label)) ?? options.orderTypes[0];
      if (preferred) {
        setValue('orderTypeId', preferred.value);
        setValue('orderTypeName', preferred.label);
      }
    }
  }, [create, options, getValues, setValue, orderTypeId]);

  /* Edit mode: the saved order may sit outside the option lists (or they are still loading) — never show a raw id. */
  React.useEffect(() => {
    if (create || !options || !detail || getValues('orderTypeId')) return;
    const match = options.orderTypes.find((o) => o.label === detail.orderTypeName);
    if (match) {
      setValue('orderTypeId', match.value);
      setValue('orderTypeName', match.label);
    }
  }, [create, options, detail, getValues, setValue]);

  const withSaved = <T extends { value: string; label: string }>(
    list: T[],
    id: string | undefined,
    label: string | undefined,
  ): T[] => (id && label && !list.some((o) => o.value === id) ? [...list, { value: id, label } as T] : list);
  const warehouseOptions = withSaved(
    (options?.warehouses ?? []).map((o) => ({ value: o.value, label: o.label })),
    detail?.order.warehouseId,
    detail?.warehouseLabel,
  );
  const clientOptions = withSaved(
    (options?.clients ?? []).map((o) => ({
      value: o.value,
      label: o.label,
      description: o.description ?? undefined,
    })),
    detail?.order.clientId,
    detail?.clientName,
  );
  // Hydrate the current value before the lookup arrives (edit mode, restored drafts): the select never renders blank.
  const typeOptions = withSaved(
    (options?.orderTypes ?? []).map((o) => ({ value: o.value, label: o.label })),
    orderTypeId || undefined,
    orderTypeName || detail?.orderTypeName,
  );
  const loadingText = optionsLoading ? 'Loading…' : undefined;
  const locked = create ? undefined : LOCKED_FIELD_REASON;

  return (
    <FormGrid columns={3}>
      {create ? (
        <ComboF
          name="warehouseId"
          label="Warehouse"
          required
          options={warehouseOptions}
          placeholder={optionsLoading ? 'Loading warehouses…' : 'Select warehouse'}
          emptyText={loadingText}
          onValue={() => {
            setValue('carrierConnectionId', null);
            setValue('carrierServiceId', null);
            setValue('shipmentPackageId', null);
          }}
        />
      ) : (
        <StaticF label="Warehouse" value={detail?.warehouseLabel} description={locked} />
      )}
      {create ? (
        <ComboF
          name="clientId"
          label="Client"
          required
          disabled={!warehouseId}
          description={!warehouseId ? 'Choose a warehouse first' : undefined}
          options={clientOptions}
          placeholder={optionsLoading ? 'Loading clients…' : 'Select client'}
          emptyText={loadingText}
          onValue={() => {
            if (getValues('lines').length > 0) setValue('lines', [], { shouldDirty: true });
            setValue('customerId', null);
          }}
        />
      ) : (
        <StaticF label="Client" value={detail?.clientName} description={locked} />
      )}
      <TextF
        name="code"
        label="Order code"
        required
        maxLength={ORDER_CODE_MAX}
        hideCount
        placeholder={create && generating ? 'Generating order code…' : undefined}
        disabled={!create}
        description={create ? undefined : "Order codes can't be changed after save."}
        info="Auto generated from the shipment order sequence. You can type your own code; it must be unique."
        onValue={() => {
          setValue('codeTaken', false);
          if (getFieldState('code').error?.type === 'taken') clearErrors('code');
        }}
        trailing={
          create ? (
            checking ? (
              <span className="flex items-center gap-1 whitespace-nowrap text-2xs text-faint" role="status">
                <Spinner className="h-3 w-3" label="Checking code" />
                {generating ? 'Generating…' : 'Checking…'}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void regenerate(true)}
                className="flex items-center gap-1 whitespace-nowrap rounded text-2xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                auto generated
              </button>
            )
          ) : undefined
        }
      />
      <SelectF
        name="orderTypeId"
        label="Order type"
        required
        disabled={Boolean(headerLock)}
        options={typeOptions}
        placeholder={optionsLoading && typeOptions.length === 0 ? 'Loading…' : undefined}
        info="Select an order type or create a new one from Data setup under Settings."
        onValue={(v) => setValue('orderTypeName', typeOptions.find((o) => o.value === v)?.label ?? '')}
      />
      <DateTimeF name="orderDate" label="Order date" required disabled={Boolean(headerLock)} />
      <DateTimeF
        name="expectedShipDate"
        label="Expected shipment date"
        required
        disabled={Boolean(headerLock)}
      />
      <DateTimeF name="expectedDeliveryDate" label="Expected delivery date" disabled={Boolean(headerLock)} />
      <DateTimeF
        name="carrierExpectedDeliveryDate"
        label="Carrier expected delivery date"
        disabled
        info="Filled in by the carrier when a label is created."
      />
      <DateTimeF name="scheduledPickupDate" label="Scheduled pickup date" disabled={Boolean(headerLock)} />
      <DateTimeF
        name="scheduledShipmentDate"
        label="Scheduled shipment date"
        disabled={Boolean(headerLock)}
      />
      <TextF
        name="storeOrderNumber"
        label="Store order #"
        maxLength={100}
        disabled={Boolean(headerLock)}
        info="The order number in the sales channel, if any."
      />
      <NumF
        name="priorityRank"
        label="Priority"
        min={0}
        max={9999}
        disabled={Boolean(headerLock)}
        info="Higher numbers are picked first. 1 Low · 2 Medium · 3 High · 4+ Urgent."
      />
      <FormGridFull>
        <AreaF
          name="note"
          label="Note"
          maxLength={NOTE_MAX}
          rows={3}
          placeholder="Notes for the warehouse team"
        />
      </FormGridFull>
    </FormGrid>
  );
}
