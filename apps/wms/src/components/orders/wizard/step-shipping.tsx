'use client';

/**
 * Step 4 — Shipping: Carrier → Service (the warehouse's carrier connections) or a rate
 * shopping preset, Get rates (rate table to pick from — KitStaks addition), billing types,
 * custom account numbers, packing instructions, package, cost, tracking numbers, and the
 * Return section (BETA).
 */
import * as React from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Gauge, Truck } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useFormat } from '@/lib/format';
import { BILLING_PARTY_TYPES, EXPORT_REASONS } from '@/lib/enums';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormGrid, FormGridFull, FormSection } from '@/components/ui/form';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { DisabledReason } from '@/components/ui/tooltip';
import type { DraftRateQuote, DraftRatesResult } from '@/server/repositories/orders-wizard';
import { errorMessage } from '../orders-client';
import { AreaF, ChipsF, ComboF, NumF, SelectF, TextF, YesNoF } from './fields';
import {
  countryNameOf,
  orderTotals,
  PACKING_INSTRUCTIONS_MAX,
  type OrderFormValues,
} from './order-form-model';
import { useOrderWizard } from './order-wizard-context';

const BILLING_OPTIONS = BILLING_PARTY_TYPES.map((t) => ({ value: t, label: t }));
const EXPORT_OPTIONS = EXPORT_REASONS.map((t) => ({ value: t, label: t }));

