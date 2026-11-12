/**
 * Shipment order wizard model (PURE, unit-tested): form values, per-step zod schemas,
 * defaults, detail -> values (edit) and values -> API body (create / PATCH diff).
 *
 * Countries are ISO codes in the form (country / state pickers) and country names on
 * the server (`shipCountry = "United States"`); the mapping lives here.
 */
import { z } from 'zod';
import { COUNTRIES, countryName, subdivisionsFor } from '@/lib/countries';
import { ADDRESS_TYPES, BILLING_PARTY_TYPES, EXPORT_REASONS, TAX_TYPES } from '@/lib/enums';
import type { OrderDetail } from '@/server/repositories/orders';
import { effectiveRank, priorityFromRank } from '@/lib/grid-defs/orders/priority';

export const ORDER_CODE_MAX = 50;
export const NOTE_MAX = 500;
export const PACKING_INSTRUCTIONS_MAX = 1000;
export const ADDRESS_LINE_MAX = 256;
export const POSTAL_MAX = 10;

export type AddressStatus = 'Unverified' | 'Verified' | 'Corrected' | 'Invalid' | 'Skipped';

export interface OrderLineValue {
  /** Stable client key (line id when saved). */
  readonly key: string;
  readonly id: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly isKit: boolean;
  readonly uom: string;
  readonly packType: string;
  readonly uomRatio: number;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly weightOz: number;
  readonly atp: number | null;
  readonly allocatedQuantity: number;
  readonly cancelledQuantity: number;
  readonly sortedQuantity: number;
  readonly pickedQuantity: number;
  readonly packedQuantity: number;
  readonly shippedQuantity: number;
  readonly loadedQuantity: number;
  readonly lotNumber: string;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly damageReason: string | null;
  readonly pinnedLocationId: string | null;
  readonly pinnedLocationCode: string | null;
  readonly pinnedLpId: string | null;
  readonly pinnedLpCode: string | null;
  readonly lineNote1: string;
  readonly lineNote2: string;
  readonly lineNote3: string;
  readonly kitSku: string | null;
  readonly originalOrderCode: string | null;
  readonly storeUpdateNotes: string | null;
  readonly isStoreUpdated: boolean;
}

export interface BillingValue {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  state: string;
  companyName: string;
}

export interface OrderFormValues {
  /* Step 1 — order details */
  warehouseId: string;
  clientId: string;
  code: string;
  codeTaken: boolean;
  /** Last sequence code the server suggested; when `code` still equals it the server assigns the code at save. */
  codeSuggested: string;
  orderTypeId: string;
  orderTypeName: string;
  orderDate: string | null;
  expectedShipDate: string | null;
  expectedDeliveryDate: string | null;
  carrierExpectedDeliveryDate: string | null;
  scheduledPickupDate: string | null;
  scheduledShipmentDate: string | null;
  note: string;
  priorityRank: number;
  storeOrderNumber: string;
  /* Step 2 — customer & address */
  customerId: string | null;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone: string;
  skipAddressVerification: boolean;
  addressType: string | null;
  shipAddress: string;
  shipAddress2: string;
  shipZip: string;
  shipCity: string;
  shipCountry: string;
  shipState: string;
  companyName: string;
  taxType: string | null;
  taxId: string;
  addressStatus: AddressStatus;
  addressNotes: readonly string[];
  useShipAsBilling: boolean;
  billing: BillingValue;
  /* Step 3 — products */
  lines: OrderLineValue[];
  /* Step 4 — shipping */
  carrierConnectionId: string | null;
  carrierServiceId: string | null;
  rateShoppingPresetId: string | null;
  shippingChargesBillingType: string | null;
  taxDutiesBillingType: string | null;
  useCustomShippingAccount: boolean;
  shippingAccountNumber: string;
  useCustomTaxAccount: boolean;
  taxDutiesAccountNumber: string;
  packingInstructions: string;
  shipmentPackageId: string | null;
  totalShippingCost: number | null;
  trackingNumber: string;
  trackingNumbers: string[];
  reasonForExport: string | null;
  returnAddressId: string | null;
  returnCarrierConnectionId: string | null;
  returnCarrierServiceId: string | null;
  returnShippingCost: number | null;
  returnTrackingNumbers: string[];
  /* Step 5 — other info */
  extraNote1: string;
  extraNote2: string;
  extraNote3: string;
  extraNote4: string;
  extraNote5: string;
  clientReferenceCode: string;
  fraud: string;
  packingWarningTypeId: string | null;
  isGift: boolean;
  giftNote: string;
  orderCodeGroupingRef: string;
  retailerId: string | null;
  bol: string;
  pro: string;
  retailerPo: string;
  dept: string;
  markFor: string;
  retailerCustomerAccount: string;
  customFields: Record<string, string | boolean | null>;
  discount: number;
}

