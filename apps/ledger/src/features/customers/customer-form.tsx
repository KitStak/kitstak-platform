'use client';
/** Add or edit a customer: the shared code and name, and Ledger's invoice settings (SPEC 5.2). */
import { Plus } from 'lucide-react';
import { createCustomerAction, updateCustomerAction } from '@/server/actions/parties';
import { FormDialog, bool, idOrNull, outcomeOf, str, type FormField, type FormOption, type FormValues } from '@/features/setup/form-dialog';

export interface CustomerFormValues {
  readonly id: string;
  readonly version: number;
  readonly code: string;
  readonly name: string;
  readonly phone: string | null;
  readonly billingContactName: string | null;
  readonly billingEmails: readonly string[];
  readonly billingAddress: { readonly line1?: string; readonly city?: string; readonly region?: string; readonly postalCode?: string; readonly country?: string } | null;
  readonly termsId: string | null;
  readonly defaultTaxRateId: string | null;
  readonly taxExempt: boolean;
  readonly exemptionNote: string | null;
  readonly remindersEnabled: boolean;
  readonly notes: string | null;
}

function fields(terms: readonly FormOption[], rates: readonly FormOption[], editing: boolean): FormField[] {
  return [
    { kind: 'text', name: 'code', label: 'Customer code', required: true, disabled: editing, hint: editing ? 'Other KitStak apps use this code, so it stays.' : 'A short code, like HRB. Other KitStak apps use it too.' },
    { kind: 'text', name: 'name', label: 'Name', required: true },
    { kind: 'text', name: 'billingEmails', label: 'Invoice emails', inputMode: 'email', hint: 'Invoices and reminders go here. Split several with commas.' },
    { kind: 'text', name: 'billingContactName', label: 'Invoice contact' },
    { kind: 'text', name: 'phone', label: 'Phone', inputMode: 'tel' },
    { kind: 'select', name: 'termsId', label: 'Terms', options: terms, emptyLabel: 'Workspace default' },
    { kind: 'heading', name: 'h-address', label: 'Address on invoices' },
    { kind: 'text', name: 'line1', label: 'Street' },
    { kind: 'text', name: 'city', label: 'City' },
    { kind: 'text', name: 'region', label: 'State' },
    { kind: 'text', name: 'postalCode', label: 'Postal code' },
    { kind: 'text', name: 'country', label: 'Country' },
    { kind: 'heading', name: 'h-tax', label: 'Tax and reminders' },
    { kind: 'select', name: 'defaultTaxRateId', label: 'Default tax rate', options: rates, emptyLabel: 'No tax' },
    { kind: 'switch', name: 'taxExempt', label: 'Tax exempt', hint: 'No sales tax is added to their invoices.' },
    { kind: 'text', name: 'exemptionNote', label: 'Exemption note', hint: 'For example the certificate number.' },
    { kind: 'switch', name: 'remindersEnabled', label: 'Send payment reminders' },
    { kind: 'textarea', name: 'notes', label: 'Notes' },
  ];
}

function initialOf(customer: CustomerFormValues | null): FormValues {
  return {
    code: customer?.code ?? '',
    name: customer?.name ?? '',
    billingEmails: customer?.billingEmails.join(', ') ?? '',
    billingContactName: customer?.billingContactName ?? '',
    phone: customer?.phone ?? '',
    termsId: customer?.termsId ?? '',
    line1: customer?.billingAddress?.line1 ?? '',
    city: customer?.billingAddress?.city ?? '',
    region: customer?.billingAddress?.region ?? '',
    postalCode: customer?.billingAddress?.postalCode ?? '',
    country: customer?.billingAddress?.country ?? '',
    defaultTaxRateId: customer?.defaultTaxRateId ?? '',
    taxExempt: customer?.taxExempt ?? false,
    exemptionNote: customer?.exemptionNote ?? '',
    remindersEnabled: customer?.remindersEnabled ?? true,
    notes: customer?.notes ?? '',
  };
}

function inputOf(values: FormValues) {
  return {
    code: str(values, 'code'),
    name: str(values, 'name'),
    phone: str(values, 'phone') || null,
    billingContactName: str(values, 'billingContactName') || null,
    billingEmails: str(values, 'billingEmails')
      .split(/[\s,;]+/)
      .map((email) => email.trim())
      .filter(Boolean),
    billingAddress: { line1: str(values, 'line1'), city: str(values, 'city'), region: str(values, 'region'), postalCode: str(values, 'postalCode'), country: str(values, 'country') },
    termsId: idOrNull(values, 'termsId'),
    defaultTaxRateId: idOrNull(values, 'defaultTaxRateId'),
    taxExempt: bool(values, 'taxExempt'),
    exemptionNote: str(values, 'exemptionNote') || null,
    remindersEnabled: bool(values, 'remindersEnabled'),
    notes: str(values, 'notes') || null,
  };
}

export function CustomerForm({ customer, terms, rates }: { readonly customer: CustomerFormValues | null; readonly terms: readonly FormOption[]; readonly rates: readonly FormOption[] }) {
  return (
    <FormDialog
      title={customer ? `Edit ${customer.name}` : 'Add a customer'}
      description={customer ? undefined : 'The customer joins your KitStak customer list, so the warehouse and CRM see it too.'}
      triggerLabel={customer ? 'Edit' : 'Add a customer'}
      triggerVariant={customer ? 'secondary' : 'primary'}
      triggerIcon={customer ? undefined : <Plus aria-hidden className="size-4" />}
      submitLabel={customer ? 'Save' : 'Add customer'}
      successMessage={customer ? 'Customer saved' : 'Customer added'}
      fields={fields(terms, rates, Boolean(customer))}
      initial={initialOf(customer)}
      testId="customer-form"
      onSubmit={async (values) => {
        const input = inputOf(values);
        if (!customer) return outcomeOf(await createCustomerAction(input));
        return outcomeOf(await updateCustomerAction({ ...input, code: customer.code, id: customer.id, version: customer.version }));
      }}
    />
  );
}
