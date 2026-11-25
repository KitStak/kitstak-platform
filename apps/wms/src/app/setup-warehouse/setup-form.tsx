'use client';

/**
 * The first screen of the WMS for a new organization (docs/billing/SPEC.md section 5.7: "4 fields,
 * no phone, no wall"). Only the warehouse name is needed, and it is already filled in, so one press
 * on "Create warehouse" is enough. The short code and the time zone are filled in too. The address
 * and the contact are optional and can be added later under Settings, Warehouse.
 *
 * Every field is checked here, in the browser, before anything is sent. The server checks again,
 * but an empty name or a bad phone number never becomes a failed request in the console.
 */
import * as React from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { errorTextClass, helpTextClass, labelClass } from '@/components/ui/control-styles';
import { Select } from '@/components/ui/select';
import { TextField } from '@/components/ui/text-field';
import { apiFetch, ApiError } from '@/lib/api-client';
import { normalizeState, phoneError, TIMEZONES, warehousePostalError } from '@/lib/grid-defs/facility/warehouses';
import { cn } from '@/lib/utils';

interface Offer {
  readonly orgId: string;
  readonly orgName: string;
}

type FieldKey = 'name' | 'code' | 'addressLine' | 'city' | 'state' | 'postalCode' | 'contactName' | 'contactPhone';

interface FieldDef {
  readonly key: FieldKey;
  readonly label: string;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly inputMode?: 'text' | 'tel';
  readonly wide?: boolean;
}

/** Optional. Asked here only as an offer: a new trial can leave all of it for later. */
const OPTIONAL_FIELDS: readonly FieldDef[] = [
  { key: 'addressLine', label: 'Street address', autoComplete: 'address-line1', wide: true },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'state', label: 'State', placeholder: 'TX', autoComplete: 'address-level1' },
  { key: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
  { key: 'contactName', label: 'Contact name', autoComplete: 'name' },
  { key: 'contactPhone', label: 'Contact phone', autoComplete: 'tel', inputMode: 'tel', wide: true },
];
const OPTIONAL_KEYS: ReadonlySet<string> = new Set(OPTIONAL_FIELDS.map((field) => field.key));
const COUNTRY = 'United States';

/** On a touch screen every field is 44 px tall with 16 px text, so iOS does not zoom the page. */
const TOUCH_FIELD = 'pointer-coarse:h-11 pointer-coarse:text-md';

/** A code suggestion from the org name: its letters/digits, upper case, at most 6 + "1". */
function suggestCode(orgName: string): string {
  const base = orgName.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  return base ? `${base}1` : 'MAIN1';
}

/** The browser's time zone when the WMS knows it, so most people never touch this field. */
function browserTimezone(): (typeof TIMEZONES)[number] | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (TIMEZONES as readonly string[]).includes(zone) ? (zone as (typeof TIMEZONES)[number]) : null;
  } catch {
    return null;
  }
}

/** The same rules the server applies, in plain words. Pure. */
export function checkSetup(values: Readonly<Record<FieldKey, string>>): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};
  if (values.name.trim() === '') errors.name = 'Enter a name for your warehouse.';
  const code = values.code.trim();
  if (code === '') errors.code = 'Enter a short code, like MAIN1.';
  else if (!/^[A-Za-z0-9_-]+$/.test(code)) errors.code = 'Use letters and numbers only, with no spaces.';
  else if (code.length > 20) errors.code = 'Use 20 characters or fewer.';
  if (values.state.trim() !== '' && normalizeState(COUNTRY, values.state) === null) errors.state = 'Use a US state, like TX or Texas.';
  if (values.postalCode.trim() !== '' && warehousePostalError(COUNTRY, values.postalCode)) errors.postalCode = 'Use a 5 digit ZIP code, like 75001.';
  const phone = phoneError(values.contactPhone);
  if (phone) errors.contactPhone = 'Use 7 to 15 digits, like +1 555 123 4567.';
  return errors;
}

