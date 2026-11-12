/** Carrier integrations (connections + Carrier Errors) schemas and grid fields (M12, spec 06 §7b, §17). PURE. */
import { z } from 'zod';
import { carrierSettingsSchema } from '@/lib/domain-types';
import { CARRIER_ENVIRONMENTS, MARKUP_TYPES } from '@/lib/enums';
import { requiredId, requiredText, versionField, type IntegrationField } from './common';

export const CARRIER_ERRORS_GRID_KEYS = {
  LabelGeneration: 'carrier-errors',
  RateCall: 'carrier-errors-rate-call',
  VoidLabel: 'carrier-errors-void-label',
} as const;
export type CallStep = keyof typeof CARRIER_ERRORS_GRID_KEYS;
export const STEP_SLUG: Readonly<Record<string, CallStep>> = {
  'label-generation': 'LabelGeneration',
  'rate-call': 'RateCall',
  'void-label': 'VoidLabel',
};

export const CALL_LOG_FIELDS: readonly IntegrationField[] = [
  { field: 'connectionId', label: 'Carrier setup name', type: 'enum' },
  { field: 'provider', label: 'Carrier connection', type: 'enum' },
  { field: 'clientId', label: 'Client', type: 'enum' },
  { field: 'at', label: 'Created date', type: 'date' },
  { field: 'isInternational', label: 'Is international?', type: 'boolean' },
  { field: 'isRateShopping', label: 'Is rate shopping?', type: 'boolean' },
  { field: 'isReturnLabel', label: 'Return label', type: 'boolean' },
  { field: 'orderCode', label: 'Shipment order code', type: 'text' },
  { field: 'trackingNumber', label: 'Tracking number', type: 'text' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'status', label: 'Status', type: 'enum', options: ['Success', 'Error'] },
  { field: 'httpCode', label: 'HTTP code', type: 'number' },
];
export const CALL_LOG_SORT_FIELDS = [
  'at',
  'orderCode',
  'trackingNumber',
  'status',
  'httpCode',
  'responseMs',
  'provider',
  'serviceName',
  'setupName',
  'clientName',
  'userEmail',
  'source',
  'labelType',
  'rateShoppingName',
  'warehouseCode',
] as const;

const secret = z.string().trim().max(500).optional();

export const createCarrierSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  setupName: requiredText('Setup name', 60),
  warehouseId: requiredId('Warehouse'),
  environment: z.enum(CARRIER_ENVIRONMENTS),
  payorAccountNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => v || null),
  credentials: z.record(z.string().max(40), z.string().trim().max(500)).default({}),
});
export type CreateCarrierInput = z.input<typeof createCarrierSchema>;

export const clientAccessSchema = z.object({
  clientId: requiredId('Client'),
  hasAccess: z.boolean(),
  markupType: z
    .enum(MARKUP_TYPES)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  markupAmount: z
    .number()
    .min(0, "Markup can't be negative")
    .max(100_000)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const thirdPartySchema = z.object({
  id: z.string().max(64).optional(),
  accountNumber: requiredText('Account number', 40),
  billingCountry: requiredText('Billing country', 60),
  billingZip: requiredText('Billing zip', 20),
});

export const editCarrierSchema = z
  .object({
    setupName: requiredText('Setup name', 60),
    isActive: z.boolean(),
    environment: z.enum(CARRIER_ENVIRONMENTS),
    payorAccountNumber: z
      .string()
      .trim()
      .max(40)
      .optional()
      .nullable()
      .transform((v) => v || null),
    credentials: z.record(z.string().max(40), secret).default({}),
    allClients: z.boolean(),
    clients: z.array(clientAccessSchema).max(2000).default([]),
    allServices: z.boolean(),
    services: z
      .array(z.object({ id: z.string().min(1).max(64), isActive: z.boolean() }))
      .max(500)
      .default([]),
    allPackages: z.boolean(),
    packages: z
      .array(z.object({ id: z.string().min(1).max(64), isActive: z.boolean() }))
      .max(500)
      .default([]),
    thirdParty: z.array(thirdPartySchema).max(50).default([]),
    settings: carrierSettingsSchema,
    version: versionField,
  })
  .superRefine((v, ctx) => {
    if (!v.allClients && !v.clients.some((c) => c.hasAccess))
      ctx.addIssue({
        code: 'custom',
        path: ['clients'],
        message: 'Give at least one client access, or choose all clients',
      });
    v.clients.forEach((c, i) => {
      if ((c.markupType === null) !== (c.markupAmount === null))
        ctx.addIssue({
          code: 'custom',
          path: ['clients', i, 'markupAmount'],
          message: 'Set both the markup type and amount, or neither',
        });
      if (c.markupType === 'Percentage' && (c.markupAmount ?? 0) > 100)
        ctx.addIssue({
          code: 'custom',
          path: ['clients', i, 'markupAmount'],
          message: 'A percentage markup can be at most 100',
        });
    });
    if (!v.allServices && !v.services.some((s) => s.isActive))
      ctx.addIssue({ code: 'custom', path: ['services'], message: 'Activate at least one service' });
    const from = v.settings.shipFrom;
    if (!from.useRetailerAddress && from.address) {
      const digits = (from.address.phone ?? '').replace(/[^0-9A-Za-z]/g, '');
      if (digits.length > 0 && digits.length < 10)
        ctx.addIssue({
          code: 'custom',
          path: ['settings', 'shipFrom', 'address', 'phone'],
          message: 'Carriers need a phone number of at least 10 digits',
        });
    }
  });
export type EditCarrierInput = z.input<typeof editCarrierSchema>;
export type EditCarrierSave = z.output<typeof editCarrierSchema>;

/** Tokens for label messages (spec 06 §7b). */
export const LABEL_TOKENS = [
  'OrderCode',
  'StoreOrderNumber',
  'ClientName',
  'PlannedShipmentDate',
  'OrderItemsWithQty',
  'Notes',
  'Tags',
  'SKU1',
  'SKU2',
  'SKU3',
  'StoreName',
  'PackageDimension',
  'CustomFieldTextBox1',
  'CustomFieldTextBox2',
  'CustomFieldTextBox3',
  'CustomFieldDropDown1',
  'CustomFieldDropDown2',
  'RetailerPO',
] as const;
export const REFERENCE_TOKENS = [
  'OrderCode',
  'StoreOrderNumber',
  'Note',
  'Tags',
  'CustomFieldTextBox1',
  'CustomFieldTextBox2',
  'CustomFieldTextBox3',
  'RetailerPO',
] as const;
