'use client';

import * as React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { AlertTriangle, CheckCircle2, ImageIcon, Lock, RotateCw } from 'lucide-react';
import { apiFetch, isApiError } from '@/lib/api-client';
import { useCan } from '@/lib/permissions-client';
import { CURRENCIES, CURRENCY_LABELS, KIT_TYPES } from '@/lib/grid-defs/products/catalog-options';
import {
  BARCODE_MAX,
  DESCRIPTION_MAX,
  NAME_MAX,
  SKU_MAX,
  imageUrlError,
} from '@/lib/grid-defs/products/product-form';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { productImageSrc } from '../catalog-shared';
import { FieldLabel, FormField, FormGrid, FormGridFull } from '@/components/ui/form';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useProductWizard } from './context';
import { NumF, SelectF, TextF, YesNoF, opts } from './fields';

const SKU_CHECK_DELAY_MS = 350;

/** Give up waiting on check-sku after this; the server re-checks on save anyway. */
const SKU_CHECK_TIMEOUT_MS = 6000;

type SkuState = 'idle' | 'checking' | 'ok' | 'taken' | 'error';

/** Debounced per-client SKU uniqueness check; flags `_skuTaken` so Next is blocked inline. */
function useSkuCheck(): SkuState {
  const { mode, productId } = useProductWizard();
  const form = useFormContext();
  const clientId = useWatch({ name: 'clientId' }) as string;
  const sku = (useWatch({ name: 'sku' }) as string | undefined)?.trim() ?? '';
  const [state, setState] = React.useState<SkuState>('idle');
  const formRef = React.useRef(form);
  formRef.current = form;
  const defaults = form.formState.defaultValues as { sku?: string; clientId?: string } | undefined;
  const unchanged =
    mode === 'edit' && sku === (defaults?.sku ?? '').trim() && clientId === (defaults?.clientId ?? '');
  React.useEffect(() => {
    const form = formRef.current;
    if (!clientId || !sku || unchanged) {
      setState('idle');
      form.setValue('_skuTaken', false);
      return undefined;
    }
    setState('checking');
    const controller = new AbortController();
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      controller.abort();
      setState('error');
    }, SKU_CHECK_DELAY_MS + SKU_CHECK_TIMEOUT_MS);
    const timer = setTimeout(() => {
      apiFetch<{ available: boolean }>('/api/products/check-sku', {
        query: { clientId, sku, excludeId: mode === 'edit' ? (productId ?? undefined) : undefined },
        signal: controller.signal,
      })
        .then((r) => {
          clearTimeout(watchdog);
          setState(r.available ? 'ok' : 'taken');
          form.setValue('_skuTaken', !r.available);
          if (!r.available)
            form.setError('sku', { type: 'duplicate', message: `SKU ${sku} already exists for this client` });
          else if (form.getFieldState('sku').error?.type === 'duplicate') form.clearErrors('sku');
        })
        .catch(() => {
          clearTimeout(watchdog);
          if (!controller.signal.aborted || timedOut) setState('error');
        });
    }, SKU_CHECK_DELAY_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearTimeout(watchdog);
    };
  }, [clientId, sku, mode, productId, unchanged]);
  return state;
}

function SkuTrailing({ state }: { readonly state: SkuState }) {
  if (state === 'checking') return <Spinner className="h-3.5 w-3.5" label="Checking SKU" />;
  if (state === 'ok')
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-label="SKU is available" />;
  if (state === 'error')
    return (
      <span title="Couldn't check availability. The SKU is checked again when you save.">
        <AlertTriangle
          className="h-3.5 w-3.5 text-warning"
          aria-label="SKU availability could not be checked"
        />
      </span>
    );
  return null;
}

function LookupField({
  name,
  label,
  type,
}: {
  readonly name: 'productTypeId' | 'productGroupId';
  readonly label: string;
  readonly type: 'product_type' | 'product_group';
}) {
  const { options, refetchOptions } = useProductWizard();
  const clientId = useWatch({ name: 'clientId' }) as string;
  const canCreate = useCan('settings.data_setup.view').allowed;
  const list = name === 'productTypeId' ? options.productTypes : options.productGroups;
  const noun = label.toLowerCase();
  return (
    <FormField name={name} label={label} info={`${label}s are defined per client.`}>
      {(c) => (
        <Combobox
          id={c.id}
          value={(c.value as string | null) ?? null}
          onChange={(v) => c.onChange(v)}
          onBlur={c.onBlur}
          invalid={c.invalid}
          disabled={!clientId}
          clearable
          placeholder={clientId ? `Select ${noun}` : 'Select a client first'}
          emptyText={`No ${noun} found.`}
          options={list.map((o) => ({ value: o.value, label: o.label }))}
          creatable={canCreate && Boolean(clientId)}
          onCreate={async (input) => {
            try {
              const row = await apiFetch<{ id: string; name: string }>(`/api/lookups/${type}`, {
                method: 'POST',
                body: { name: input, clientId },
              });
              refetchOptions();
              toast.success('Created', `${label} "${row.name}" was added for this client.`);
              return { value: row.id, label: row.name };
            } catch (error) {
              toast.error(
                'Could not create',
                isApiError(error) ? error.message : `The ${noun} could not be created.`,
              );
              throw error;
            }
          }}
          aria-label={label}
        />
      )}
    </FormField>
  );
}