export const EMPTY_BILLING: BillingValue = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  line1: '',
  line2: '',
  postalCode: '',
  city: '',
  country: 'US',
  state: '',
  companyName: '',
};

export function defaultOrderValues(now: Date = new Date()): OrderFormValues {
  const iso = now.toISOString();
  return {
    warehouseId: '',
    clientId: '',
    code: '',
    codeTaken: false,
    codeSuggested: '',
    orderTypeId: '',
    orderTypeName: '',
    orderDate: iso,
    expectedShipDate: iso,
    expectedDeliveryDate: null,
    carrierExpectedDeliveryDate: null,
    scheduledPickupDate: null,
    scheduledShipmentDate: null,
    note: '',
    priorityRank: 0,
    storeOrderNumber: '',
    customerId: null,
    customerFirstName: '',
    customerLastName: '',
    customerEmail: '',
    customerPhone: '',
    skipAddressVerification: false,
    addressType: 'Residential',
    shipAddress: '',
    shipAddress2: '',
    shipZip: '',
    shipCity: '',
    shipCountry: 'US',
    shipState: '',
    companyName: '',
    taxType: null,
    taxId: '',
    addressStatus: 'Unverified',
    addressNotes: [],
    useShipAsBilling: true,
    billing: { ...EMPTY_BILLING },
    lines: [],
    carrierConnectionId: null,
    carrierServiceId: null,
    rateShoppingPresetId: null,
    shippingChargesBillingType: null,
    taxDutiesBillingType: null,
    useCustomShippingAccount: false,
    shippingAccountNumber: '',
    useCustomTaxAccount: false,
    taxDutiesAccountNumber: '',
    packingInstructions: '',
    shipmentPackageId: null,
    totalShippingCost: null,
    trackingNumber: '',
    trackingNumbers: [],
    reasonForExport: 'Sale',
    returnAddressId: null,
    returnCarrierConnectionId: null,
    returnCarrierServiceId: null,
    returnShippingCost: null,
    returnTrackingNumbers: [],
    extraNote1: '',
    extraNote2: '',
    extraNote3: '',
    extraNote4: '',
    extraNote5: '',
    clientReferenceCode: '',
    fraud: '',
    packingWarningTypeId: null,
    isGift: false,
    giftNote: '',
    orderCodeGroupingRef: '',
    retailerId: null,
    bol: '',
    pro: '',
    retailerPo: '',
    dept: '',
    markFor: '',
    retailerCustomerAccount: '',
    customFields: {},
    discount: 0,
  };
}

/* ------------------------------------------------------------- countries */

const BY_NAME = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]));
const US_NAMES = new Set(['us', 'usa', 'united states', 'united states of america']);

/** "United States" / "US" / "usa" -> "US"; unknown names pass through. */
export function countryCodeOf(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return 'US';
  if (US_NAMES.has(v.toLowerCase())) return 'US';
  if (v.length === 2 && COUNTRIES.some((c) => c.code === v.toUpperCase())) return v.toUpperCase();
  return BY_NAME.get(v.toLowerCase()) ?? v;
}

/** "US" -> "United States" (server form). */
export function countryNameOf(code: string): string {
  return countryName(code) || code;
}

/* -------------------------------------------------------------- schemas */

const text = (max: number, label = 'This field') =>
  z.string().max(max, `${label} can be at most ${max} characters`);
const required = (label: string, max = 200) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `At most ${max} characters`);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email (example@email.com)');