function RatesDialog({
  open,
  onOpenChange,
  quotes,
  errors,
  labelOf,
  onPick,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly quotes: readonly DraftRateQuote[];
  readonly errors: DraftRatesResult['errors'];
  readonly labelOf: (connectionId: string) => string;
  readonly onPick: (q: DraftRateQuote) => void;
}) {
  const fmt = useFormat();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title="Rates"
          description="Live quotes from the warehouse's carrier connections, cheapest first. Pick one to use it for this order."
        />
        <DialogBody>
          {quotes.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No rates returned"
              description={
                errors[0]?.message ??
                'No carrier service quoted this shipment. Check the carrier setups for this warehouse.'
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
                  <tr>
                    <th className="px-3 py-2">Carrier</th>
                    <th className="px-3 py-2">Service</th>
                    <th className="px-3 py-2 text-right">Transit</th>
                    <th className="px-3 py-2 text-right">Rate</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q, i) => (
                    <tr key={`${q.carrierServiceId}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2">{labelOf(q.carrierConnectionId)}</td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {q.serviceName}
                        {i === 0 ? (
                          <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-2xs font-semibold text-success">
                            Best
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {q.transitDays} {q.transitDays === 1 ? 'day' : 'days'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {fmt.money(q.price)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant={i === 0 ? 'primary' : 'secondary'}
                          onClick={() => onPick(q)}
                        >
                          Use
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {errors.length > 0 && quotes.length > 0 ? (
            <p className="mt-2 text-xs text-secondary">
              {errors.length} carrier{errors.length === 1 ? '' : 's'} did not quote: {errors[0]?.message}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StepShipping() {
  const { mode, options, locks, detail } = useOrderWizard();
  const { control, setValue, getValues } = useFormContext<OrderFormValues>();
  const [connectionId, presetId, returnConnectionId, useCustomShip, useCustomTax, lines] = useWatch({
    control,
    name: [
      'carrierConnectionId',
      'rateShoppingPresetId',
      'returnCarrierConnectionId',
      'useCustomShippingAccount',
      'useCustomTaxAccount',
      'lines',
    ],
  });
  const [rates, setRates] = React.useState<DraftRatesResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const lock = Boolean(locks.header);
  const carriers = options?.carriers ?? [];
  const connection = carriers.find((c) => c.connectionId === connectionId);
  const returnConnection = carriers.find((c) => c.connectionId === returnConnectionId);
  const carrierOptions = carriers.map((c) => ({
    value: c.connectionId,
    label: c.label,
    description: c.carrierCode,
  }));
  const serviceOptions = (connection?.services ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    description: `${s.transitDays} day transit${s.isInternational ? ' · international' : ''}`,
  }));
  const returnServiceOptions = (returnConnection?.services ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const weightOz = orderTotals(lines ?? []).weightOz;
  const opts = { shouldDirty: true, shouldValidate: true } as const;

  /* Saved orders store only the return service; derive its carrier for the cascading select. */
  React.useEffect(() => {
    const serviceId = getValues('returnCarrierServiceId');
    if (!serviceId || getValues('returnCarrierConnectionId')) return;
    const owner = carriers.find((c) => c.services.some((s) => s.id === serviceId));
    if (owner) setValue('returnCarrierConnectionId', owner.connectionId);
  }, [carriers, getValues, setValue]);

  const getRates = async () => {
    const v = getValues();
    setLoading(true);
    try {
      const result =
        mode === 'edit' && detail
          ? await apiFetch<DraftRatesResult>('/api/ops/shipping/rates', {
              method: 'POST',
              body: {
                orderId: detail.order.id,
                presetId: v.rateShoppingPresetId,
                packages: [{ weightOz: Math.max(1, weightOz), length: 10, width: 8, height: 4 }],
              },
            })
          : await apiFetch<DraftRatesResult>('/api/orders/draft-rates', {
              method: 'POST',
              body: {
                warehouseId: v.warehouseId,
                clientId: v.clientId,
                presetId: v.rateShoppingPresetId,
                weightOz: Math.max(1, weightOz),
                to: {
                  name: `${v.customerFirstName} ${v.customerLastName}`.trim(),
                  company: v.companyName || null,
                  line1: v.shipAddress,
                  line2: v.shipAddress2 || null,
                  city: v.shipCity,
                  state: v.shipState || null,
                  postalCode: v.shipZip,
                  country: countryNameOf(v.shipCountry),
                },
              },
            });
      setRates({ quotes: result.quotes, errors: result.errors });
    } catch (error) {
      toast.error("Couldn't get rates", errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const ratesReason = lock
    ? locks.header
    : carriers.length === 0
      ? 'This warehouse has no active carrier connections'
      : (lines ?? []).length === 0
        ? 'Add products first so the package weight is known'
        : !getValues('shipAddress')
          ? 'Enter the ship-to address in Step 2 first'
          : null;

  return (
    <div className="flex flex-col gap-6">
      <FormSection
        title="Carrier and service"
        description={
          carriers.length === 0
            ? 'No carrier is set up for this warehouse yet. You can still save the order and choose a carrier later.'
            : 'Choose a service, or let a rate shopping preset pick the best one when the label is created.'
        }
        action={
          <DisabledReason reason={ratesReason}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void getRates()}
              disabled={loading || Boolean(ratesReason)}
            >
              {loading ? (
                <Spinner className="h-3.5 w-3.5" label="Getting rates" />
              ) : (
                <Gauge className="h-3.5 w-3.5" aria-hidden />
              )}
              Get rates
            </Button>
          </DisabledReason>
        }
      >
        <FormGrid columns={3}>
          <ComboF
            name="carrierConnectionId"
            label="Carrier"
            options={carrierOptions}
            clearable
            disabled={lock}
            emptyText="No carrier found for this warehouse"
            onValue={() => setValue('carrierServiceId', null, opts)}
          />
          <ComboF
            name="carrierServiceId"
            label="Shipping service"
            options={serviceOptions}
            clearable
            disabled={lock || !connectionId}
            description={!connectionId ? 'Choose a carrier first' : undefined}
            onValue={(v) => v && setValue('rateShoppingPresetId', null, opts)}
          />
          <SelectF
            name="rateShoppingPresetId"
            label="Rate shopping preset"
            options={(options?.presets ?? []).map((p) => ({
              value: p.value,
              label: p.label,
              description: p.description ?? undefined,
            }))}
            clearable
            disabled={lock || (options?.presets ?? []).length === 0}
            description={
              (options?.presets ?? []).length === 0
                ? 'No presets for this warehouse and client'
                : presetId
                  ? 'The cheapest matching service is chosen at label time'
                  : undefined
            }
            onValue={(v) => v && setValue('carrierServiceId', null, opts)}
          />
          <SelectF
            name="shippingChargesBillingType"
            label="Shipping charges billing type"
            options={BILLING_OPTIONS}
            clearable
            disabled={lock}
          />
          <SelectF
            name="taxDutiesBillingType"
            label="Tax & duties billing type"
            options={BILLING_OPTIONS}
            clearable
            disabled={lock}
          />
          <SelectF
            name="reasonForExport"
            label="Carrier reason for export"
            options={EXPORT_OPTIONS}
            clearable
            disabled={lock}
            info="Required by carriers for international shipments."
          />
          <div className="flex flex-col gap-2">
            <YesNoF name="useCustomShippingAccount" label="Use custom shipping account" disabled={lock} />
            {useCustomShip ? (
              <TextF
                name="shippingAccountNumber"
                label="Shipping charges account number"
                maxLength={100}
                disabled={lock}
              />
            ) : (
              <p className="text-xs text-secondary">
                Uses the account on the carrier setup{connection ? ` (${connection.label})` : ''}.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <YesNoF name="useCustomTaxAccount" label="Use custom tax & duties account" disabled={lock} />
            {useCustomTax ? (
              <TextF
                name="taxDutiesAccountNumber"
                label="Tax & duties account number"
                maxLength={100}
                disabled={lock}
              />
            ) : (
              <p className="text-xs text-secondary">Uses the account on the carrier setup.</p>
            )}
          </div>
        </FormGrid>
      </FormSection>

      <FormSection title="Package and tracking">
        <FormGrid columns={3}>
          <SelectF
            name="shipmentPackageId"
            label="Shipment package"
            options={(options?.shipmentPackages ?? []).map((p) => ({
              value: p.value,
              label: p.label,
              description: p.description ?? undefined,
            }))}
            clearable
            disabled={lock}
          />
          <NumF
            name="totalShippingCost"
            label="Total shipping cost"
            decimals={2}
            suffix="USD"
            disabled={lock}
          />
          <TextF name="trackingNumber" label="Current tracking number" maxLength={100} disabled={lock} />
          <FormGridFull>
            <ChipsF
              name="trackingNumbers"
              label="Tracking numbers"
              disabled={lock}
              description="Press Enter or comma to add each tracking number."
            />
          </FormGridFull>
          <FormGridFull>
            <AreaF
              name="packingInstructions"
              label="Packing instructions"
              maxLength={PACKING_INSTRUCTIONS_MAX}
              rows={3}
              disabled={lock}
              placeholder="Shown to the packer at the pack station"
            />
          </FormGridFull>
        </FormGrid>
      </FormSection>

      <FormSection
        title={
          <span className="flex items-center gap-2">
            Return{' '}
            <span className="rounded bg-primary-soft px-1.5 py-0.5 text-2xs font-semibold text-primary">
              Beta
            </span>
          </span>
        }
        description="Prefill how this order comes back if the customer returns it."
      >
        <FormGrid columns={3}>
          <SelectF
            name="returnAddressId"
            label="Return address name"
            options={(options?.returnAddresses ?? []).map((a) => ({
              value: a.value,
              label: a.label,
              description: a.description ?? undefined,
            }))}
            clearable
          />
          <ComboF
            name="returnCarrierConnectionId"
            label="Return carrier"
            options={carrierOptions}
            clearable
            onValue={() => setValue('returnCarrierServiceId', null, opts)}
          />
          <ComboF
            name="returnCarrierServiceId"
            label="Return shipping option"
            options={returnServiceOptions}
            clearable
            disabled={!returnConnectionId}
            description={!returnConnectionId ? 'Choose a return carrier first' : undefined}
          />
          <NumF name="returnShippingCost" label="Return shipping cost" decimals={2} suffix="USD" />
          <FormGridFull>
            <ChipsF
              name="returnTrackingNumbers"
              label="Return tracking numbers"
              placeholder="Enter and add return tracking number"
            />
          </FormGridFull>
        </FormGrid>
      </FormSection>

      <RatesDialog
        open={Boolean(rates)}
        onOpenChange={(o) => !o && setRates(null)}
        quotes={rates?.quotes ?? []}
        errors={rates?.errors ?? []}
        labelOf={(id) => carriers.find((c) => c.connectionId === id)?.label ?? 'Carrier'}
        onPick={(q) => {
          setValue('carrierConnectionId', q.carrierConnectionId, opts);
          setValue('carrierServiceId', q.carrierServiceId, opts);
          setValue('rateShoppingPresetId', null, opts);
          setValue('totalShippingCost', q.price, opts);
          setRates(null);
          toast.success('Service selected', `${q.serviceName} at ${q.price.toFixed(2)} USD.`);
        }}
      />
    </div>
  );
}