type PreviewState = 'loading' | 'ok' | 'failed';

/** Live preview of the image URL (through the same-origin image proxy) + its load status. */
function ImagePreview({ onState }: { readonly onState: (s: PreviewState | null) => void }) {
  const url = (useWatch({ name: 'imageUrl' }) as string | undefined)?.trim() ?? '';
  const valid = /^https?:\/\/\S+$/i.test(url);
  const src = valid ? productImageSrc(url) : null;
  const [state, setState] = React.useState<{ src: string | null; s: PreviewState }>({
    src: null,
    s: 'loading',
  });
  const current: PreviewState | null = src ? (state.src === src ? state.s : 'loading') : null;
  React.useEffect(() => onState(current), [current, onState]);
  return (
    <span
      className="relative flex h-[66px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-sunken"
      aria-label="Image preview"
    >
      {src && current !== 'failed' ? (
        // eslint-disable-next-line @next/next/no-img-element -- product images come from arbitrary CDNs (proxied same-origin)
        <img
          key={src}
          src={src}
          alt=""
          width={66}
          height={66}
          className="h-full w-full object-cover"
          onLoad={() => setState({ src, s: 'ok' })}
          onError={() => setState({ src, s: 'failed' })}
        />
      ) : (
        <ImageIcon className="h-5 w-5 text-faint" aria-hidden />
      )}
      {current === 'loading' ? (
        <span className="absolute inset-0 flex items-center justify-center bg-surface/60">
          <Spinner className="h-4 w-4" label="Loading preview" />
        </span>
      ) : null}
    </span>
  );
}

function ImageField() {
  const [state, setState] = React.useState<PreviewState | null>(null);
  const [blurred, setBlurred] = React.useState(false);
  const url = useWatch({ name: 'imageUrl' }) as string | null | undefined;
  const { formState } = useFormContext();
  const blurError = blurred && !formState.errors.imageUrl ? imageUrlError(url) : null;
  const description = blurError ? (
    <span role="alert" className="text-danger">
      {blurError}
    </span>
  ) : state === 'failed' ? (
    <span className="text-warning">
      This URL didn&apos;t return an image (JPEG, PNG, GIF, WebP or AVIF). You can still save it.
    </span>
  ) : state === 'loading' ? (
    'Loading preview…'
  ) : state === 'ok' ? (
    'Preview loaded'
  ) : (
    'Paste a public https:// image URL, e.g. from Shopify or Amazon.'
  );
  return (
    <div className="flex items-start gap-3">
      <ImagePreview onState={setState} />
      <TextF
        name="imageUrl"
        label="Product image"
        placeholder="Paste URL address of the image to add"
        className={blurError ? 'min-w-0 flex-1 [&_input]:border-danger' : 'min-w-0 flex-1'}
        description={description}
        onBlurExtra={() => setBlurred(true)}
      />
    </div>
  );
}

/**
 * Client picker: a searchable Combobox (opens on click, type-to-filter, keyboard), the trigger
 * shows the selected client's name, plus loading / error + Retry states.
 */
function ClientField({ onValue }: { readonly onValue: () => void }) {
  const { options, optionsLoading, optionsError, refetchOptions, clientName } = useProductWizard();
  const selectedId = (useWatch({ name: 'clientId' }) as string | null | undefined) || null;
  const loaded = options.clients.map((c) => ({ value: c.value, label: c.label, description: c.description }));
  // A known selected client (edit / deep link) renders by name while the list loads.
  const list =
    selectedId && clientName && !loaded.some((o) => o.value === selectedId)
      ? [...loaded, { value: selectedId, label: clientName, description: undefined }]
      : loaded;
  const waiting = optionsLoading && !loaded.length && !(selectedId && clientName);
  return (
    <div className="flex flex-col gap-1">
      <FormField
        name="clientId"
        label="Client"
        required
        description={
          waiting && !selectedId ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="h-3 w-3" label="Loading clients" />
              Loading clients…
            </span>
          ) : undefined
        }
      >
        {(c) => (
          <Combobox
            id={c.id}
            value={(c.value as string | null) || null}
            onChange={(v) => {
              c.onChange(v ?? '');
              onValue();
            }}
            onBlur={c.onBlur}
            invalid={c.invalid}
            aria-describedby={c['aria-describedby']}
            placeholder={
              waiting
                ? 'Loading clients…'
                : optionsError && !list.length
                  ? 'Clients could not be loaded'
                  : 'Select client'
            }
            emptyText={optionsLoading ? 'Loading clients…' : 'No client found.'}
            options={list}
            selectedOptions={list.filter((o) => o.value === c.value)}
            aria-label="Client"
          />
        )}
      </FormField>
      {optionsError ? (
        <p role="alert" className="flex items-center gap-2 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Could not load clients and lookups.
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={refetchOptions}>
            <RotateCw className="h-3 w-3" aria-hidden />
            Retry
          </Button>
        </p>
      ) : null}
    </div>
  );
}