export const detailsStepSchema = z
  .object({
    warehouseId: z.string().min(1, 'Choose a warehouse'),
    clientId: z.string().min(1, 'Choose a client'),
    code: required('an order code', ORDER_CODE_MAX).refine(
      (v) => !/\s/.test(v),
      "Order codes can't contain spaces",
    ),
    codeTaken: z.boolean(),
    orderTypeId: z.string().min(1, 'Choose an order type'),
    orderDate: z.string({ error: 'Choose the order date' }).min(1, 'Choose the order date'),
    expectedShipDate: z
      .string({ error: 'Choose the expected shipment date' })
      .min(1, 'Choose the expected shipment date'),
    note: text(NOTE_MAX, 'Note'),
    priorityRank: z.number().int().min(0, "Priority can't be negative").max(9999),
    storeOrderNumber: text(100, 'Store order #'),
  })
  .superRefine((v, ctx) => {
    if (v.codeTaken)
      ctx.addIssue({ code: 'custom', path: ['code'], message: `Order code ${v.code} is already taken` });
  });

function requireRegion(
  country: string,
  state: string,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  const list = subdivisionsFor(country);
  if (list.length > 0 && !list.some((s) => s.code === state))
    ctx.addIssue({
      code: 'custom',
      path,
      message: country === 'CA' ? 'Choose a province' : 'Choose a state',
    });
}

function postalIssue(country: string, postal: string): string | null {
  const v = postal.trim();
  if (!v) return 'Enter a postal code';
  if (country === 'US' && !/^\d{5}(-\d{4})?$/.test(v)) return 'Use a 5-digit ZIP or ZIP+4';
  return null;
}

export const customerStepSchema = z
  .object({
    customerFirstName: text(100, 'First name'),
    customerLastName: text(100, 'Last name'),
    customerEmail: optionalEmail,
    customerPhone: text(50, 'Phone'),
    shipAddress: required('address line 1', ADDRESS_LINE_MAX),
    shipAddress2: text(ADDRESS_LINE_MAX, 'Address line 2'),
    shipCity: required('a city', 100),
    shipCountry: z.string().min(1, 'Choose a country'),
    shipState: z.string(),
    shipZip: z.string().max(POSTAL_MAX, `Postal code can be at most ${POSTAL_MAX} characters`),
    companyName: text(200, 'Company name'),
    taxType: z.enum(TAX_TYPES).nullable(),
    taxId: text(100, 'Tax ID'),
    addressType: z.enum(ADDRESS_TYPES).nullable(),
    useShipAsBilling: z.boolean(),
    billing: z.object({
      firstName: text(100),
      lastName: text(100),
      email: optionalEmail,
      phone: text(50),
      line1: text(ADDRESS_LINE_MAX),
      line2: text(ADDRESS_LINE_MAX),
      postalCode: text(POSTAL_MAX),
      city: text(100),
      country: z.string(),
      state: z.string(),
      companyName: text(200),
    }),
  })
  .superRefine((v, ctx) => {
    if (!v.customerFirstName.trim() && !v.customerLastName.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['customerFirstName'],
        message: "Enter the customer's first or last name",
      });
    requireRegion(v.shipCountry, v.shipState, ['shipState'], ctx);
    const postal = postalIssue(v.shipCountry, v.shipZip);
    if (postal) ctx.addIssue({ code: 'custom', path: ['shipZip'], message: postal });
    if (v.taxId.trim() && !v.taxType)
      ctx.addIssue({ code: 'custom', path: ['taxType'], message: 'Choose the tax type for this ID' });
    if (!v.useShipAsBilling) {
      if (!v.billing.line1.trim())
        ctx.addIssue({ code: 'custom', path: ['billing', 'line1'], message: 'Enter billing address line 1' });
      if (!v.billing.city.trim())
        ctx.addIssue({ code: 'custom', path: ['billing', 'city'], message: 'Enter a billing city' });
      if (!v.billing.country)
        ctx.addIssue({ code: 'custom', path: ['billing', 'country'], message: 'Choose a billing country' });
      else requireRegion(v.billing.country, v.billing.state, ['billing', 'state'], ctx);
    }
  });

export const productsStepSchema = z.object({
  lines: z
    .array(
      z
        .object({
          quantity: z.number().int().positive('Quantity must be at least 1'),
          unitPrice: z.number().min(0, "Price can't be negative"),
        })
        .loose(),
    )
    .min(1, 'Add at least one product to the order'),
});

