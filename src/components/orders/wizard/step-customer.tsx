"use client";

/**
 * Step 2 — Customer & address: New / existing customer (3-char search) with prefill,
 * contact, ship-to address with Verify Address (normalizes "Arkansas -> AR", merges
 * line 2), and billing (same as shipment / new address).
 */
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { BadgeCheck, MapPinCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { countryOptions, subdivisionsFor } from "@/lib/countries";
import { ADDRESS_TYPES, TAX_TYPES } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormGrid, FormGridFull, FormSection } from "@/components/ui/form";
import { RadioCards } from "@/components/ui/radio-cards";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DisabledReason } from "@/components/ui/tooltip";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { CustomerPrefill } from "@/server/repositories/orders-wizard";
import { errorMessage } from "../orders-client";
import { ComboF, SelectF, TextF, YesNoF } from "./fields";
import { ADDRESS_KEYS, ADDRESS_LINE_MAX, countryCodeOf, countryNameOf, POSTAL_MAX, type AddressStatus, type OrderFormValues } from "./order-form-model";
import { useOrderWizard } from "./order-wizard-context";

const COUNTRY_OPTIONS = countryOptions().map((o) => ({ value: o.value, label: o.label }));
const ADDRESS_TYPE_OPTIONS = ADDRESS_TYPES.map((t) => ({ value: t, label: t }));
const TAX_TYPE_OPTIONS = TAX_TYPES.map((t) => ({ value: t, label: t }));
const NEW_CUSTOMER = { value: "__new", label: "New", description: "Enter a one-time customer" };

interface AddressCheckResult {
  readonly status: AddressStatus;
  readonly notes: readonly string[];
  readonly normalized: { readonly line1: string; readonly line2: string | null; readonly city: string; readonly state: string | null; readonly postalCode: string; readonly country: string };
}

function StateField({ name, countryName, disabled }: { readonly name: "shipState" | "billing.state"; readonly countryName: "shipCountry" | "billing.country"; readonly disabled?: boolean }) {
  const { control } = useFormContext<OrderFormValues>();
  const country = useWatch({ control, name: countryName }) as string;
  const subs = subdivisionsFor(country);
  if (subs.length === 0) return <TextF name={name} label="State / region" maxLength={100} disabled={disabled} />;
  return <ComboF name={name} label={country === "CA" ? "Province" : "State"} required options={subs.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} disabled={disabled} placeholder="Select state" />;
}

const STATUS_COPY: Readonly<Record<AddressStatus, { title: string; variant: "success" | "attention" | "error" | "info" }>> = {
  Verified: { title: "Address verified", variant: "success" },
  Corrected: { title: "Address verified and corrected", variant: "success" },
  Unverified: { title: "Address not verified yet", variant: "attention" },
  Invalid: { title: "Address could not be verified", variant: "error" },
  Skipped: { title: "Address verification skipped", variant: "info" },
};

