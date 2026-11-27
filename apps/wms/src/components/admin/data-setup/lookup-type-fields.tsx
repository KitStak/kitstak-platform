'use client';

/**
 * Type-specific sections of the Data Setup drawer (Logiwa parity, references/logiwa-live/settings-shell.md):
 * SO Type behaviour accordions, Order Merge conditions + data inheritance, Mobile Cart Type cart / cell
 * dimensions, Location Zone priority, Packing Warning text / trigger / media, Custom Carrier services /
 * packages / advanced lists, and Return Reason usage + linked damage reason.
 */
import * as React from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  CART_OPERATIONS,
  DIMENSION_UNITS,
  MERGE_CRITERIA,
  MERGE_INHERITANCE,
  mergeCriteriaLabel,
  PACKING_WARNING_TRIGGERS,
  SO_TYPE_FLAG_SECTIONS,
  isMergeCriterionComingSoon,
  isSoTypeFlagEnforced,
  ZONE_PUTAWAY_SETTINGS_ENFORCED,
  VAS_CALCULATION_TYPES,
  VOLUME_UNITS,
  type LookupDef,
  type LookupFormValues,
} from '@/lib/grid-defs/admin/lookups';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipInput } from '@/components/ui/chip-input';
import { FormField, FormGrid, FormSection } from '@/components/ui/form';
import { RadioCards } from '@/components/ui/radio-cards';
import { TextField } from '@/components/ui/text-field';
import { Textarea } from '@/components/ui/textarea';
import { YesNoToggle } from '@/components/ui/yes-no-toggle';
import { NumberField, SelectField, TextInput, YesNoField } from '../form-controls';
import { useLookupNames } from './use-lookup-names';

type F = LookupFormValues;

/** Marks a setting whose runtime consumer is not wired yet: shown read-only, never a silent no-op. */
export function ComingSoonBadge({
  title = 'Saved settings are kept, but this behaviour is not applied yet',
}: {
  readonly title?: string;
}) {
  return (
    <Badge tone="neutral" className="shrink-0" title={title}>
      Coming soon
    </Badge>
  );
}

function TextAreaField({
  name,
  label,
  required,
  maxLength,
  placeholder,
  info,
}: {
  readonly name: 'warningText' | 'description';
  readonly label: string;
  readonly required?: boolean;
  readonly maxLength: number;
  readonly placeholder?: string;
  readonly info?: string;
}) {
  return (
    <FormField<F> name={name} label={label} required={required} info={info}>
      {(c) => (
        <Textarea
          id={c.id}
          name={c.name}
          ref={c.ref as React.Ref<HTMLTextAreaElement>}
          value={(c.value as string | null) ?? ''}
          onChange={(e) => c.onChange(e.target.value)}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-describedby={c['aria-describedby']}
          aria-required={c['aria-required']}
          maxLength={maxLength}
          placeholder={placeholder}
          rows={3}
        />
      )}
    </FormField>
  );
}

function ChipsField({
  name,
  label,
  placeholder,
  info,
}: {
  readonly name: 'confirmationTypes' | 'insuranceTypes' | 'billingTypes' | 'mediaLinks';
  readonly label: string;
  readonly placeholder: string;
  readonly info?: string;
}) {
  return (
    <FormField<F> name={name} label={label} info={info}>
      {(c) => (
        <ChipInput
          id={c.id}
          value={(c.value as string[] | null) ?? []}
          onChange={(v) => c.onChange([...v])}
          onBlur={c.onBlur}
          disabled={c.disabled}
          invalid={c.invalid}
          aria-describedby={c['aria-describedby']}
          placeholder={placeholder}
          maxItems={name === 'mediaLinks' ? 10 : 50}
          maxLength={name === 'mediaLinks' ? 500 : 80}
        />
      )}
    </FormField>
  );
}