export const shippingStepSchema = z.object({
  packingInstructions: text(PACKING_INSTRUCTIONS_MAX, 'Packing instructions'),
  shippingAccountNumber: text(100, 'Account number'),
  taxDutiesAccountNumber: text(100, 'Account number'),
  trackingNumber: text(100, 'Tracking number'),
  totalShippingCost: z.number().min(0, "Cost can't be negative").nullable(),
  returnShippingCost: z.number().min(0, "Cost can't be negative").nullable(),
  shippingChargesBillingType: z.enum(BILLING_PARTY_TYPES).nullable(),
  taxDutiesBillingType: z.enum(BILLING_PARTY_TYPES).nullable(),
  reasonForExport: z.enum(EXPORT_REASONS).nullable(),
});

export const otherStepSchema = z.object({
  extraNote1: text(NOTE_MAX, 'Extra note'),
  extraNote2: text(NOTE_MAX, 'Extra note 2'),
  extraNote3: text(NOTE_MAX, 'Extra note 3'),
  extraNote4: text(NOTE_MAX, 'Extra note 4'),
  extraNote5: text(NOTE_MAX, 'Extra note 5'),
  clientReferenceCode: text(100, 'Client reference code'),
  fraud: text(NOTE_MAX, 'Fraud'),
  isGift: z.boolean(),
  giftNote: text(NOTE_MAX, 'Gift note'),
  bol: text(100, 'BOL'),
  pro: text(100, 'PRO'),
  retailerPo: text(100, 'PO'),
  dept: text(100, 'Dept'),
  markFor: text(200, 'Mark for'),
  retailerCustomerAccount: text(100, 'Customer account number'),
});

/* --------------------------------------------------------------- totals */

export interface OrderTotals {
  readonly skuCount: number;
  readonly kitCount: number;
  readonly totalQuantity: number;
  readonly price: number;
  readonly discount: number;
  readonly total: number;
  readonly weightOz: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function orderTotals(
  lines: readonly Pick<OrderLineValue, 'productId' | 'isKit' | 'quantity' | 'unitPrice' | 'weightOz'>[],
  discount = 0,
): OrderTotals {
  const price = round2(lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0));
  return {
    skuCount: new Set(lines.map((l) => l.productId)).size,
    kitCount: lines.filter((l) => l.isKit).length,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    price,
    discount: round2(discount),
    total: round2(Math.max(0, price - discount)),
    weightOz: round2(lines.reduce((sum, l) => sum + l.quantity * l.weightOz, 0)),
  };
}

/** Logiwa's numeric priority mapped onto the KitStaks priority flag (one model: `grid-defs/orders/priority`). */
export { priorityFromRank };

export function rankFromPriority(priority: string, rank: number): number {
  return effectiveRank(priority, rank);
}

/* --------------------------------------------------------- detail -> form */

const s = (v: string | null | undefined): string => v ?? '';

export function lineFromDetail(l: OrderDetail['lines'][number]): OrderLineValue {
  return {
    key: l.id,
    id: l.id,
    productId: l.productId,
    sku: l.sku,
    name: l.productName,
    imageUrl: l.imageUrl,
    isKit: l.isKit,
    uom: l.uom,
    packType: l.packType,
    uomRatio: l.uomRatio,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    weightOz: l.weightOz,
    atp: l.atp,
    allocatedQuantity: l.allocatedQuantity,
    cancelledQuantity: l.cancelledQuantity,
    sortedQuantity: l.sortedQuantity,
    pickedQuantity: l.pickedQuantity,
    packedQuantity: l.packedQuantity,
    shippedQuantity: l.shippedQuantity,
    loadedQuantity: l.loadedQuantity,
    lotNumber: s(l.lotNumber),
    expiryDate: l.expiryDate,
    productionDate: l.productionDate,
    damageReason: l.damageReason,
    pinnedLocationId: l.pinnedLocationId,
    pinnedLocationCode: l.pinnedLocationCode,
    pinnedLpId: l.pinnedLpId,
    pinnedLpCode: l.pinnedLpCode,
    lineNote1: s(l.lineNote1),
    lineNote2: s(l.lineNote2),
    lineNote3: s(l.lineNote3),
    kitSku: l.kitSku,
    originalOrderCode: l.originalOrderCode,
    storeUpdateNotes: l.storeUpdateNotes,
    isStoreUpdated: l.isStoreUpdated,
  };
}

