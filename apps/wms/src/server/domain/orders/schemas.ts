/** zod input schemas for shipment-order commands (validated at the domain boundary). */
import { z } from "zod";
import { addressValueSchema } from "@/lib/domain-types";
import { ADDRESS_TYPES, BILLING_PARTY_TYPES, CUSTOM_FIELD_SLOTS, EXPORT_REASONS, ORDER_CHANNELS, ORDER_TYPES, PRIORITIES, TAX_TYPES } from "@/lib/enums";

const optText = (max = 500) => z.string().trim().max(max).nullish();
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

export const orderLineInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().min(0).default(0),
  packType: z.string().min(1).optional(),
  lotNumber: optText(100),
  expiryDate: isoDate.nullish(),
  productionDate: isoDate.nullish(),
  damageReason: optText(100),
  pinnedLocationId: z.string().nullish(),
  pinnedLpId: z.string().nullish(),
  lineNote1: optText(), lineNote2: optText(), lineNote3: optText(),
});
export type OrderLineInput = z.input<typeof orderLineInputSchema>;

/** Billing address: blank / null parts are dropped; an all-blank address becomes null; otherwise line1, city, zip and country are required. */
const billingAddressSchema = z.preprocess((raw: unknown) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const kept = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "")));
  return Object.keys(kept).length === 0 ? null : kept;
}, addressValueSchema.nullable());

const customFieldsSchema = z.partialRecord(z.enum(CUSTOM_FIELD_SLOTS), z.union([z.string(), z.boolean(), z.null()]));

/**
 * Header fields editable through `updateOrder` (status / warehouse / client have their own
 * commands). No defaults here, so a partial patch never resets unspecified fields.
 */
export const orderHeaderSchema = z.object({
  channel: z.enum(ORDER_CHANNELS),
  storeName: optText(200),
  storeOrderNumber: optText(100),
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.union([z.literal(""), z.email()]),
  customerPhone: optText(50),
  customerFirstName: optText(100),
  customerLastName: optText(100),
  companyName: optText(200),
  shipAddress: z.string().trim().min(1).max(300),
  shipAddress2: optText(300),
  shipCity: z.string().trim().min(1).max(100),
  shipState: z.string().trim().max(100),
  shipZip: z.string().trim().min(1).max(20),
  shipCountry: z.string().trim().min(1).max(100),
  addressType: z.enum(ADDRESS_TYPES).nullish(),
  orderType: z.enum(ORDER_TYPES),
  orderTypeId: z.string().nullish(),
  priority: z.enum(PRIORITIES),
  carrier: optText(100),
  shippingService: optText(100),
  carrierConnectionId: z.string().nullish(),
  carrierServiceId: z.string().nullish(),
  rateShoppingPresetId: z.string().nullish(),
  orderDate: isoDate.optional(),
  expectedShipDate: isoDate.nullish(),
  expectedDeliveryDate: isoDate.nullish(),
  note: optText(2000),
  packingInstructions: optText(2000),
  skipAddressVerification: z.boolean(),
  isGift: z.boolean(),
  giftNote: optText(1000),
  clientReferenceCode: optText(100),
  extraNote1: optText(), extraNote2: optText(), extraNote3: optText(), extraNote4: optText(), extraNote5: optText(),
  customFields: customFieldsSchema.optional(),
  // Wizard extras (docs/requests/orders-outbound.md REQ-1); all optional, columns already exist.
  taxType: z.enum(TAX_TYPES).nullish(),
  taxId: optText(100),
  useShipAsBilling: z.boolean().optional(),
  billingAddress: billingAddressSchema.nullish(),
  scheduledPickupDate: isoDate.nullish(),
  scheduledShipmentDate: isoDate.nullish(),
  shippingChargesBillingType: z.enum(BILLING_PARTY_TYPES).nullish(),
  taxDutiesBillingType: z.enum(BILLING_PARTY_TYPES).nullish(),
  shippingAccountNumber: optText(100),
  taxDutiesAccountNumber: optText(100),
  shipmentPackageId: z.string().max(64).nullish(),
  totalShippingCost: z.number().min(0).max(1_000_000).optional(),
  discount: z.number().min(0).max(1_000_000).optional(),
  trackingNumber: optText(100),
  trackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
  reasonForExport: z.enum(EXPORT_REASONS).nullish(),
  returnAddressId: z.string().max(64).nullish(),
  returnCarrierServiceId: z.string().max(64).nullish(),
  returnShippingCost: z.number().min(0).max(1_000_000).nullish(),
  returnTrackingNumbers: z.array(z.string().trim().min(1).max(100)).max(50).nullish(),
  fraud: optText(500),
  packingWarningTypeId: z.string().max(64).nullish(),
  retailerId: z.string().max(64).nullish(),
  bol: optText(100), pro: optText(100), retailerPo: optText(100), dept: optText(100), markFor: optText(200),
  retailerCustomerAccount: optText(100),
  customerId: z.string().max(64).nullish(),
  priorityRank: z.number().int().min(0).max(9999).optional(),
  // Channel downloads (docs/requests/automation-integrations.md REQ-3).
  channelConnectionId: z.string().max(64).nullish(),
  channelPaymentStatus: z.string().max(50).nullish(),
});

export const createOrderSchema = orderHeaderSchema.extend({
  channel: orderHeaderSchema.shape.channel.default("Manual"),
  customerEmail: orderHeaderSchema.shape.customerEmail.default(""),
  shipState: orderHeaderSchema.shape.shipState.default(""),
  shipCountry: orderHeaderSchema.shape.shipCountry.default("United States"),
  orderType: orderHeaderSchema.shape.orderType.default("D2C"),
  priority: orderHeaderSchema.shape.priority.default("None"),
  skipAddressVerification: orderHeaderSchema.shape.skipAddressVerification.default(false),
  isGift: orderHeaderSchema.shape.isGift.default(false),
  code: z.string().trim().min(1).max(50).optional(),
  warehouseId: z.string().min(1),
  clientId: z.string().min(1),
  lines: z.array(orderLineInputSchema).min(1, "At least one line is required").max(1000),
});
export type CreateOrderInput = z.input<typeof createOrderSchema>;

export const updateOrderSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  patch: orderHeaderSchema.partial().default({}),
  /** Replaces all lines (only while the order is Open / Shortage / On Hold and unallocated). */
  lines: z.array(orderLineInputSchema.extend({ id: z.string().optional() })).min(1).max(1000).optional(),
});
export type UpdateOrderInput = z.input<typeof updateOrderSchema>;

export const ADDRESS_FIELDS = ["shipAddress", "shipAddress2", "shipCity", "shipState", "shipZip", "shipCountry"] as const;
