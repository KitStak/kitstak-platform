'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { errorTextClass, labelClass } from '@/components/ui/control-styles';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { apiFetch, ApiError } from '@/lib/api-client';
import { TIMEZONES } from '@/lib/grid-defs/facility/warehouses';

interface Offer {
  readonly orgId: string;
  readonly orgName: string;
}

type FieldKey =
  | 'name'
  | 'code'
  | 'addressLine'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'contactName'
  | 'contactPhone';

const FIELDS: readonly { key: FieldKey; label: string; placeholder?: string; autoComplete?: string; wide?: boolean }[] = [
  { key: 'name', label: 'Warehouse name', placeholder: 'Main warehouse', wide: true },
  { key: 'code', label: 'Short code', placeholder: 'MAIN1' },
  { key: 'contactName', label: 'Contact name', autoComplete: 'name' },
  { key: 'addressLine', label: 'Street address', autoComplete: 'address-line1', wide: true },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'state', label: 'State', placeholder: 'TX', autoComplete: 'address-level1' },
  { key: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
  { key: 'contactPhone', label: 'Contact phone', autoComplete: 'tel' },
];

/** A code suggestion from the org name: its letters/digits, upper case, at most 6 + "1". */
function suggestCode(orgName: string): string {
  const base = orgName.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  return base ? `${base}1` : '';
}

export function SetupWarehouseForm({ offers }: { readonly offers: readonly Offer[] }) {
  const [orgId, setOrgId] = React.useState(offers[0]?.orgId ?? '');
  const orgName = offers.find((o) => o.orgId === orgId)?.orgName ?? '';
  const [values, setValues] = React.useState<Record<FieldKey, string>>(() => ({
    name: offers[0] ? `${offers[0].orgName} warehouse` : '',
    code: suggestCode(offers[0]?.orgName ?? ''),
    addressLine: '',
    city: '',
    state: '',
    postalCode: '',
    contactName: '',
    contactPhone: '',
  }));
  const [timezone, setTimezone] = React.useState<string>('America/Chicago');
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const set = (key: FieldKey) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [key]: event.target.value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    setErrors({});
    try {
      await apiFetch('/api/tenancy/warehouse', {
        method: 'POST',
        body: { orgId, warehouse: { ...values, country: 'United States', timezone } },
      });
      // A full navigation: the new warehouse is now the open one (org cookie).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/');
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        const fieldErrors = Object.fromEntries(
          Object.entries(error.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^warehouse\./, ''), v?.[0] ?? '']),
        );
        setErrors(fieldErrors);
        setFailure(Object.keys(fieldErrors).length > 0 ? 'Check the highlighted fields.' : error.message);
      } else {
        setFailure('Something went wrong. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={submit} noValidate>
      {offers.length > 1 ? (
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="setup-org">
            Organization
          </label>
          <Select
            id="setup-org"
            value={orgId}
            onChange={(v) => v && setOrgId(v)}
            options={offers.map((o) => ({ value: o.orgId, label: o.orgName }))}
          />
        </div>
      ) : (
        <p className="text-sm">
          Organization: <span className="font-medium">{orgName}</span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
            <label className={labelClass} htmlFor={`setup-${f.key}`}>
              {f.label}
            </label>
            <TextField
              id={`setup-${f.key}`}
              name={f.key}
              value={values[f.key]}
              onChange={set(f.key)}
              placeholder={f.placeholder}
              autoComplete={f.autoComplete}
              invalid={Boolean(errors[f.key])}
              aria-invalid={Boolean(errors[f.key]) || undefined}
              aria-describedby={errors[f.key] ? `setup-${f.key}-error` : undefined}
              required
            />
            {errors[f.key] ? (
              <p id={`setup-${f.key}-error`} className={errorTextClass}>
                {errors[f.key]}
              </p>
            ) : null}
          </div>
        ))}
        <div className="space-y-1.5 sm:col-span-2">
          <label className={labelClass} htmlFor="setup-timezone">
            Time zone
          </label>
          <Select
            id="setup-timezone"
            value={timezone}
            onChange={(v) => v && setTimezone(v)}
            options={TIMEZONES.map((tz) => ({ value: tz, label: tz.replace('_', ' ') }))}
          />
        </div>
      </div>

      {failure ? (
        <Callout variant="error" title="Could not set up the warehouse">
          {failure}
        </Callout>
      ) : null}

      <div className="flex items-center justify-end gap-3 border-t pt-5">
        <Button type="submit" variant="primary" disabled={busy || !orgId}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Setting up…' : 'Create warehouse'}
        </Button>
      </div>
    </form>
  );
}