export function valuesFromDetail(detail: OrderDetail): OrderFormValues {
  const o = detail.order;
  const b = (o.billingAddress ?? {}) as Partial<Record<string, string | null>>;
  const [first, ...rest] = (o.customerName ?? '').split(' ');
  return {
    ...defaultOrderValues(),
    warehouseId: o.warehouseId,
    clientId: o.clientId,
    code: o.code,
    codeTaken: false,
    codeSuggested: '',
    orderTypeId: o.orderTypeId ?? detail.orderTypeLookupId ?? '',
    orderTypeName: detail.orderTypeName,
    orderDate: o.orderDate,
    expectedShipDate: o.expectedShipDate ?? o.orderDate,
    expectedDeliveryDate: o.expectedDeliveryDate,
    carrierExpectedDeliveryDate: o.carrierExpectedDeliveryDate,
    scheduledPickupDate: o.scheduledPickupDate,
    scheduledShipmentDate: o.scheduledShipmentDate,
    note: s(o.note),
    priorityRank: rankFromPriority(o.priority, o.priorityRank),
    storeOrderNumber: s(o.storeOrderNumber),
    customerId: o.customerId,
    customerFirstName: o.customerFirstName ?? first ?? '',
    customerLastName: o.customerLastName ?? rest.join(' '),
    customerEmail: s(o.customerEmail),
    customerPhone: s(o.customerPhone),
    skipAddressVerification: o.skipAddressVerification,
    addressType: o.addressType,
    shipAddress: o.shipAddress,
    shipAddress2: s(o.shipAddress2),
    shipZip: o.shipZip,
    shipCity: o.shipCity,
    shipCountry: countryCodeOf(o.shipCountry),
    shipState: o.shipState,
    companyName: s(o.companyName),
    taxType: o.taxType,
    taxId: s(o.taxId),
    addressStatus: o.addressVerificationStatus as AddressStatus,
    addressNotes: o.addressVerificationNotes ?? [],
    useShipAsBilling: o.useShipAsBilling,
    billing: {
      firstName: s(b.firstName),
      lastName: s(b.lastName),
      email: s(b.email),
      phone: s(b.phone),
      line1: s(b.line1),
      line2: s(b.line2),
      postalCode: s(b.postalCode),
      city: s(b.city),
      country: countryCodeOf(b.country),
      state: s(b.state),
      companyName: s(b.companyName),
    },
    lines: detail.lines.map(lineFromDetail),
    carrierConnectionId: o.carrierConnectionId,
    carrierServiceId: o.carrierServiceId,
    rateShoppingPresetId: o.rateShoppingPresetId,
    shippingChargesBillingType: o.shippingChargesBillingType,
    taxDutiesBillingType: o.taxDutiesBillingType,
    useCustomShippingAccount: Boolean(o.shippingAccountNumber),
    shippingAccountNumber: s(o.shippingAccountNumber),
    useCustomTaxAccount: Boolean(o.taxDutiesAccountNumber),
    taxDutiesAccountNumber: s(o.taxDutiesAccountNumber),
    packingInstructions: s(o.packingInstructions),
    shipmentPackageId: o.shipmentPackageId,
    totalShippingCost: o.totalShippingCost || null,
    trackingNumber: s(o.trackingNumber),
    trackingNumbers: [...(o.trackingNumbers ?? [])],
    reasonForExport: o.reasonForExport,
    returnAddressId: o.returnAddressId,
    returnCarrierConnectionId: null,
    returnCarrierServiceId: o.returnCarrierServiceId,
    returnShippingCost: o.returnShippingCost,
    returnTrackingNumbers: [...(o.returnTrackingNumbers ?? [])],
    extraNote1: s(o.extraNote1),
    extraNote2: s(o.extraNote2),
    extraNote3: s(o.extraNote3),
    extraNote4: s(o.extraNote4),
    extraNote5: s(o.extraNote5),
    clientReferenceCode: s(o.clientReferenceCode),
    fraud: s(o.fraud),
    packingWarningTypeId: o.packingWarningTypeId,
    isGift: o.isGift,
    giftNote: s(o.giftNote),
    orderCodeGroupingRef: s(o.orderCodeGroupingRef),
    retailerId: o.retailerId,
    bol: s(o.bol),
    pro: s(o.pro),
    retailerPo: s(o.retailerPo),
    dept: s(o.dept),
    markFor: s(o.markFor),
    retailerCustomerAccount: s(o.retailerCustomerAccount),
    customFields: { ...(o.customFields ?? {}) } as Record<string, string | boolean | null>,
    discount: o.discount,
  };
}

