"use client";

/**
 * Owned-address editor for clients and customers: address cards grouped by usage type
 * (Shipping / Billing / Return) with Default badges, and the Add / Edit Address modal
 * (name, usage type, company, lines, country-driven state, postal, phone, email, Active,
 * Set default). One default per usage type is kept automatically.
 */
import * as React from "react";
import { MapPin, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useController, useWatch } from "react-hook-form";
import { ADDRESS_USAGE_TYPES } from "@/lib/enums";
import { countryName, countryOptions, subdivisionsFor } from "@/lib/countries";
import { EMPTY_ORG_ADDRESS, normalizeDefaults, orgAddressModalSchema, type OrgAddressInput } from "@/lib/grid-defs/organization/common";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormField, FormGrid, SubmitBar, useZodForm } from "@/components/ui/form";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { YesNoToggle } from "@/components/ui/yes-no-toggle";

const COUNTRY_OPTIONS = countryOptions();
type A = OrgAddressInput;

const USAGE_TONE: Readonly<Record<string, "info" | "primary" | "warning">> = { Shipping: "info", Billing: "primary", Return: "warning" };

export function addressLines(a: Pick<A, "line1" | "line2" | "city" | "state" | "postalCode" | "country">): string[] {
  return [
    [a.line1, a.line2].filter(Boolean).join(", "),
    [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    countryName(a.country ?? ""),
  ].filter((l) => l.trim().length > 0);
}

function AddressModal({ open, initial, title, onOpenChange, onSave, lockUsage }: { readonly open: boolean; readonly initial: A; readonly title: string; readonly onOpenChange: (o: boolean) => void; readonly onSave: (a: A) => void; readonly lockUsage?: boolean }) {
  const form = useZodForm(orgAddressModalSchema, initial, { mode: "onSubmit" });
  React.useEffect(() => { if (open) form.reset(initial); }, [open, initial, form]);
  const country = useWatch({ control: form.control, name: "country" });
  const subs = subdivisionsFor(country);
  const stateLabel = country === "CA" ? "Province" : "State";
  const shipping = useWatch({ control: form.control, name: "usageType" }) === "Shipping";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title={title} description="Enter and set the address to use on operations." />
        <Form form={form} onSubmit={(values) => { onSave({ ...initial, ...values } as A); onOpenChange(false); }} className="flex min-h-0 flex-1 flex-col gap-0">
          <DialogBody>
            <FormGrid>
              <FormField<A> name="name" label="Address name" required>{(c) => <TextField {...c} maxLength={50} placeholder="e.g. Main warehouse dock" />}</FormField>
              <FormField<A> name="usageType" label="Usage type" required info={lockUsage ? undefined : "Shipping addresses are used on orders, Billing on invoices, Return on return labels"}>
                {(c) => <SegmentedControl ariaLabel="Usage type" options={ADDRESS_USAGE_TYPES.map((u) => ({ value: u, label: u }))} value={(c.value as string) ?? "Shipping"} onChange={(v) => c.onChange(v)} disabled={c.disabled} />}
              </FormField>
              <FormField<A> name="firstName" label="Contact first name" required={shipping}>{(c) => <TextField {...c} value={(c.value as string | null) ?? ""} maxLength={60} autoComplete="given-name" />}</FormField>
              <FormField<A> name="lastName" label="Contact last name" required={shipping}>{(c) => <TextField {...c} value={(c.value as string | null) ?? ""} maxLength={60} autoComplete="family-name" />}</FormField>
              <FormField<A> name="companyName" label="Company">{(c) => <TextField {...c} value={(c.value as string | null) ?? ""} maxLength={120} autoComplete="organization" />}</FormField>
              <FormField<A> name="line1" label="Address line 1" required>{(c) => <TextField {...c} maxLength={256} autoComplete="address-line1" />}</FormField>
              <FormField<A> name="line2" label="Address line 2">{(c) => <TextField {...c} value={(c.value as string | null) ?? ""} maxLength={256} autoComplete="address-line2" />}</FormField>
              <FormField<A> name="city" label="City" required>{(c) => <TextField {...c} maxLength={100} autoComplete="address-level2" />}</FormField>
              <FormField<A> name="country" label="Country" required>
                {(c) => <Combobox id={c.id} aria-label="Country" options={COUNTRY_OPTIONS} value={(c.value as string | null) ?? null} invalid={c.invalid} onBlur={c.onBlur}
                  onChange={(v) => { c.onChange(v ?? ""); form.setValue("state", "", { shouldDirty: true }); }} />}
              </FormField>
              <FormField<A> name="state" label={stateLabel} required={subs.length > 0}>
                {(c) => subs.length > 0
                  ? <Combobox id={c.id} aria-label={stateLabel} options={subs.map((s) => ({ value: s.code, label: s.name }))} value={(c.value as string | null) || null} invalid={c.invalid} onBlur={c.onBlur} onChange={(v) => c.onChange(v ?? "")} />
                  : <TextField {...c} value={(c.value as string | null) ?? ""} maxLength={100} />}
              </FormField>
              <FormField<A> name="postalCode" label={country === "US" ? "ZIP code" : "Postal code"} required>{(c) => <TextField {...c} maxLength={20} autoComplete="postal-code" />}</FormField>
              <FormField<A> name="phone" label="Phone">{(c) => <TextField {...c} value={(c.value as string | null) ?? ""} type="tel" maxLength={40} />}</FormField>
              <FormField<A> name="email" label="Email" required={shipping} info={shipping ? "Printed on carrier labels and used for delivery notifications" : undefined}>{(c) => <TextField {...c} value={(c.value as string | null) ?? ""} type="email" maxLength={200} />}</FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField<A> name="isActive" label="Active">{(c) => <YesNoToggle value={Boolean(c.value)} onChange={(v) => c.onChange(v)} ariaLabel="Active" />}</FormField>
                <FormField<A> name="isDefault" label="Set default address" info="The default address of each usage type is pre-filled on new orders and documents">{(c) => <YesNoToggle value={Boolean(c.value)} onChange={(v) => c.onChange(v)} ariaLabel="Set default address" />}</FormField>
              </div>
            </FormGrid>
          </DialogBody>
          <DialogFooter><SubmitBar submitLabel={initial.line1 ? "Save address" : "Add"} onCancel={() => onOpenChange(false)} className="w-full" /></DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export interface AddressesEditorProps {
  readonly value: readonly A[];
  readonly onChange: (next: A[]) => void;
  readonly disabled?: boolean;
  readonly requireShipping?: boolean;
  readonly error?: string;
  readonly description?: string;
}

/** Controlled list editor (use `AddressesField` inside react-hook-form). */
export function AddressesEditor({ value, onChange, disabled, requireShipping, error, description = "Add the addresses used on operations." }: AddressesEditorProps) {
  const [editing, setEditing] = React.useState<{ index: number | null; initial: A } | null>(null);
  const list = value;
  const save = (a: A, index: number | null) => {
    const next = index === null ? [...list, a] : list.map((x, i) => (i === index ? a : x));
    onChange(normalizeDefaults(next.map((x) => ({ ...x, isDefault: Boolean(x.isDefault), isActive: x.isActive !== false }))) as A[]);
  };
  const remove = (index: number) => onChange(normalizeDefaults(list.filter((_, i) => i !== index).map((x) => ({ ...x, isDefault: Boolean(x.isDefault), isActive: x.isActive !== false }))) as A[]);
  const makeDefault = (index: number) => onChange(list.map((x, i) => (x.usageType === list[index]?.usageType ? { ...x, isDefault: i === index } : x)));
  const missingShipping = requireShipping && !list.some((a) => a.usageType === "Shipping" && a.isActive !== false);
  return (
    <section className="flex flex-col gap-3" aria-label="Addresses">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Addresses{requireShipping ? <span className="text-danger"> *</span> : null}</h3>
          <p className="text-xs text-secondary">{description}</p>
        </div>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setEditing({ index: null, initial: { ...EMPTY_ORG_ADDRESS, usageType: missingShipping || list.length === 0 ? "Shipping" : "Billing", isDefault: !list.some((a) => a.usageType === "Shipping") } })}>
          <Plus className="h-4 w-4" aria-hidden />Add address
        </Button>
      </div>
      {list.length === 0 ? (
        <div className={cn("flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center", error ? "border-danger bg-danger-soft/30" : "border-border-strong bg-surface-sunken/40")}>
          <MapPin className="h-5 w-5 text-faint" aria-hidden />
          <p className="text-sm text-secondary">No addresses have been added yet. Click Add address to add one.</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((a, i) => (
            <li key={a.id ?? `new-${i}`} className={cn("group relative flex flex-col gap-1.5 rounded-lg border bg-surface p-3.5 transition-shadow hover:shadow-sm", a.isDefault ? "border-primary/40 ring-1 ring-primary/10" : "border-border", a.isActive === false && "opacity-60")}>
              <div className="flex items-center gap-1.5">
                <Badge tone={USAGE_TONE[a.usageType ?? "Shipping"] ?? "info"} size="sm" shape="pill">{a.usageType}</Badge>
                {a.isDefault ? <Badge tone="solid" size="sm" shape="pill" icon={Star}>Default</Badge> : null}
                {a.isActive === false ? <Badge tone="outline" size="sm" shape="pill">Inactive</Badge> : null}
                <span className="ml-auto" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${a.name}`} disabled={disabled}><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem icon={Pencil} onSelect={() => setEditing({ index: i, initial: a })}>Edit</DropdownMenuItem>
                    <DropdownMenuItem icon={Star} disabledReason={a.isDefault ? "Already the default" : null} onSelect={() => makeDefault(i)}>Set as default {a.usageType?.toLowerCase()}</DropdownMenuItem>
                    <DropdownMenuItem icon={Trash2} destructive onSelect={() => remove(i)}>Remove</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="text-sm font-semibold text-foreground">{a.name}{a.companyName ? <span className="font-normal text-secondary"> · {a.companyName}</span> : null}</p>
              <div className="text-xs leading-5 text-secondary">{addressLines(a).map((l) => <div key={l}>{l}</div>)}</div>
              {a.firstName || a.lastName || a.phone || a.email ? <p className="text-xs text-faint">{[[a.firstName, a.lastName].filter(Boolean).join(" "), a.phone, a.email].filter(Boolean).join(" · ")}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : missingShipping && list.length > 0 ? <p className="text-xs text-warning">Add at least one active Shipping address.</p> : null}
      {editing ? (
        <AddressModal open title={editing.index === null ? "Add address" : `Edit address ${editing.initial.name}`} initial={editing.initial}
          onOpenChange={(o) => !o && setEditing(null)} onSave={(a) => save(a, editing.index)} />
      ) : null}
    </section>
  );
}

/** react-hook-form binding for an `addresses` array field. */
export function AddressesField({ name = "addresses", disabled, requireShipping, description }: { readonly name?: string; readonly disabled?: boolean; readonly requireShipping?: boolean; readonly description?: string }) {
  const { field, fieldState } = useController({ name });
  const value = (field.value as A[] | undefined) ?? [];
  const nested = fieldState.error && !fieldState.error.message ? "One of the addresses is incomplete; edit it to fix the highlighted fields" : undefined;
  return (
    <div data-invalid={fieldState.error ? "true" : undefined} tabIndex={-1} ref={field.ref}>
      <AddressesEditor value={value} onChange={(next) => field.onChange(next)} disabled={disabled} requireShipping={requireShipping} error={fieldState.error?.message ?? nested} description={description} />
    </div>
  );
}
