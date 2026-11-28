'use client';
/** The add, edit and archive controls of the setup lists on Settings: items, tax rates, terms, accounts, mappings. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, Select, toast } from '@/components/ui';
import {
  createAccountAction,
  createItemAction,
  createTaxRateAction,
  createTermsAction,
  setAccountArchivedAction,
  setDefaultTermsAction,
  setItemArchivedAction,
  setMappingAction,
  setTaxRateArchivedAction,
  setTermsArchivedAction,
  updateAccountAction,
  updateItemAction,
  updateTaxRateAction,
  updateTermsAction,
} from '@/server/actions/setup-lists';
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, PULSE_COST_CATEGORIES, TERMS_KINDS, type AccountSubtype, type AccountType, type TermsKind } from '@/lib/ledger-enums';
import { ArchiveButton } from './archive-button';
import { FormDialog, idOrNull, outcomeOf, str, type FormOption } from './form-dialog';

const words = (value: string): string => {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/* -------------------------------------------------------------------------------- items */

export interface ItemValues {
  readonly id: string;
  readonly version: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly unitLabel: string | null;
  readonly price: string;
  readonly accountId: string;
  readonly taxRateId: string | null;
}

export function ItemForm({ item, accounts, rates }: { readonly item: ItemValues | null; readonly accounts: readonly FormOption[]; readonly rates: readonly FormOption[] }) {
  return (
    <FormDialog
      title={item ? `Edit ${item.code}` : 'Add an item'}
      triggerLabel={item ? 'Edit' : 'Add an item'}
      triggerVariant={item ? 'ghost' : 'primary'}
      triggerIcon={item ? undefined : <Plus aria-hidden className="size-4" />}
      submitLabel={item ? 'Save' : 'Add item'}
      successMessage={item ? 'Item saved' : 'Item added'}
      testId="item-form"
      fields={[
        { kind: 'text', name: 'code', label: 'Item code', required: true, hint: 'Short and unique, like STOR.' },
        { kind: 'text', name: 'name', label: 'Name', required: true },
        { kind: 'text', name: 'unitLabel', label: 'Unit', placeholder: 'pallet month' },
        { kind: 'text', name: 'defaultPrice', label: 'Default price', inputMode: 'decimal', hint: 'Up to 4 decimals, like 0.0350.' },
        { kind: 'select', name: 'accountId', label: 'Revenue account', options: accounts, required: true },
        { kind: 'select', name: 'taxRateId', label: 'Tax rate', options: rates, emptyLabel: 'Not taxed' },
        { kind: 'textarea', name: 'description', label: 'Description on invoices' },
      ]}
      initial={{
        code: item?.code ?? '',
        name: item?.name ?? '',
        unitLabel: item?.unitLabel ?? '',
        defaultPrice: item?.price ?? '',
        accountId: item?.accountId ?? '',
        taxRateId: item?.taxRateId ?? '',
        description: item?.description ?? '',
      }}
      onSubmit={async (values) => {
        const input = {
          code: str(values, 'code'),
          name: str(values, 'name'),
          unitLabel: str(values, 'unitLabel') || null,
          defaultPrice: str(values, 'defaultPrice') || null,
          accountId: str(values, 'accountId'),
          taxRateId: idOrNull(values, 'taxRateId'),
          description: str(values, 'description') || null,
        };
        return outcomeOf(item ? await updateItemAction({ ...input, id: item.id, version: item.version }) : await createItemAction(input));
      }}
    />
  );
}

export function ItemArchive({ id, name, archived }: { readonly id: string; readonly name: string; readonly archived: boolean }) {
  return <ArchiveButton name={name} archived={archived} onToggle={(archive) => setItemArchivedAction({ id, archived: archive })} />;
}

/* ---------------------------------------------------------------------------- tax rates */

export interface TaxValues {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly ratePct: string;
  readonly accountId: string;
  readonly agency: string | null;
  readonly inUse: boolean;
}

