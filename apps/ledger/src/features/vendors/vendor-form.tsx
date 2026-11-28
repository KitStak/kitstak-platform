'use client';
/**
 * Add or edit a vendor (SPEC 5.1, 5.2). Kinds are shared with Crew and the warehouse: a kind
 * another app added is marked, and removing one asks for a second yes.
 */
import { Plus } from 'lucide-react';
import { createVendorAction, setVendorArchivedAction, updateVendorAction } from '@/server/actions/parties';
import { ArchiveButton } from '@/features/setup/archive-button';
import { FormDialog, bool, idOrNull, list, outcomeOf, str, type FormField, type FormOption, type FormValues } from '@/features/setup/form-dialog';
import { VENDOR_KINDS, VENDOR_KIND_LABELS, isVendorKind, type VendorKind } from '@/lib/vendor-kinds';

export interface VendorFormValues {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly kinds: readonly VendorKind[];
  readonly ledgerKinds: readonly VendorKind[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: { readonly line1?: string; readonly city?: string; readonly region?: string; readonly postalCode?: string; readonly country?: string } | null;
  readonly notes: string | null;
  readonly termsId: string | null;
  readonly defaultAccountId: string | null;
  readonly tracks1099: boolean;
  readonly w9OnFile: boolean;
}

function fields(vendor: VendorFormValues | null, terms: readonly FormOption[], accounts: readonly FormOption[]): FormField[] {
  return [
    { kind: 'text', name: 'name', label: 'Name', required: true },
    { kind: 'text', name: 'email', label: 'Email', inputMode: 'email' },
    {
      kind: 'checks',
      name: 'kinds',
      label: 'What they are to you',
      hint: 'One company can be several kinds. Crew lists temp agencies.',
      options: VENDOR_KINDS.map((kind) => ({
        value: kind,
        label: VENDOR_KIND_LABELS[kind],
        note: vendor && vendor.kinds.includes(kind) && !vendor.ledgerKinds.includes(kind) ? 'Added in another app' : undefined,
      })),
    },
    { kind: 'text', name: 'phone', label: 'Phone', inputMode: 'tel' },
    { kind: 'select', name: 'termsId', label: 'Terms', options: terms, emptyLabel: 'Workspace default' },
    { kind: 'select', name: 'defaultAccountId', label: 'Default account for their bills', options: accounts, emptyLabel: 'Pick on each bill' },
    { kind: 'heading', name: 'h-address', label: 'Address' },
    { kind: 'text', name: 'line1', label: 'Street' },
    { kind: 'text', name: 'city', label: 'City' },
    { kind: 'text', name: 'region', label: 'State' },
    { kind: 'text', name: 'postalCode', label: 'Postal code' },
    { kind: 'text', name: 'country', label: 'Country' },
    { kind: 'heading', name: 'h-1099', label: 'Year end' },
    { kind: 'switch', name: 'tracks1099', label: 'Track payments for 1099', hint: 'Payments to this vendor show on the 1099 totals report.' },
    { kind: 'switch', name: 'w9OnFile', label: 'W 9 on file', hint: 'Ledger keeps no tax id, only that you have the form.' },
    { kind: 'textarea', name: 'notes', label: 'Notes' },
  ];
}

function initialOf(vendor: VendorFormValues | null): FormValues {
  return {
    name: vendor?.name ?? '',
    email: vendor?.email ?? '',
    kinds: vendor?.kinds ?? [],
    phone: vendor?.phone ?? '',
    termsId: vendor?.termsId ?? '',
    defaultAccountId: vendor?.defaultAccountId ?? '',
    line1: vendor?.address?.line1 ?? '',
    city: vendor?.address?.city ?? '',
    region: vendor?.address?.region ?? '',
    postalCode: vendor?.address?.postalCode ?? '',
    country: vendor?.address?.country ?? '',
    tracks1099: vendor?.tracks1099 ?? false,
    w9OnFile: vendor?.w9OnFile ?? false,
    notes: vendor?.notes ?? '',
  };
}

function inputOf(values: FormValues) {
  return {
    name: str(values, 'name'),
    kinds: list(values, 'kinds').filter(isVendorKind),
    email: str(values, 'email') || null,
    phone: str(values, 'phone') || null,
    address: { line1: str(values, 'line1'), city: str(values, 'city'), region: str(values, 'region'), postalCode: str(values, 'postalCode'), country: str(values, 'country') },
    notes: str(values, 'notes') || null,
    termsId: idOrNull(values, 'termsId'),
    defaultAccountId: idOrNull(values, 'defaultAccountId'),
    tracks1099: bool(values, 'tracks1099'),
    w9OnFile: bool(values, 'w9OnFile'),
  };
}

export function VendorForm({ vendor, terms, accounts }: { readonly vendor: VendorFormValues | null; readonly terms: readonly FormOption[]; readonly accounts: readonly FormOption[] }) {
  return (
    <FormDialog
      title={vendor ? `Edit ${vendor.name}` : 'Add a vendor'}
      description={vendor ? undefined : 'Vendors are shared with Crew and later the warehouse, so a vendor added once shows everywhere.'}
      triggerLabel={vendor ? 'Edit' : 'Add a vendor'}
      triggerVariant={vendor ? 'secondary' : 'primary'}
      triggerIcon={vendor ? undefined : <Plus aria-hidden className="size-4" />}
      submitLabel={vendor ? 'Save' : 'Add vendor'}
      successMessage={vendor ? 'Vendor saved' : 'Vendor added'}
      fields={fields(vendor, terms, accounts)}
      initial={initialOf(vendor)}
      testId="vendor-form"
      onSubmit={async (values, { confirmed }) => {
        const input = inputOf(values);
        if (!vendor) return outcomeOf(await createVendorAction(input));
        const removed = vendor.kinds.filter((kind) => !input.kinds.includes(kind));
        const result = await updateVendorAction({ ...input, id: vendor.id, version: vendor.version, confirmRemoveKinds: confirmed ? removed : undefined });
        return outcomeOf(result, 'kinds');
      }}
    />
  );
}

/** Archive or bring back a vendor; a temp agency warns that Crew uses it, and the server needs that yes too. */
export function VendorArchiveButton({ id, name, archived, isTempAgency }: { readonly id: string; readonly name: string; readonly archived: boolean; readonly isTempAgency: boolean }) {
  return (
    <ArchiveButton
      name={name}
      archived={archived}
      size="md"
      testId="vendor-archive"
      warning={isTempAgency ? `${name} is a temp agency, and Crew uses it. Archiving hides it from Crew too.` : undefined}
      onToggle={(archive) => setVendorArchivedAction({ id, archived: archive, confirmCrew: archive && isTempAgency ? true : undefined })}
    />
  );
}