export function StepGeneral() {
  const { category, mode, clientName, options } = useProductWizard();
  const form = useFormContext();
  const currency = (useWatch({ name: 'currency' }) as string) || 'USD';
  const kitType = useWatch({ name: 'kitType' }) as string | null;
  const skuState = useSkuCheck();
  const isPackaging = category === 'Packaging Material';
  const showBarcode = category !== 'Product';

  return (
    <FormGrid columns={2}>
      {category === 'Kit' ? (
        <FormGridFull>
          <div className="flex flex-col gap-1.5">
            <FieldLabel required>Kit type</FieldLabel>
            <SegmentedControl
              ariaLabel="Kit type"
              value={(kitType ?? 'Kit to Order') as (typeof KIT_TYPES)[number]}
              onChange={(v) => form.setValue('kitType', v, { shouldDirty: true })}
              options={KIT_TYPES.map((k) => ({ value: k, label: k }))}
            />
            <p className="text-xs text-secondary">
              {kitType === 'Kit to Stock'
                ? 'Assembled ahead of demand through work orders and stocked as its own SKU.'
                : 'Assembled per order from its components at pick time.'}
            </p>
          </div>
        </FormGridFull>
      ) : null}
      {mode === 'edit' ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Client</FieldLabel>
          <div
            className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 text-sm text-body"
            title="The client cannot be changed after creation"
          >
            <Lock className="h-3.5 w-3.5 text-faint" aria-hidden />
            {clientName}
          </div>
        </div>
      ) : (
        <ClientField
          onValue={() => {
            form.setValue('productTypeId', null);
            form.setValue('productGroupId', null);
            form.setValue('components', []);
            form.setValue('channelAllocations', []);
          }}
        />
      )}
      <TextF
        name="sku"
        label="SKU (stock keeping unit)"
        required
        maxLength={SKU_MAX}
        showCount={false}
        placeholder="Enter SKU"
        trailing={<SkuTrailing state={skuState} />}
        description={
          skuState === 'error' ? (
            <span className="text-warning">
              Couldn&apos;t check availability. The SKU is checked again when you save.
            </span>
          ) : undefined
        }
        info="Unique per client. The same SKU can exist under another client."
      />
      <FormGridFull>
        <TextF name="name" label="Name" required maxLength={NAME_MAX} placeholder="Enter name" />
      </FormGridFull>
      <FormGridFull>
        <TextF
          name="description"
          label="Description"
          maxLength={DESCRIPTION_MAX}
          placeholder="Enter description"
        />
      </FormGridFull>
      <FormGridFull>
        <ImageField />
      </FormGridFull>
      {showBarcode ? (
        <TextF
          name="barcode"
          label="Product barcode"
          maxLength={BARCODE_MAX}
          placeholder="Enter product barcode"
          description="Optional. Left blank, no barcode is stored (labels print the SKU). Must be unique per client."
        />
      ) : null}
      {showBarcode ? (
        <SelectF
          name="uom"
          label="UOM pack type"
          required
          options={options.packTypes.map((o) => ({ value: o.value, label: o.label }))}
        />
      ) : null}
      <LookupField name="productTypeId" label="Product type" type="product_type" />
      <LookupField name="productGroupId" label="Product group" type="product_group" />
      <SelectF name="currency" label="Currency" options={opts(CURRENCIES, CURRENCY_LABELS)} />
      <NumF name="purchasePrice" label="Purchase price" decimals={2} suffix={currency} unclamped />
      {isPackaging ? null : (
        <NumF name="salesPrice" label="Sales price" decimals={2} suffix={currency} unclamped />
      )}
      {isPackaging ? null : (
        <NumF
          name="taxRate"
          label="Tax rate"
          decimals={2}
          suffix="%"
          max={100}
          rangeText="Tax rate must be 0–100%"
          unclamped
        />
      )}
      <NumF
        name="minSafetyStock"
        label="Minimum safety stock"
        info="Replenishment and low-stock alerts trigger below this quantity."
      />
      <TextF
        name="fnsku"
        label="FNSKU"
        maxLength={BARCODE_MAX}
        placeholder="Amazon fulfillment network SKU"
      />
      <YesNoF name="isActive" label="Active?" />
      {isPackaging ? null : (
        <YesNoF name="isDigital" label="Digital?" info="Digital products are never picked or packed." />
      )}
    </FormGrid>
  );
}