/* ------------------------------------------------------------ form -> API */

const n = (v: string): string | null => (v.trim() ? v.trim() : null);

export interface CarrierLookup {
  readonly carrierCode: (connectionId: string | null) => string | null;
  readonly serviceName: (serviceId: string | null) => string | null;
}

/** Header fields (without warehouse / client / code / lines). */
export function headerBody(v: OrderFormValues, carriers?: CarrierLookup): Record<string, unknown> {
  const customerName = [v.customerFirstName.trim(), v.customerLastName.trim()].filter(Boolean).join(' ');
  const orderType = /b2b/i.test(v.orderTypeName) ? 'B2B' : 'D2C';
  return {
    storeOrderNumber: n(v.storeOrderNumber),
    customerName,
    customerFirstName: n(v.customerFirstName),
    customerLastName: n(v.customerLastName),
    customerEmail: v.customerEmail.trim(),
    customerPhone: n(v.customerPhone),
    companyName: n(v.companyName),
    shipAddress: v.shipAddress.trim(),
    shipAddress2: n(v.shipAddress2),
    shipCity: v.shipCity.trim(),
    shipState: v.shipState.trim(),
    shipZip: v.shipZip.trim(),
    shipCountry: countryNameOf(v.shipCountry),
    addressType: v.addressType,
    skipAddressVerification: v.skipAddressVerification,
    orderType,
    orderTypeId: v.orderTypeId || null,
    priority: priorityFromRank(v.priorityRank),
    priorityRank: v.priorityRank,
    carrier: carriers?.carrierCode(v.carrierConnectionId) ?? null,
    shippingService: carriers?.serviceName(v.carrierServiceId) ?? null,
    carrierConnectionId: v.carrierConnectionId,
    carrierServiceId: v.carrierServiceId,
    rateShoppingPresetId: v.rateShoppingPresetId,
    orderDate: v.orderDate ?? undefined,
    expectedShipDate: v.expectedShipDate,
    expectedDeliveryDate: v.expectedDeliveryDate,
    scheduledPickupDate: v.scheduledPickupDate,
    scheduledShipmentDate: v.scheduledShipmentDate,
    note: n(v.note),
    packingInstructions: n(v.packingInstructions),
    isGift: v.isGift,
    giftNote: v.isGift ? n(v.giftNote) : null,
    clientReferenceCode: n(v.clientReferenceCode),
    extraNote1: n(v.extraNote1),
    extraNote2: n(v.extraNote2),
    extraNote3: n(v.extraNote3),
    extraNote4: n(v.extraNote4),
    extraNote5: n(v.extraNote5),
    customFields: v.customFields,
    taxType: v.taxType,
    taxId: n(v.taxId),
    useShipAsBilling: v.useShipAsBilling,
    billingAddress: v.useShipAsBilling
      ? null
      : {
          firstName: n(v.billing.firstName),
          lastName: n(v.billing.lastName),
          email: n(v.billing.email),
          phone: n(v.billing.phone),
          line1: n(v.billing.line1),
          line2: n(v.billing.line2),
          city: n(v.billing.city),
          state: n(v.billing.state),
          postalCode: n(v.billing.postalCode),
          country: v.billing.country ? countryNameOf(v.billing.country) : null,
          companyName: n(v.billing.companyName),
        },
    shippingChargesBillingType: v.shippingChargesBillingType,
    taxDutiesBillingType: v.taxDutiesBillingType,
    shippingAccountNumber: v.useCustomShippingAccount ? n(v.shippingAccountNumber) : null,
    taxDutiesAccountNumber: v.useCustomTaxAccount ? n(v.taxDutiesAccountNumber) : null,
    shipmentPackageId: v.shipmentPackageId,
    totalShippingCost: v.totalShippingCost ?? 0,
    discount: v.discount,
    trackingNumber: n(v.trackingNumber),
    trackingNumbers: v.trackingNumbers.length ? v.trackingNumbers : null,
    reasonForExport: v.reasonForExport,
    returnAddressId: v.returnAddressId,
    returnCarrierServiceId: v.returnCarrierServiceId,
    returnShippingCost: v.returnShippingCost,
    returnTrackingNumbers: v.returnTrackingNumbers.length ? v.returnTrackingNumbers : null,
    fraud: n(v.fraud),
    packingWarningTypeId: v.packingWarningTypeId,
    retailerId: v.retailerId,
    bol: n(v.bol),
    pro: n(v.pro),
    retailerPo: n(v.retailerPo),
    dept: n(v.dept),
    markFor: n(v.markFor),
    retailerCustomerAccount: n(v.retailerCustomerAccount),
    customerId: linkedCustomerId(v.customerId),
  };
}

