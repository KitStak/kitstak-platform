"use client";

/**
 * Address fields (BUILD_PLAN F4.4) for use inside a parent `<Form>` built with
 * `useZodForm`. Nest `addressSchema` in the parent schema and pass its path as
 * `prefix` (e.g. "shipTo"). Country drives the state/province list and the postal
 * validation (US ZIP / CA postal); address type and tax type + ID are included.
 *
 *   const schema = z.object({ shipTo: addressSchema, ... });
 *   <AddressFields<z.input<typeof schema>> prefix="shipTo" />
 */
import * as React from "react";
import { useFormContext, useWatch, type FieldPath, type FieldValues } from "react-hook-form";
import { ADDRESS_TYPES, TAX_TYPES } from "@/lib/enums";
import { countryOptions, subdivisionsFor } from "@/lib/countries";
import { Combobox } from "@/components/ui/combobox";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { FormField, FormGrid } from "@/components/ui/form";
import { normalizePostal } from "./address-model";

const COUNTRY_OPTIONS = countryOptions();
const ADDRESS_TYPE_OPTIONS = ADDRESS_TYPES.map((t) => ({ value: t, label: t }));
const TAX_TYPE_OPTIONS = TAX_TYPES.map((t) => ({ value: t, label: t }));

export interface AddressFieldsProps {
  /** Path of the address object inside the parent form values. */
  readonly prefix: string;
  readonly showContact?: boolean;
  readonly showTax?: boolean;
  readonly disabled?: boolean;
}

export function AddressFields<T extends FieldValues>({ prefix, showContact = true, showTax = true, disabled }: AddressFieldsProps) {
  const path = (field: string) => `${prefix}.${field}` as FieldPath<T>;
  const { control, setValue, getValues } = useFormContext<T>();
  const country = useWatch({ control, name: path("country") }) as string | undefined;
  const subdivisions = subdivisionsFor(country);
  const stateOptions = subdivisions.map((s) => ({ value: s.code, label: s.name }));
  const stateLabel = country === "CA" ? "Province" : "State";
  const postalLabel = country === "US" ? "ZIP Code" : "Postal code";
  const requiresRegion = subdivisions.length > 0;

  return (
    <FormGrid>
      <FormField<T> name={path("name")} label="Name" required disabled={disabled}>
        {(c) => <TextField {...c} maxLength={120} autoComplete="name" />}
      </FormField>
      <FormField<T> name={path("company")} label="Company" disabled={disabled}>
        {(c) => <TextField {...c} maxLength={120} autoComplete="organization" />}
      </FormField>
      <FormField<T> name={path("line1")} label="Address line 1" required disabled={disabled}>
        {(c) => <TextField {...c} maxLength={200} autoComplete="address-line1" />}
      </FormField>
      <FormField<T> name={path("line2")} label="Address line 2" disabled={disabled}>
        {(c) => <TextField {...c} maxLength={200} autoComplete="address-line2" />}
      </FormField>
      <FormField<T> name={path("country")} label="Country" required disabled={disabled}>
        {(c) => (
          <Combobox
            id={c.id}
            aria-label="Country"
            options={COUNTRY_OPTIONS}
            value={(c.value as string | null) ?? null}
            invalid={c.invalid}
            disabled={c.disabled}
            onBlur={c.onBlur}
            onChange={(v) => {
              c.onChange(v ?? "");
              setValue(path("state"), "" as never, { shouldDirty: true });
            }}
          />
        )}
      </FormField>
      <FormField<T> name={path("city")} label="City" required disabled={disabled}>
        {(c) => <TextField {...c} maxLength={100} autoComplete="address-level2" />}
      </FormField>
      <FormField<T> name={path("state")} label={stateLabel} required={requiresRegion} disabled={disabled}>
        {(c) =>
          requiresRegion ? (
            <Combobox id={c.id} aria-label={stateLabel} options={stateOptions} value={(c.value as string | null) || null} invalid={c.invalid} disabled={c.disabled} onBlur={c.onBlur} onChange={(v) => c.onChange(v ?? "")} />
          ) : (
            <TextField {...c} maxLength={100} autoComplete="address-level1" />
          )
        }
      </FormField>
      <FormField<T> name={path("postalCode")} label={postalLabel} required={country === "US" || country === "CA"} disabled={disabled}>
        {(c) => (
          <TextField
            {...c}
            maxLength={20}
            autoComplete="postal-code"
            onBlur={() => {
              const current = getValues(path("postalCode")) as unknown;
              if (typeof current === "string" && country) setValue(path("postalCode"), normalizePostal(country, current) as never, { shouldValidate: true });
              c.onBlur();
            }}
          />
        )}
      </FormField>
      <FormField<T> name={path("addressType")} label="Address type" disabled={disabled}>
        {(c) => <Select id={c.id} aria-label="Address type" options={ADDRESS_TYPE_OPTIONS} value={(c.value as string | null) ?? null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} disabled={c.disabled} />}
      </FormField>
      {showContact ? (
        <>
          <FormField<T> name={path("phone")} label="Phone" disabled={disabled}>
            {(c) => <TextField {...c} type="tel" maxLength={40} autoComplete="tel" />}
          </FormField>
          <FormField<T> name={path("email")} label="Email" disabled={disabled}>
            {(c) => <TextField {...c} type="email" maxLength={200} autoComplete="email" />}
          </FormField>
        </>
      ) : null}
      {showTax ? (
        <>
          <FormField<T> name={path("taxType")} label="Tax type" disabled={disabled}>
            {(c) => <Select id={c.id} aria-label="Tax type" clearable options={TAX_TYPE_OPTIONS} value={(c.value as string | null) ?? null} onChange={(v) => c.onChange(v)} onBlur={c.onBlur} invalid={c.invalid} disabled={c.disabled} />}
          </FormField>
          <FormField<T> name={path("taxId")} label="Tax ID" disabled={disabled}>
            {(c) => <TextField {...c} maxLength={60} />}
          </FormField>
        </>
      ) : null}
    </FormGrid>
  );
}