export function SetupWarehouseForm({ offers }: { readonly offers: readonly Offer[] }) {
  const [orgId, setOrgId] = React.useState(offers[0]?.orgId ?? '');
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
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [errors, setErrors] = React.useState<Partial<Record<string, string>>>({});
  const [failure, setFailure] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement | null>(null);

  // The browser knows the time zone. Set after mount, so the server and the first paint agree.
  React.useEffect(() => {
    const zone = browserTimezone();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one time read of a browser only value
    if (zone) setTimezone(zone);
  }, []);

  const set = (key: FieldKey) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /** Shows the errors, opens the optional part when one of its fields is wrong, and moves focus there. */
  function showErrors(found: Partial<Record<string, string>>): void {
    setErrors(found);
    const first = (['name', 'code', ...OPTIONAL_FIELDS.map((field) => field.key)] as const).find((key) => found[key]);
    if (Object.keys(found).some((key) => OPTIONAL_KEYS.has(key))) setMoreOpen(true);
    if (first) window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>(`#setup-${first}`)?.focus());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    const found = checkSetup(values);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await apiFetch('/api/tenancy/warehouse', {
        method: 'POST',
        body: { orgId, warehouse: { ...values, country: COUNTRY, timezone } },
      });
      // A full navigation: the new warehouse is now the open one (org cookie).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/');
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        const fieldErrors = Object.fromEntries(
          Object.entries(error.fieldErrors ?? {}).map(([k, v]) => [k.replace(/^warehouse\./, ''), v?.[0] ?? '']),
        );
        if (Object.keys(fieldErrors).length > 0) showErrors(fieldErrors);
        else setFailure(error.message);
      } else {
        setFailure('Something went wrong. Please try again.');
      }
      setBusy(false);
    }
  }

  const field = (def: FieldDef, extra?: { readonly hint?: string; readonly required?: boolean }) => {
    const error = errors[def.key];
    const hintId = extra?.hint ? `setup-${def.key}-hint` : undefined;
    const errorId = error ? `setup-${def.key}-error` : undefined;
    return (
      <div key={def.key} className={def.wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
        <label className={labelClass} htmlFor={`setup-${def.key}`}>
          {def.label}
        </label>
        <TextField
          id={`setup-${def.key}`}
          name={def.key}
          size="lg"
          className={TOUCH_FIELD}
          value={values[def.key]}
          onChange={set(def.key)}
          placeholder={def.placeholder}
          autoComplete={def.autoComplete ?? 'off'}
          inputMode={def.inputMode}
          invalid={Boolean(error)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={errorId ?? hintId}
          aria-required={extra?.required || undefined}
          data-testid={`setup-${def.key}`}
        />
        {error ? (
          <p id={errorId} role="alert" className={errorTextClass}>
            {error}
          </p>
        ) : extra?.hint ? (
          <p id={hintId} className={helpTextClass}>
            {extra.hint}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form ref={formRef} className="mt-6 space-y-5" onSubmit={submit} noValidate data-testid="setup-form">
      {offers.length > 1 ? (
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="setup-org">
            Organization
          </label>
          <Select
            id="setup-org"
            size="lg"
            className={TOUCH_FIELD}
            value={orgId}
            onChange={(v) => v && setOrgId(v)}
            options={offers.map((o) => ({ value: o.orgId, label: o.orgName }))}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field({ key: 'name', label: 'Warehouse name', placeholder: 'Main warehouse', wide: true }, { required: true })}
        {field(
          { key: 'code', label: 'Short code', placeholder: 'MAIN1' },
          { required: true, hint: 'A short name for this warehouse. It starts your location and label codes, like MAIN1-RECV.' },
        )}
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="setup-timezone">
            Time zone
          </label>
          <Select
            id="setup-timezone"
            size="lg"
            className={TOUCH_FIELD}
            value={timezone}
            onChange={(v) => v && setTimezone(v)}
            options={TIMEZONES.map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }))}
            aria-describedby="setup-timezone-hint"
          />
          <p id="setup-timezone-hint" className={helpTextClass}>
            Used for shift times and reports.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle">
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="setup-more"
          data-testid="setup-more-toggle"
          onClick={() => setMoreOpen((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">Address and contact</span>
            <span className="block text-2xs leading-4 text-fg-muted">Optional. You can add these later in Settings, Warehouse.</span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-fg-muted transition-transform motion-reduce:transition-none', moreOpen && 'rotate-180')} aria-hidden />
        </button>
        <div id="setup-more" hidden={!moreOpen} className="grid grid-cols-1 gap-4 border-t border-border-subtle p-3.5 sm:grid-cols-2">
          {OPTIONAL_FIELDS.map((def) => field(def))}
        </div>
      </div>

      {failure ? (
        <Callout variant="error" title="Could not set up the warehouse">
          {failure}
        </Callout>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-fg-muted" aria-live="polite">
          {busy ? 'Setting up your warehouse. This takes a few seconds.' : 'You can change all of this later in Settings.'}
        </p>
        <Button type="submit" variant="primary" size="lg" disabled={busy || !orgId} className="shrink-0 pointer-coarse:h-11 max-sm:w-full" data-testid="setup-submit">
          {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {busy ? 'Setting up' : 'Create warehouse'}
        </Button>
      </div>
    </form>
  );
}