export function TaxRateForm({ rate, accounts }: { readonly rate: TaxValues | null; readonly accounts: readonly FormOption[] }) {
  return (
    <FormDialog
      title={rate ? `Edit ${rate.name}` : 'Add a tax rate'}
      description={rate?.inUse ? 'Invoices use this rate, so its percent stays. To charge another percent, add a new rate.' : undefined}
      triggerLabel={rate ? 'Edit' : 'Add a tax rate'}
      triggerVariant={rate ? 'ghost' : 'primary'}
      triggerIcon={rate ? undefined : <Plus aria-hidden className="size-4" />}
      submitLabel={rate ? 'Save' : 'Add rate'}
      successMessage={rate ? 'Tax rate saved' : 'Tax rate added'}
      testId="tax-form"
      fields={[
        { kind: 'text', name: 'name', label: 'Name', required: true, placeholder: 'Texas: Austin 8.25%' },
        { kind: 'text', name: 'ratePct', label: 'Rate percent', required: true, inputMode: 'decimal', hint: 'Up to 4 decimals, like 8.25.', disabled: rate?.inUse },
        { kind: 'select', name: 'accountId', label: 'Owed on account', options: accounts, emptyLabel: 'Sales tax to pay' },
        { kind: 'text', name: 'agency', label: 'Agency', placeholder: 'Texas Comptroller' },
      ]}
      initial={{ name: rate?.name ?? '', ratePct: rate?.ratePct ?? '', accountId: rate?.accountId ?? '', agency: rate?.agency ?? '' }}
      onSubmit={async (values) => {
        const input = { name: str(values, 'name'), ratePct: str(values, 'ratePct'), accountId: idOrNull(values, 'accountId'), agency: str(values, 'agency') || null };
        return outcomeOf(rate ? await updateTaxRateAction({ ...input, id: rate.id, version: rate.version }) : await createTaxRateAction(input));
      }}
    />
  );
}

export function TaxRateArchive({ id, name, archived }: { readonly id: string; readonly name: string; readonly archived: boolean }) {
  return <ArchiveButton name={name} archived={archived} onToggle={(archive) => setTaxRateArchivedAction({ id, archived: archive })} />;
}

/* -------------------------------------------------------------------------------- terms */

export interface TermsValues {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly kind: TermsKind;
  readonly days: number | null;
  readonly dayOfMonth: number | null;
}

const TERMS_WORDS: Readonly<Record<TermsKind, string>> = { due_on_receipt: 'Due on receipt', net_days: 'A number of days after the invoice', day_of_next_month: 'A day of the next month' };

export function TermsForm({ terms }: { readonly terms: TermsValues | null }) {
  return (
    <FormDialog
      title={terms ? `Edit ${terms.name}` : 'Add terms'}
      triggerLabel={terms ? 'Edit' : 'Add terms'}
      triggerVariant={terms ? 'ghost' : 'primary'}
      triggerIcon={terms ? undefined : <Plus aria-hidden className="size-4" />}
      submitLabel={terms ? 'Save' : 'Add terms'}
      successMessage={terms ? 'Terms saved' : 'Terms added'}
      testId="terms-form"
      fields={[
        { kind: 'text', name: 'name', label: 'Name', required: true, placeholder: 'Net 20' },
        { kind: 'select', name: 'kind', label: 'Due', required: true, options: TERMS_KINDS.map((kind) => ({ value: kind, label: TERMS_WORDS[kind] })) },
        { kind: 'text', name: 'days', label: 'Days after the invoice', inputMode: 'numeric', hint: 'For a number of days.' },
        { kind: 'text', name: 'dayOfMonth', label: 'Day of the next month', inputMode: 'numeric', hint: 'For a day of the next month, 1 to 31.' },
      ]}
      initial={{ name: terms?.name ?? '', kind: terms?.kind ?? 'net_days', days: terms?.days?.toString() ?? '', dayOfMonth: terms?.dayOfMonth?.toString() ?? '' }}
      onSubmit={async (values) => {
        const input = { name: str(values, 'name'), kind: str(values, 'kind') as TermsKind, days: str(values, 'days') || null, dayOfMonth: str(values, 'dayOfMonth') || null };
        return outcomeOf(terms ? await updateTermsAction({ ...input, id: terms.id, version: terms.version }) : await createTermsAction(input));
      }}
    />
  );
}

export function TermsArchive({ id, name, archived }: { readonly id: string; readonly name: string; readonly archived: boolean }) {
  return <ArchiveButton name={name} archived={archived} onToggle={(archive) => setTermsArchivedAction({ id, archived: archive })} />;
}

export function MakeDefaultTerms({ id, name }: { readonly id: string; readonly name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setDefaultTermsAction({ id });
          if (!result.ok) {
            toast.error("Couldn't change the default", result.error.message);
            return;
          }
          toast.success(`${name} is the default now`);
          router.refresh();
        })
      }
    >
      Make default
    </Button>
  );
}

/* ----------------------------------------------------------------------------- accounts */