/** Inline "code + name + Add" list with inline rename (custom carrier services / packages). */
function PairList({
  name,
  title,
  description,
  codeLabel,
  nameLabel,
}: {
  readonly name: 'services' | 'packages';
  readonly title: string;
  readonly description?: string;
  readonly codeLabel: string;
  readonly nameLabel: string;
}) {
  const { setValue, control, getValues } = useFormContext<F>();
  const items = (useWatch({ control, name }) ?? []) as { code: string; name: string }[];
  const [code, setCode] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ idx: number; name: string } | null>(null);
  const add = () => {
    const c = code.trim().toUpperCase();
    const n = label.trim();
    if (!c || !n) {
      setError(`Enter both the ${codeLabel.toLowerCase()} and the ${nameLabel.toLowerCase()}`);
      return;
    }
    if (items.some((i) => i.code.toLowerCase() === c.toLowerCase())) {
      setError(`${c} is already listed`);
      return;
    }
    setValue(name, [...(getValues(name) ?? []), { code: c, name: n }], {
      shouldDirty: true,
      shouldValidate: true,
    });
    setCode('');
    setLabel('');
    setError(null);
  };
  const remove = (idx: number) =>
    setValue(
      name,
      items.filter((_, i) => i !== idx),
      { shouldDirty: true, shouldValidate: true },
    );
  const saveEdit = () => {
    if (!editing) return;
    const n = editing.name.trim();
    if (!n) {
      setError(`${nameLabel} can't be empty`);
      return;
    }
    setValue(
      name,
      items.map((it, i) => (i === editing.idx ? { ...it, name: n } : it)),
      { shouldDirty: true, shouldValidate: true },
    );
    setEditing(null);
    setError(null);
  };
  return (
    <FormSection title={title} description={description}>
      <FormField<F> name={name}>
        {() => (
          <div className="flex flex-col gap-2">
            <div
              className="flex items-start gap-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            >
              <TextField
                aria-label={codeLabel}
                placeholder={codeLabel}
                value={code}
                maxLength={40}
                onChange={(e) => setCode(e.target.value)}
                className="w-36"
              />
              <TextField
                aria-label={nameLabel}
                placeholder={nameLabel}
                value={label}
                maxLength={120}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Button variant="secondary" onClick={add} disabled={!code.trim() || !label.trim()}>
                <Plus className="h-4 w-4" aria-hidden />
                Add
              </Button>
            </div>
            {error ? (
              <p className="text-xs text-danger" role="alert">
                {error}
              </p>
            ) : null}
            {items.length ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-2xs text-faint">
                    <th className="py-1.5 font-medium">{codeLabel}</th>
                    <th className="py-1.5 font-medium">{nameLabel}</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.code} className="border-b border-border/60 last:border-0">
                      <td className="py-1.5 font-mono">{it.code}</td>
                      <td className="py-1">
                        {editing?.idx === i ? (
                          <TextField
                            aria-label={`${nameLabel} for ${it.code}`}
                            value={editing.name}
                            maxLength={120}
                            autoFocus
                            className="h-7"
                            onChange={(e) => setEditing({ idx: i, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                saveEdit();
                              }
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setEditing(null);
                              }
                            }}
                          />
                        ) : (
                          it.name
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1 text-right">
                        {editing?.idx === i ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Save ${it.code}`}
                            onClick={saveEdit}
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${it.code}`}
                            onClick={() => setEditing({ idx: i, name: it.name })}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${it.code}`}
                          onClick={() => remove(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-faint">
                Nothing added yet.
              </p>
            )}
          </div>
        )}
      </FormField>
    </FormSection>
  );
}

/** Advanced custom-carrier lists (confirmation / insurance / billing types): inline add, rename and remove. */
function TextList({
  name,
  title,
  description,
  placeholder,
}: {
  readonly name: 'confirmationTypes' | 'insuranceTypes' | 'billingTypes';
  readonly title: string;
  readonly description?: string;
  readonly placeholder: string;
}) {
  const { setValue, control } = useFormContext<F>();
  const items = (useWatch({ control, name }) ?? []) as string[];
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ idx: number; value: string } | null>(null);
  const set = (next: string[]) => setValue(name, next, { shouldDirty: true, shouldValidate: true });
  const exists = (v: string, except: number | null) =>
    items.some((x, i) => i !== except && x.toLowerCase() === v.toLowerCase());
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (exists(v, null)) {
      setError(`${v} is already listed`);
      return;
    }
    if (items.length >= 50) {
      setError('At most 50 entries');
      return;
    }
    set([...items, v.slice(0, 80)]);
    setDraft('');
    setError(null);
  };
  const saveEdit = () => {
    if (!editing) return;
    const v = editing.value.trim();
    if (!v) {
      setError("The name can't be empty");
      return;
    }
    if (exists(v, editing.idx)) {
      setError(`${v} is already listed`);
      return;
    }
    set(items.map((x, i) => (i === editing.idx ? v.slice(0, 80) : x)));
    setEditing(null);
    setError(null);
  };
  return (
    <FormSection title={title} description={description}>
      <FormField<F> name={name}>
        {() => (
          <div className="flex flex-col gap-2">
            <div
              className="flex items-start gap-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            >
              <TextField
                aria-label={`New ${title.toLowerCase()}`}
                placeholder={placeholder}
                value={draft}
                maxLength={80}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button variant="secondary" onClick={add} disabled={!draft.trim()}>
                <Plus className="h-4 w-4" aria-hidden />
                Add
              </Button>
            </div>
            {error ? (
              <p className="text-xs text-danger" role="alert">
                {error}
              </p>
            ) : null}
            {items.length ? (
              <ul className="flex flex-col divide-y divide-border/60 rounded-md border border-border">
                {items.map((it, i) => (
                  <li key={`${it}-${i}`} className="flex items-center gap-2 px-2.5 py-1">
                    {editing?.idx === i ? (
                      <TextField
                        aria-label={`Rename ${it}`}
                        value={editing.value}
                        maxLength={80}
                        autoFocus
                        className="h-7"
                        onChange={(e) => setEditing({ idx: i, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            saveEdit();
                          }
                          if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEditing(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-xs text-body">{it}</span>
                    )}
                    {editing?.idx === i ? (
                      <Button variant="ghost" size="icon-sm" aria-label={`Save ${it}`} onClick={saveEdit}>
                        <Check className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${it}`}
                        onClick={() => setEditing({ idx: i, value: it })}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${it}`}
                      onClick={() => set(items.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-faint">
                Nothing added yet.
              </p>
            )}
          </div>
        )}
      </FormField>
    </FormSection>
  );
}

/** Custom Carrier create / edit wizard steps (Logiwa: General, Services, Packages, Advanced). */
export const CUSTOM_CARRIER_STEPS = ['General', 'Services', 'Packages', 'Advanced'] as const;

export function CustomCarrierStep({ step }: { readonly step: number }) {
  if (step === 0)
    return (
      <TextInput<F>
        name="logoUrl"
        label="Logo URL"
        maxLength={500}
        placeholder="https://…"
        info="Shown next to the carrier in shipping option lists"
      />
    );
  if (step === 1)
    return (
      <PairList
        name="services"
        title="Shipping services"
        description="Every service appears in the order's shipping option list as Carrier · Service."
        codeLabel="Service code"
        nameLabel="Service name"
      />
    );
  if (step === 2)
    return (
      <PairList name="packages" title="Carrier packages" codeLabel="Package code" nameLabel="Package name" />
    );
  return (
    <>
      <TextList name="confirmationTypes" title="Confirmation types" placeholder="e.g. Signature required" />
      <TextList name="insuranceTypes" title="Insurance types" placeholder="e.g. Declared value" />
      <TextList
        name="billingTypes"
        title="Billing types"
        placeholder="e.g. Sender, Recipient, Third-Party, Collect"
      />
    </>
  );
}

function SoTypeFlags() {
  const { control } = useFormContext<F>();
  const flags = (useWatch({ control, name: 'flags' }) ?? []) as string[];
  return (
    <FormField<F> name="flags">
      {(c) => (
        <div className="flex flex-col gap-2">
          {SO_TYPE_FLAG_SECTIONS.map((section, si) => {
            const on = section.flags.filter((f) => flags.includes(f.key)).length;
            return (
              <FormSection
                key={section.title}
                collapsible
                defaultOpen={si === 0}
                title={
                  <span className="flex items-center gap-2">
                    {section.title}
                    <Badge tone={on ? 'info' : 'neutral'}>
                      {on}/{section.flags.length}
                    </Badge>
                  </span>
                }
              >
                <div className="flex flex-col divide-y divide-border/60">
                  {section.flags.map((f) => {
                    const value = flags.includes(f.key);
                    const enforced = isSoTypeFlagEnforced(f.key);
                    return (
                      <div key={f.key} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p
                            className={`flex items-center gap-2 text-sm font-medium ${enforced ? 'text-strong' : 'text-secondary'}`}
                          >
                            {f.label}
                            {enforced ? null : <ComingSoonBadge />}
                          </p>
                          {f.hint ? <p className="text-2xs text-faint">{f.hint}</p> : null}
                        </div>
                        <YesNoToggle
                          value={value}
                          ariaLabel={enforced ? f.label : `${f.label} (coming soon)`}
                          disabled={c.disabled || !enforced}
                          onChange={(next) =>
                            c.onChange(next ? [...flags, f.key] : flags.filter((k) => k !== f.key))
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </FormSection>
            );
          })}
        </div>
      )}
    </FormField>
  );
}

function MergeRuleFields() {
  const { control } = useFormContext<F>();
  const criteria = (useWatch({ control, name: 'criteria' }) ?? []) as string[];
  const group = (recommended: boolean) => MERGE_CRITERIA.filter((c) => c.recommended === recommended);
  return (
    <>
      <FormField<F>
        name="criteria"
        label="Merging conditions"
        required
        description={
          criteria.length
            ? `Orders merge only when these are identical: ${mergeCriteriaLabel(criteria)}`
            : 'Orders will only merge if the selected fields are identical across all shipments.'
        }
      >
        {(c) => (
          <div className="flex flex-col gap-3" role="group" aria-describedby={c['aria-describedby']}>
            {[true, false].map((rec) => (
              <div key={String(rec)}>
                <p className="mb-1.5 text-2xs font-semibold text-faint">
                  {rec ? 'Default conditions' : 'Additional conditions'}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group(rec).map((opt) => {
                    const on = criteria.includes(opt.key);
                    // A not-yet-wired condition can be unticked (to clean up an old rule) but never added.
                    const soon = isMergeCriterionComingSoon(opt.key);
                    return (
                      <div
                        key={opt.key}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${on ? 'border-primary bg-primary-soft/40' : 'border-border'}`}
                      >
                        <Checkbox
                          checked={on}
                          disabled={c.disabled || (soon && !on)}
                          onCheckedChange={() =>
                            c.onChange(on ? criteria.filter((k) => k !== opt.key) : [...criteria, opt.key])
                          }
                          label={opt.label}
                        />
                        {soon ? <ComingSoonBadge title="Orders have no tag field to compare yet" /> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </FormField>
      <FormField<F>
        name="inheritFrom"
        label="Data inheritance"
        description="Which order provides the metadata for the new master order."
      >
        {(c) => (
          <RadioCards
            ariaLabel="Data inheritance"
            value={(c.value as string) ?? 'oldest'}
            onChange={c.onChange}
            options={MERGE_INHERITANCE.map((m) => {
              const soon = 'comingSoon' in m && m.comingSoon === true;
              return {
                value: m.value,
                title: soon ? `${m.title} · Coming soon` : m.title,
                description: soon ? `${m.description} Merges keep the oldest order for now.` : m.description,
                disabled: c.disabled || (soon && c.value !== m.value),
              };
            })}
          />
        )}
      </FormField>
    </>
  );
}

function MobileCartFields() {
  const { control } = useFormContext<F>();
  const levels = useWatch({ control, name: 'levels' });
  const cols = useWatch({ control, name: 'columns' });
  const unit = useWatch({ control, name: 'dimensionUnit' }) ?? 'Inch';
  const short = unit === 'Inch' ? 'in' : unit === 'Foot' ? 'ft' : unit === 'Centimeter' ? 'cm' : 'm';
  return (
    <>
      <FormGrid columns={3}>
        <NumberField<F> name="levels" label="Number of levels" required min={1} max={20} nullable />
        <NumberField<F> name="columns" label="Number of columns" required min={1} max={30} nullable />
        <SelectField<F>
          name="operation"
          label="Operation type"
          required
          options={CART_OPERATIONS.map((o) => ({ value: o, label: o }))}
        />
      </FormGrid>
      <FormGrid columns={3}>
        <SelectField<F>
          name="dimensionUnit"
          label="Dimension unit"
          options={DIMENSION_UNITS.map((u) => ({ value: u, label: u }))}
        />
        <SelectField<F>
          name="volumeUnit"
          label="Volume unit"
          options={VOLUME_UNITS.map((u) => ({ value: u, label: u }))}
        />
        <YesNoField<F>
          name="allowMultipleJobs"
          label="Allow multiple jobs"
          info="One cart can carry tasks from more than one job"
        />
      </FormGrid>
      {levels && cols ? (
        <div className="rounded-lg border border-border bg-surface-sunken p-3">
          <p className="mb-2 text-2xs text-faint">
            {levels} × {cols} = {levels * cols} cells · named{' '}
            <code className="font-mono">Cart_column_level</code>, sequence column-first per level
          </p>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${Math.min(cols, 30)}, minmax(0, 1fr))` }}
            aria-hidden
          >
            {Array.from({ length: Math.min(levels * cols, 600) }, (_, i) => (
              <span
                key={i}
                className="flex h-5 items-center justify-center rounded bg-surface text-2xs text-faint ring-1 ring-border"
              >
                {String.fromCharCode(65 + Math.floor(i / cols))}
                {(i % cols) + 1}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <FormSection title="Mobile cart dimensions" description="Height × length × width of the whole cart.">
        <FormGrid columns={3}>
          <NumberField<F> name="cartHeight" label="Height" nullable decimals={2} max={10000} suffix={short} />
          <NumberField<F> name="cartLength" label="Length" nullable decimals={2} max={10000} suffix={short} />
          <NumberField<F> name="cartWidth" label="Width" nullable decimals={2} max={10000} suffix={short} />
        </FormGrid>
      </FormSection>
      <FormSection
        title="Cell dimensions"
        description="Fill these in so AI Jobs can size orders to cells accurately."
      >
        <FormGrid columns={2}>
          <NumberField<F>
            name="cellHeight"
            label="Cell height"
            nullable
            decimals={2}
            max={10000}
            suffix={short}
          />
          <NumberField<F>
            name="cellLength"
            label="Cell length"
            nullable
            decimals={2}
            max={10000}
            suffix={short}
          />
          <NumberField<F>
            name="cellWidth"
            label="Cell width"
            nullable
            decimals={2}
            max={10000}
            suffix={short}
          />
          <NumberField<F> name="cellVolume" label="Cell volume" nullable decimals={2} max={1000000} />
        </FormGrid>
      </FormSection>
    </>
  );
}

function ReturnReasonFields() {
  const { control } = useFormContext<F>();
  const link = useWatch({ control, name: 'linkDamageReason' });
  const damage = useLookupNames('damage_reason');
  return (
    <>
      <FormGrid>
        <YesNoField<F>
          name="customerReason"
          label="Use as a customer reason"
          info="Offered when the customer's reason is recorded on an RMA"
        />
        <YesNoField<F>
          name="actualReason"
          label="Use as an actual reason"
          info="Offered when the receiver records what was actually wrong"
        />
      </FormGrid>
      <YesNoField<F>
        name="linkDamageReason"
        label="Link with a damage reason"
        info="Items received with this reason are put into the damaged bucket with the linked damage reason"
      />
      {link ? (
        <SelectField<F>
          name="linkedDamageReasonId"
          label="Linked damage reason"
          required
          options={damage.map((d) => ({ value: d.id, label: d.name }))}
          placeholder={damage.length ? 'Select' : 'No damage reasons yet'}
        />
      ) : null}
    </>
  );
}

/** All type-specific controls for one lookup type. */
export function LookupTypeFields({ def }: { readonly def: LookupDef }) {
  switch (def.type) {
    case 'vas_type':
      return (
        <SelectField<F>
          name="calculationType"
          label="VAS calculation type"
          required
          options={VAS_CALCULATION_TYPES.map((v) => ({
            value: v,
            label: v === 'Vas Quantity' ? 'VAS quantity' : v,
          }))}
          info="Total price bills an entered amount; VAS quantity bills the rate × quantity"
        />
      );
    case 'mobile_cart_type':
      return <MobileCartFields />;
    case 'order_merge_rule':
      return <MergeRuleFields />;
    case 'damage_reason':
      return (
        <YesNoField<F>
          name="countsAsDamaged"
          label="Counts as damaged"
          info="Stock moved with this reason goes to the damaged bucket and is not allocatable"
        />
      );
    case 'so_type':
      return (
        <>
          <div>
            <p className="text-sm font-semibold text-strong">Order behaviours</p>
            <p className="text-xs text-faint">
              These switches apply to every shipment order of this type. All default to No. Switches marked
              Coming soon are read-only until allocation, picking, packing and shipping apply them; values
              saved earlier are kept.
            </p>
          </div>
          <SoTypeFlags />
        </>
      );
    case 'location_zone':
      return (
        <fieldset disabled={!ZONE_PUTAWAY_SETTINGS_ENFORCED} className="m-0 min-w-0 border-0 p-0">
          {ZONE_PUTAWAY_SETTINGS_ENFORCED ? null : (
            <p className="mb-2 flex items-center gap-2 text-xs text-faint">
              <ComingSoonBadge />
              Put-away doesn&apos;t read zone priority or the per-SKU location limit yet. Saved values are
              kept.
            </p>
          )}
          <FormGrid>
            <NumberField<F>
              name="priority"
              label="Zone priority"
              nullable
              min={0}
              max={9999}
              info="Put-away rules sorted by Zone Priority try lower numbers first"
            />
            <NumberField<F>
              name="maxLocationsPerSku"
              label="Max locations per SKU"
              nullable
              min={1}
              max={100000}
              info="Put-away won't spread one SKU over more locations than this in the zone"
            />
          </FormGrid>
        </fieldset>
      );
    case 'packing_warning_type':
      return (
        <>
          <TextAreaField
            name="warningText"
            label="Packing warning text"
            required
            maxLength={1000}
            placeholder="e.g. Wrap each item in bubble wrap before closing the box."
          />
          <SelectField<F>
            name="showWhen"
            label="Show warning when"
            required
            options={PACKING_WARNING_TRIGGERS.map((t) => ({ value: t.value, label: t.label }))}
          />
          <YesNoField<F>
            name="skipConfirmation"
            label="Skip confirmation from packer"
            info="When No, the packer must acknowledge the warning before continuing"
          />
          <ChipsField
            name="mediaLinks"
            label="Media links"
            placeholder="Paste an image or video link and press Enter"
            info="Shown with the warning at the packing station"
          />
        </>
      );
    case 'custom_carrier':
      return (
        <>
          {CUSTOM_CARRIER_STEPS.map((_, i) => (
            <CustomCarrierStep key={i} step={i} />
          ))}
        </>
      );
    case 'return_reason':
      return <ReturnReasonFields />;
    default:
      return null;
  }
}

/** Types whose drawer shows the free-text description. */
export const TYPES_WITH_DESCRIPTION = new Set<string>([
  'mobile_cart_type',
  'packing_warning_type',
  'custom_carrier',
  'so_type',
  'order_merge_rule',
  'location_zone',
  'return_process',
  'work_order_type',
  'vas_type',
]);
export { TextAreaField };