function useAddressVerification() {
  const { getValues, setValue, control } = useFormContext<OrderFormValues>();
  const [busy, setBusy] = React.useState(false);
  const watched = useWatch({ control, name: [...ADDRESS_KEYS] });
  const lastVerified = React.useRef<string | null>(null);
  const signature = JSON.stringify(watched);

  /* Any edit after a verification puts the address back to Unverified. */
  React.useEffect(() => {
    if (lastVerified.current === null) {
      lastVerified.current = signature;
      return;
    }
    if (lastVerified.current !== signature && ["Verified", "Corrected", "Invalid"].includes(getValues("addressStatus"))) {
      setValue("addressStatus", "Unverified");
      setValue("addressNotes", []);
    }
  }, [signature, getValues, setValue]);

  const verify = async () => {
    const v = getValues();
    setBusy(true);
    try {
      const res = await apiFetch<AddressCheckResult>("/api/orders/verify-address", {
        method: "POST",
        body: { line1: v.shipAddress, line2: v.shipAddress2 || null, city: v.shipCity, state: v.shipState || null, postalCode: v.shipZip, country: countryNameOf(v.shipCountry) },
      });
      const n = res.normalized;
      const opts = { shouldDirty: true, shouldValidate: true } as const;
      setValue("shipAddress", n.line1, opts);
      setValue("shipAddress2", n.line2 ?? "", opts);
      setValue("shipCity", n.city, opts);
      setValue("shipZip", n.postalCode, opts);
      setValue("shipCountry", countryCodeOf(n.country), opts);
      if (n.state) setValue("shipState", n.state, opts);
      setValue("addressStatus", res.status, { shouldDirty: true });
      setValue("addressNotes", [...res.notes]);
      lastVerified.current = JSON.stringify(ADDRESS_KEYS.map((k) => getValues(k)));
      if (res.status === "Invalid") toast.warning("Address could not be verified", res.notes[0] ?? "Check the street, city and postal code.");
      else toast.success("Address verified", res.notes[0] ?? "The ship-to address is valid.");
    } catch (error) {
      toast.error("Verification failed", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, verify };
}

interface CustomerSearchItem {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/** "No customers match …" row: the list always starts with New, so the plain empty text would never show. */
export function noCustomerMatch(q: string): ComboboxOption {
  return { value: "__none", label: `No customers match "${q.trim()}"`, description: "Keep New to enter a one-time customer", disabled: true };
}

/** New + saved customers + one-time customers from this client's previous orders (`/api/orders/customer-search`). */
async function loadCustomerOptions(clientId: string, q: string, signal: AbortSignal): Promise<readonly ComboboxOption[]> {
  if (!clientId) return [NEW_CUSTOMER];
  const res = await apiFetch<{ items: readonly CustomerSearchItem[] }>("/api/orders/customer-search", { query: { clientId, q }, signal });
  const items = res.items.map((i) => ({ value: i.value, label: i.label, description: i.description }));
  return items.length > 0 ? [NEW_CUSTOMER, ...items] : [NEW_CUSTOMER, noCustomerMatch(q)];
}

function CustomerPicker({ disabled }: { readonly disabled: boolean }) {
  const { control, setValue } = useFormContext<OrderFormValues>();
  const clientId = useWatch({ control, name: "clientId" });
  const customerId = useWatch({ control, name: "customerId" });
  const [prefill, setPrefill] = React.useState<CustomerPrefill | null>(null);
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null);

  const load = React.useCallback((q: string, signal: AbortSignal) => loadCustomerOptions(clientId, q, signal), [clientId]);

  React.useEffect(() => {
    if (!customerId) {
      setPrefill(null);
      return;
    }
    let live = true;
    apiFetch<CustomerPrefill>("/api/orders/customer-prefill", { query: { customerId } })
      .then((res) => {
        if (!live) return;
        setPrefill(res);
        setSelectedLabel(`${res.firstName} ${res.lastName}`.trim());
      })
      .catch(() => live && setPrefill(null));
    return () => {
      live = false;
    };
  }, [customerId]);

  const applyCustomer = (res: CustomerPrefill) => {
    const opts = { shouldDirty: true, shouldValidate: true } as const;
    setValue("customerFirstName", res.firstName, opts);
    setValue("customerLastName", res.lastName, opts);
    setValue("customerEmail", res.email, opts);
    setValue("customerPhone", res.phone, opts);
    const preferred = res.addresses.find((a) => a.usageType === "Shipping" && a.isDefault) ?? res.addresses.find((a) => a.usageType === "Shipping");
    if (preferred) applyAddress(preferred.id, res);
  };

  const applyAddress = (id: string, source: CustomerPrefill | null = prefill) => {
    const a = source?.addresses.find((x) => x.id === id);
    if (!a) return;
    const opts = { shouldDirty: true, shouldValidate: true } as const;
    setValue("shipAddress", a.line1, opts);
    setValue("shipAddress2", a.line2 ?? "", opts);
    setValue("shipCity", a.city, opts);
    setValue("shipZip", a.postalCode, opts);
    setValue("shipCountry", countryCodeOf(a.country), opts);
    setValue("shipState", a.state ?? "", opts);
    if (a.companyName) setValue("companyName", a.companyName, opts);
    if (a.addressType) setValue("addressType", a.addressType, opts);
    setValue("addressStatus", "Unverified");
  };

  const titles = (prefill?.addresses ?? []).map((a) => ({ value: a.id, label: a.title, description: `${a.usageType} · ${a.line1}, ${a.city}` }));
  return (
    <FormGrid columns={2}>
      <ComboF
        name="customerId"
        label="Customer"
        disabled={disabled || !clientId}
        description={!clientId ? "Choose a client in Step 1 to search its customers." : "New, or search saved customers and customers from this client's orders (at least 3 characters)."}
        loadOptions={load}
        minChars={3}
        selectedOptions={customerId && selectedLabel ? [{ value: customerId, label: selectedLabel }] : [NEW_CUSTOMER]}
        placeholder="New"
        clearable
        onValue={(v, option) => {
          if (!v || v === NEW_CUSTOMER.value || v.startsWith("__")) {
            setValue("customerId", null, { shouldDirty: true });
            return;
          }
          setSelectedLabel(option?.label ?? null);
          void apiFetch<CustomerPrefill>("/api/orders/customer-prefill", { query: { customerId: v } }).then((res) => {
            setPrefill(res);
            applyCustomer(res);
            toast.success("Customer selected", `${res.firstName} ${res.lastName} details were filled in.`);
          }).catch((error: unknown) => toast.error("Couldn't load the customer", errorMessage(error)));
        }}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-body">Address title</span>
        <DisabledReason reason={!customerId ? "Choose an existing customer to use a saved address" : titles.length === 0 ? "This customer has no saved addresses" : null}>
          <span>
            <Select aria-label="Address title" options={titles} value={null} onChange={(v) => v && applyAddress(v)} disabled={disabled || !customerId || titles.length === 0} placeholder="Select a saved address" />
          </span>
        </DisabledReason>
      </div>
    </FormGrid>
  );
}

export function StepCustomer() {
  const { locks } = useOrderWizard();
  const { control, setValue } = useFormContext<OrderFormValues>();
  const lock = Boolean(locks.header);
  const useShipAsBilling = useWatch({ control, name: "useShipAsBilling" });
  const skip = useWatch({ control, name: "skipAddressVerification" });
  const status = useWatch({ control, name: "addressStatus" });
  const notes = useWatch({ control, name: "addressNotes" });
  const line1 = useWatch({ control, name: "shipAddress" });
  const { busy, verify } = useAddressVerification();
  const shown: AddressStatus = skip ? "Skipped" : status === "Skipped" ? "Unverified" : status;
  const copy = STATUS_COPY[shown];

  return (
    <div className="flex flex-col gap-6">
      <FormSection title="Customer" description="Pick an existing customer to prefill the contact and address, or keep New.">
        <div className="flex flex-col gap-3.5">
          <CustomerPicker disabled={lock} />
          <FormGrid columns={2}>
            <TextF name="customerFirstName" label="First name" maxLength={100} disabled={lock} />
            <TextF name="customerLastName" label="Last name" maxLength={100} disabled={lock} />
            <TextF name="customerEmail" label="Customer email" placeholder="example@email.com" maxLength={200} disabled={lock} />
            <TextF name="customerPhone" label="Phone number" maxLength={50} disabled={lock} />
          </FormGrid>
        </div>
      </FormSection>

      <FormSection
        title="Shipment address"
        description="Where the order ships. Verify it before picking to avoid carrier address corrections."
        action={
          <DisabledReason reason={lock ? locks.header : skip ? "Verification is skipped for this order" : !line1?.trim() ? "Enter the address first" : null}>
            <Button variant="secondary" size="sm" onClick={() => void verify()} disabled={busy || lock || skip || !line1?.trim()}>
              {busy ? <Spinner className="h-3.5 w-3.5" label="Verifying" /> : <MapPinCheck className="h-3.5 w-3.5" aria-hidden />}
              Verify address
            </Button>
          </DisabledReason>
        }
      >
        <div className="flex flex-col gap-3.5">
          <Callout variant={copy.variant} title={copy.title}>
            {shown === "Skipped" ? "The address is saved exactly as entered." : notes?.length ? notes.join(" · ") : shown === "Unverified" ? "Press Verify address to normalize the state and merge line 2." : "No corrections were needed."}
          </Callout>
          <FormGrid columns={3}>
            <YesNoF
              name="skipAddressVerification"
              label="Skip address verification"
              disabled={lock}
              info="Yes saves the address exactly as entered. No verifies it on save and flags problems."
              onValue={(v) => setValue("addressStatus", v ? "Skipped" : "Unverified")}
            />
            <SelectF name="addressType" label="Address type" options={ADDRESS_TYPE_OPTIONS} disabled={lock} clearable info="Residential and commercial addresses get different carrier rates. Military covers APO / FPO / DPO." />
            <TextF name="companyName" label="Company name" maxLength={200} disabled={lock} />
            <FormGridFull>
              <FormGrid columns={2}>
                <TextF name="shipAddress" label="Address line 1" required maxLength={ADDRESS_LINE_MAX} disabled={lock} />
                <TextF name="shipAddress2" label="Address line 2" maxLength={ADDRESS_LINE_MAX} disabled={lock} />
              </FormGrid>
            </FormGridFull>
            <ComboF name="shipCountry" label="Country" required options={COUNTRY_OPTIONS} disabled={lock} onValue={() => setValue("shipState", "", { shouldDirty: true })} />
            <StateField name="shipState" countryName="shipCountry" disabled={lock} />
            <TextF name="shipCity" label="City" required maxLength={100} disabled={lock} />
            <TextF name="shipZip" label="Postal code" required maxLength={POSTAL_MAX} disabled={lock} />
            <SelectF name="taxType" label="Tax type" options={TAX_TYPE_OPTIONS} clearable disabled={lock} />
            <TextF name="taxId" label="Tax ID" maxLength={100} disabled={lock} />
          </FormGrid>
        </div>
      </FormSection>

      <FormSection title="Billing address">
        <div className="flex flex-col gap-3.5">
          <RadioCards
            columns={2}
            ariaLabel="Billing address"
            value={useShipAsBilling ? "same" : "new"}
            onChange={(v) => setValue("useShipAsBilling", v === "same", { shouldDirty: true })}
            options={[
              { value: "same", title: "Use shipment address as billing address", icon: BadgeCheck, disabled: lock },
              { value: "new", title: "Enter a new address for the billing", disabled: lock },
            ]}
          />
          {!useShipAsBilling ? (
            <FormGrid columns={3}>
              <TextF name="billing.firstName" label="Billing first name" maxLength={100} disabled={lock} />
              <TextF name="billing.lastName" label="Billing last name" maxLength={100} disabled={lock} />
              <TextF name="billing.companyName" label="Billing company name" maxLength={200} disabled={lock} />
              <TextF name="billing.email" label="Billing email" placeholder="example@email.com" maxLength={200} disabled={lock} />
              <TextF name="billing.phone" label="Billing phone number" maxLength={50} disabled={lock} />
              <span className="hidden xl:block" aria-hidden />
              <TextF name="billing.line1" label="Billing address line 1" required maxLength={ADDRESS_LINE_MAX} disabled={lock} />
              <TextF name="billing.line2" label="Billing address line 2" maxLength={ADDRESS_LINE_MAX} disabled={lock} />
              <TextF name="billing.city" label="City" required maxLength={100} disabled={lock} />
              <ComboF name="billing.country" label="Country" required options={COUNTRY_OPTIONS} disabled={lock} onValue={() => setValue("billing.state", "", { shouldDirty: true })} />
              <StateField name="billing.state" countryName="billing.country" disabled={lock} />
              <TextF name="billing.postalCode" label="Postal code" maxLength={POSTAL_MAX} disabled={lock} />
            </FormGrid>
          ) : null}
        </div>
      </FormSection>
    </div>
  );
}
