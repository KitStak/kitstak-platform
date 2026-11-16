'use client';

/** Add New Connection drawer ("<Carrier> Carrier API Keys", spec 06 §7b): credentials, payor account, warehouse, Test/Production; Continue validates live in Production. */
import * as React from 'react';
import { z } from 'zod';
import { apiRequest, isApiError } from '@/lib/api-client';
import { useApiQuery } from '@/lib/query-client';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TextField } from '@/components/ui/text-field';
import { toast } from '@/components/ui/toast';
import { SettingYesNo as YesNoToggle } from '@/components/integrations/shared/form-controls';
import { useWarehouseOptions } from '@/components/integrations/shared/shared';
import type { CarrierConnectionDetail } from '@/server/repositories/carriers';

const catalogSchema = z.object({
  credentialFields: z.array(z.object({ key: z.string(), label: z.string(), secret: z.boolean() })),
  live: z.boolean(),
  services: z.array(z.unknown()),
});

function F({
  id,
  label,
  required,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly error?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`ac-${id.replace('.', '-')}`} className="text-xs font-medium text-body">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AddCarrierDrawer({
  open,
  onOpenChange,
  provider,
  providerName,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly provider: string;
  readonly providerName: string;
  readonly onCreated: (d: CarrierConnectionDetail) => void;
}) {
  const warehouses = useWarehouseOptions();
  const cat = useApiQuery<unknown>(['carrier-catalog', provider], open ? '/api/carriers/catalog' : null, {
    query: { provider },
    staleTime: 60_000,
  });
  const parsed = catalogSchema.safeParse(cat.data?.data);
  const fields = parsed.success ? parsed.data.credentialFields : [];
  const catalogLoading = open && cat.isPending;
  const [setupName, setSetupName] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState<string | null>(warehouses.defaultId);
  const [isTest, setIsTest] = React.useState(true);
  const [payor, setPayor] = React.useState('');
  const [creds, setCreds] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setSetupName('');
      setPayor('');
      setCreds({});
      setErrors({});
      setIsTest(true);
    }
  }, [open]);
  const needsPayor = provider === 'ups' || provider === 'fedex';
  const submit = async () => {
    const next: Record<string, string> = {};
    if (!setupName.trim()) next.setupName = 'Setup name is required';
    if (!warehouseId) next.warehouseId = 'Warehouse is required';
    if (needsPayor && !payor.trim()) next.payorAccountNumber = 'Payor account number is required';
    for (const f of fields)
      if (!creds[f.key]?.trim()) next[`credentials.${f.key}`] = `${f.label} is required`;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      document.getElementById(`ac-${first.replace('.', '-')}`)?.focus();
      return;
    }
    setPending(true);
    try {
      const { data } = await apiRequest<CarrierConnectionDetail>('/api/carriers', {
        method: 'POST',
        body: {
          provider,
          setupName: setupName.trim(),
          warehouseId,
          environment: isTest ? 'Test' : 'Production',
          payorAccountNumber: payor.trim() || undefined,
          credentials: creds,
        },
      });
      toast.success('Carrier connected', `${data.setupName} is ready with ${data.serviceCount} services.`);
      onCreated(data);
    } catch (error) {
      if (isApiError(error)) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(error.fieldErrors)) if (v[0]) fe[k] = v[0];
        setErrors(fe);
      }
      toast.error("Couldn't add the connection", isApiError(error) ? error.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      dirty={Boolean(setupName || payor || Object.values(creds).some(Boolean))}
      width={35}
      title={provider === 'kitstaks-sandbox' ? 'KitStak Sandbox carrier' : `${providerName} Carrier API Keys`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={pending || !parsed.success || !parsed.data.live}
            title={catalogLoading ? "Loading the carrier's API fields…" : undefined}
            onClick={() => void submit()}
          >
            {pending ? <Spinner className="h-3.5 w-3.5" /> : null}Continue
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {parsed.success && !parsed.data.live ? (
          <Callout variant="attention" title="No API adapter yet">
            {providerName} can’t be connected yet. Use the KitStak Sandbox carrier, UPS, FedEx, Stamps.com,
            EasyPost, Shippo or a Custom Carrier.
          </Callout>
        ) : null}
        {cat.isError ? (
          <Callout
            variant="attention"
            title="Couldn't load the carrier's API fields"
            action={
              <Button size="sm" onClick={() => void cat.refetch()}>
                Retry
              </Button>
            }
          >
            {cat.error.message}
          </Callout>
        ) : null}
        <F id="setupName" error={errors['setupName']} label="Setup name" required>
          <TextField
            id="ac-setupName"
            value={setupName}
            maxLength={60}
            placeholder={`e.g. ${providerName.toUpperCase()}-MLT1`}
            invalid={Boolean(errors.setupName)}
            onChange={(e) => setSetupName(e.target.value)}
          />
        </F>
        {catalogLoading ? (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading API fields">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null}
        {fields.map((f) => (
          <F
            key={f.key}
            id={`credentials.${f.key}`}
            error={errors[`credentials.${f.key}`]}
            label={f.label}
            required
          >
            <TextField
              id={`ac-credentials-${f.key}`}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={creds[f.key] ?? ''}
              invalid={Boolean(errors[`credentials.${f.key}`])}
              onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </F>
        ))}
        {provider !== 'kitstaks-sandbox' ? (
          <F
            id="payorAccountNumber"
            error={errors['payorAccountNumber']}
            label="Payor account number"
            required={needsPayor}
          >
            <TextField
              id="ac-payorAccountNumber"
              value={payor}
              maxLength={40}
              invalid={Boolean(errors.payorAccountNumber)}
              onChange={(e) => setPayor(e.target.value)}
            />
          </F>
        ) : null}
        <F id="warehouseId" error={errors['warehouseId']} label="Warehouse" required>
          <Select
            id="ac-warehouseId"
            value={warehouseId}
            options={warehouses.options}
            placeholder="Select warehouse"
            invalid={Boolean(errors.warehouseId)}
            onChange={setWarehouseId}
          />
        </F>
        {provider !== 'kitstaks-sandbox' ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-body">Test account</span>
            <YesNoToggle value={isTest} onChange={setIsTest} ariaLabel="Test account" />
            <p className="text-2xs text-faint">
              {isTest
                ? 'Test setups validate requests like the carrier and return sandbox rates and labels.'
                : 'Production calls the live carrier API; Continue checks the credentials first.'}
            </p>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