export interface AccountValues {
  readonly id: string;
  readonly version: number;
  readonly number: string;
  readonly name: string;
  readonly type: AccountType;
  readonly subtype: AccountSubtype;
  readonly parentId: string | null;
  readonly description: string | null;
  readonly pulseCostCategory: string | null;
  readonly system: boolean;
}

export function AccountForm({ account, parents }: { readonly account: AccountValues | null; readonly parents: readonly FormOption[] }) {
  return (
    <FormDialog
      title={account ? `Edit ${account.number} ${account.name}` : 'Add an account'}
      description={account?.system ? 'Ledger uses this account. You can rename and renumber it; its type stays.' : undefined}
      triggerLabel={account ? 'Edit' : 'Add an account'}
      triggerVariant={account ? 'ghost' : 'primary'}
      triggerIcon={account ? undefined : <Plus aria-hidden className="size-4" />}
      submitLabel={account ? 'Save' : 'Add account'}
      successMessage={account ? 'Account saved' : 'Account added'}
      testId="account-form"
      fields={[
        { kind: 'text', name: 'number', label: 'Number', required: true },
        { kind: 'text', name: 'name', label: 'Name', required: true },
        { kind: 'select', name: 'type', label: 'Type', required: true, options: ACCOUNT_TYPES.map((type) => ({ value: type, label: words(type) })) },
        { kind: 'select', name: 'subtype', label: 'Subtype', required: true, options: ACCOUNT_SUBTYPES.map((subtype) => ({ value: subtype, label: words(subtype) })) },
        { kind: 'select', name: 'parentId', label: 'Parent account', options: parents.filter((option) => option.value !== account?.id), emptyLabel: 'No parent' },
        { kind: 'select', name: 'pulseCostCategory', label: 'Shows in Pulse as', options: PULSE_COST_CATEGORIES.map((category) => ({ value: category, label: words(category) })), emptyLabel: 'Not sent to Pulse' },
        { kind: 'textarea', name: 'description', label: 'Description' },
      ]}
      initial={{
        number: account?.number ?? '',
        name: account?.name ?? '',
        type: account?.type ?? 'expense',
        subtype: account?.subtype ?? 'expense',
        parentId: account?.parentId ?? '',
        pulseCostCategory: account?.pulseCostCategory ?? '',
        description: account?.description ?? '',
      }}
      onSubmit={async (values) => {
        const input = {
          number: str(values, 'number'),
          name: str(values, 'name'),
          type: str(values, 'type') as AccountType,
          subtype: str(values, 'subtype') as AccountSubtype,
          parentId: idOrNull(values, 'parentId'),
          pulseCostCategory: (str(values, 'pulseCostCategory') || null) as (typeof PULSE_COST_CATEGORIES)[number] | null,
          description: str(values, 'description') || null,
        };
        return outcomeOf(account ? await updateAccountAction({ ...input, id: account.id, version: account.version }) : await createAccountAction(input));
      }}
    />
  );
}

export function AccountArchive({ id, name, archived }: { readonly id: string; readonly name: string; readonly archived: boolean }) {
  return <ArchiveButton name={name} archived={archived} onToggle={(archive) => setAccountArchivedAction({ id, archived: archive })} />;
}

/* ----------------------------------------------------------------------------- mappings */

const NOT_MAPPED = '__none__';

export function MappingPicker({ source, mappingKey, itemId, items, canManage }: { readonly source: 'wms_operation' | 'program_fee_kind' | 'pulse_service' | 'pulse_job_type'; readonly mappingKey: string; readonly itemId: string | null; readonly items: readonly FormOption[]; readonly canManage: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(itemId ?? NOT_MAPPED);
  const [pending, startTransition] = useTransition();
  if (!canManage) return <span className="text-sm text-fg-secondary">{items.find((item) => item.value === itemId)?.label ?? 'Not mapped'}</span>;
  return (
    <div className="w-64">
      <Select
        aria-label={`Item for ${mappingKey}`}
        value={value}
        disabled={pending}
        options={[{ value: NOT_MAPPED, label: 'Not mapped' }, ...items]}
        data-testid={`mapping-${mappingKey}`}
        onValueChange={(next) => {
          const before = value;
          setValue(next);
          startTransition(async () => {
            const result = await setMappingAction({ source, key: mappingKey, itemId: next === NOT_MAPPED ? null : next });
            if (!result.ok) {
              setValue(before);
              toast.error("Couldn't change the mapping", result.error.message);
              return;
            }
            toast.success(`${mappingKey} saved`);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
