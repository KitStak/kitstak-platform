'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert } from 'lucide-react';
import type { BillingProfile } from '@kitstak/billing/server';
import { Button, Field, Input, LinkButton, Select } from '@/components/ui';
import { updateBillingDetailsAction } from '@/features/billing/actions';
import { TAX_ID_TYPES, type CountryOption } from './countries';

export interface DetailsFormProps {
  readonly profile: BillingProfile;
  readonly orgName: string;
  readonly countries: readonly CountryOption[];
  readonly canEdit: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Billing contact, address and tax ID (SPEC 6.7). Saved values show on the next invoice. */
export function DetailsForm({ profile, orgName, countries, canEdit }: DetailsFormProps) {
  const router = useRouter();
  const [values, setValues] = useState({
    companyName: profile.companyName ?? '',
    billingEmail: profile.billingEmail ?? '',
    line1: profile.address.line1 ?? '',
    line2: profile.address.line2 ?? '',
    city: profile.address.city ?? '',
    state: profile.address.state ?? '',
    postalCode: profile.address.postalCode ?? '',
    country: profile.address.country ?? '',
    taxIdType: profile.taxIdType ?? '',
    taxIdValue: profile.taxIdValue ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<'billingEmail' | 'taxIdType' | 'taxIdValue', string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setFormError(null);
  };
  const taxExample = TAX_ID_TYPES.find((type) => type.value === values.taxIdType)?.example;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !canEdit) return;
    const next: typeof errors = {};
    const email = values.billingEmail.trim();
    if (email !== '' && !EMAIL_RE.test(email)) next.billingEmail = 'Enter a valid billing email.';
    if (values.taxIdType !== '' && values.taxIdValue.trim() === '') next.taxIdValue = 'Enter the tax ID number, or set the type to None.';
    if (values.taxIdType === '' && values.taxIdValue.trim() !== '') next.taxIdType = 'Pick the tax ID type.';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const firstKey = Object.keys(next)[0];
      document.querySelector<HTMLElement>(`[data-field="${firstKey}"]`)?.focus();
      return;
    }
    setPending(true);
    setFormError(null);
    try {
      const result = await updateBillingDetailsAction({
        billingEmail: email === '' ? null : email,
        companyName: values.companyName.trim() === '' ? null : values.companyName.trim(),
        address: {
          line1: values.line1.trim() || undefined,
          line2: values.line2.trim() || undefined,
          city: values.city.trim() || undefined,
          state: values.state.trim() || undefined,
          postalCode: values.postalCode.trim() || undefined,
          country: values.country || undefined,
        },
        taxIdType: values.taxIdType === '' ? null : values.taxIdType,
        taxIdValue: values.taxIdValue.trim() === '' ? null : values.taxIdValue.trim(),
      });
      if (result.ok) {
        router.push('/billing?notice=details_saved');
        return;
      }
      setFormError(result.error.message);
    } catch {
      setFormError('We could not reach KitStak. Check your connection and try again.');
    }
    setPending(false);
  };

  return (
    <form noValidate data-testid="details-form" onSubmit={onSubmit} className="flex flex-col gap-8">
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <legend className="mb-4 text-base font-semibold text-fg">Who we bill</legend>
        <Field label="Company name" hint={`Shown on your invoices. Leave empty to use ${orgName}.`}>
          {({ inputId, describedBy }) => (
            <Input id={inputId} size="lg" value={values.companyName} onChange={set('companyName')} autoComplete="organization" maxLength={120} placeholder={orgName} aria-describedby={describedBy} />
          )}
        </Field>
        <Field label="Billing email" error={errors.billingEmail} hint="Receipts go here, and to owners and billing managers.">
          {({ inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              size="lg"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              data-field="billingEmail"
              value={values.billingEmail}
              onChange={set('billingEmail')}
              maxLength={254}
              placeholder="billing@company.com"
              aria-describedby={describedBy}
              invalid={invalid}
            />
          )}
        </Field>
      </fieldset>

      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <legend className="mb-4 text-base font-semibold text-fg">Billing address</legend>
        <Field label="Address line 1">
          {({ inputId }) => <Input id={inputId} size="lg" value={values.line1} onChange={set('line1')} autoComplete="address-line1" maxLength={120} />}
        </Field>
        <Field label="Address line 2">
          {({ inputId }) => <Input id={inputId} size="lg" value={values.line2} onChange={set('line2')} autoComplete="address-line2" maxLength={120} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City">
            {({ inputId }) => <Input id={inputId} size="lg" value={values.city} onChange={set('city')} autoComplete="address-level2" maxLength={120} />}
          </Field>
          <Field label="State or region">
            {({ inputId }) => <Input id={inputId} size="lg" value={values.state} onChange={set('state')} autoComplete="address-level1" maxLength={120} />}
          </Field>
          <Field label="ZIP or postal code">
            {({ inputId }) => <Input id={inputId} size="lg" value={values.postalCode} onChange={set('postalCode')} autoComplete="postal-code" maxLength={20} />}
          </Field>
        </div>
        <Field label="Country">
          {({ inputId }) => (
            <Select id={inputId} size="lg" value={values.country} onChange={set('country')} autoComplete="country">
              <option value="">Pick a country</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </fieldset>

      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <legend className="mb-4 text-base font-semibold text-fg">Tax ID</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" error={errors.taxIdType} hint="Only if your business has one.">
            {({ inputId, describedBy, invalid }) => (
              <Select id={inputId} size="lg" data-field="taxIdType" value={values.taxIdType} onChange={set('taxIdType')} aria-describedby={describedBy} invalid={invalid}>
                <option value="">None</option>
                {TAX_ID_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Number" error={errors.taxIdValue} hint={taxExample ? `It looks like ${taxExample}.` : 'Shown on your invoices.'}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                size="lg"
                data-field="taxIdValue"
                value={values.taxIdValue}
                onChange={set('taxIdValue')}
                maxLength={40}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
        </div>
      </fieldset>

      {formError ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger-text">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {formError}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-5 sm:flex-row sm:justify-end">
          <LinkButton href="/billing" variant="secondary" size="xl">
            Cancel
          </LinkButton>
          <Button type="submit" size="xl" data-testid="details-save" loading={pending}>
            Save details
          </Button>
        </div>
      ) : null}
    </form>
  );
}