export function lineBody(l: OrderLineValue, withId: boolean): Record<string, unknown> {
  return {
    ...(withId && l.id ? { id: l.id } : {}),
    productId: l.productId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    packType: l.packType,
    lotNumber: n(l.lotNumber),
    expiryDate: l.expiryDate,
    productionDate: l.productionDate,
    damageReason: l.damageReason,
    pinnedLocationId: l.pinnedLocationId,
    pinnedLpId: l.pinnedLpId,
    lineNote1: n(l.lineNote1),
    lineNote2: n(l.lineNote2),
    lineNote3: n(l.lineNote3),
  };
}

export function createBody(v: OrderFormValues, carriers?: CarrierLookup): Record<string, unknown> {
  return {
    ...headerBody(v, carriers),
    channel: 'Manual',
    warehouseId: v.warehouseId,
    clientId: v.clientId,
    code: v.code.trim(),
    autoCode: Boolean(v.codeSuggested) && v.code.trim() === v.codeSuggested,
    lines: v.lines.map((l) => lineBody(l, false)),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** PATCH body: only changed header keys; lines only when any line changed. */
export function updateBody(
  initial: OrderFormValues,
  v: OrderFormValues,
  version: number,
  carriers?: CarrierLookup,
): { version: number; patch: Record<string, unknown>; lines?: Record<string, unknown>[] } {
  const before = headerBody(initial, carriers);
  const after = headerBody(v, carriers);
  const patch = Object.fromEntries(Object.entries(after).filter(([k, val]) => !same(val, before[k])));
  delete patch.channel;
  const linesBefore = initial.lines.map((l) => lineBody(l, true));
  const linesAfter = v.lines.map((l) => lineBody(l, true));
  return same(linesBefore, linesAfter) ? { version, patch } : { version, patch, lines: linesAfter };
}

/** True when the customer step should show the "needs attention" state. */
export function addressNeedsAttention(
  v: Pick<OrderFormValues, 'skipAddressVerification' | 'addressStatus'>,
): boolean {
  return !v.skipAddressVerification && (v.addressStatus === 'Unverified' || v.addressStatus === 'Invalid');
}

export const ADDRESS_KEYS = [
  'shipAddress',
  'shipAddress2',
  'shipCity',
  'shipState',
  'shipZip',
  'shipCountry',
] as const;

/* ----------------------------------------------------------- completion */

/** Share of the three required steps (details, customer, products) whose rules pass: 0 on a blank form. */
export function requiredCompletion(values: OrderFormValues): number {
  const steps = [detailsStepSchema, customerStepSchema, productsStepSchema];
  const ok = steps.filter((s) => s.safeParse(values).success).length;
  return Math.round((ok / steps.length) * 100);
}

/** A customer picked from a previous order ("order:<id>") is a one-time customer: prefilled, never linked. */
export function linkedCustomerId(id: string | null | undefined): string | null {
  return id && !id.startsWith('order:') && !id.startsWith('__') ? id : null;
}
