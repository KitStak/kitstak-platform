/** VAS Operations (M11): grid fields and the create/edit drawer schema. PURE. */
import { z } from 'zod';
import { VAS_CALCULATION_TYPES, VAS_REFERENCE_ORDER_TYPES } from '@/lib/enums';
import { requiredId, versionField, type OrgField } from './common';

export const VAS_GRID_KEY = 'vas-operations';
export const VAS_NOTE_MAX = 200;
export const VAS_REFERENCE_MAX = 100;

export const VAS_FIELDS: readonly OrgField[] = [
  { field: 'vasTypeId', label: 'VAS type', type: 'enum' },
  { field: 'clientId', label: 'Client', type: 'enum' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'operationAt', label: 'Operation date', type: 'date' },
  { field: 'calculationType', label: 'Calculation type', type: 'enum', options: VAS_CALCULATION_TYPES },
  {
    field: 'referenceOrderType',
    label: 'Reference order type',
    type: 'enum',
    options: VAS_REFERENCE_ORDER_TYPES,
  },
  { field: 'referenceNumber', label: 'Reference number', type: 'text' },
  { field: 'value', label: 'Value', type: 'number', decimals: 2 },
  { field: 'createdBy', label: 'Created by', type: 'enum' },
  { field: 'createdAt', label: 'Created date', type: 'date' },
];
/** Logiwa's 9 VAS filter fields, pinned by default in the filter builder. */
export const VAS_FILTER_PRESET = [
  'calculationType',
  'clientId',
  'createdBy',
  'createdAt',
  'operationAt',
  'referenceNumber',
  'referenceOrderType',
  'vasTypeId',
  'warehouseId',
] as const;
export const VAS_SORT_FIELDS = [
  'vasTypeName',
  'clientName',
  'warehouseCode',
  'operationAt',
  'createdByName',
  'createdAt',
  'calculationType',
  'referenceNumber',
  'referenceOrderType',
  'value',
] as const;
export const VAS_SEARCH_FIELDS = ['vasTypeName', 'referenceNumber', 'note'] as const;

export const vasSchema = z
  .object({
    clientId: requiredId('Client'),
    warehouseId: requiredId('Warehouse'),
    vasTypeId: requiredId('VAS type'),
    operationAt: z
      .string({ error: 'Operation date is required' })
      .min(1, 'Operation date is required')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date'),
    value: z
      .number({ error: 'Operation value is required' })
      .gt(0, 'Operation value must be more than 0')
      .max(1_000_000, 'Operation value is too large'),
    note: z
      .string()
      .trim()
      .max(VAS_NOTE_MAX, `Use at most ${VAS_NOTE_MAX} characters`)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    referenceOrderType: z.enum(VAS_REFERENCE_ORDER_TYPES).nullable().optional(),
    referenceNumber: z
      .string()
      .trim()
      .max(VAS_REFERENCE_MAX, `Use at most ${VAS_REFERENCE_MAX} characters`)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
    version: versionField,
  })
  .superRefine((v, ctx) => {
    if (v.referenceNumber && !v.referenceOrderType)
      ctx.addIssue({
        code: 'custom',
        path: ['referenceOrderType'],
        message: 'Choose the reference order type',
      });
    if (v.referenceOrderType && !v.referenceNumber)
      ctx.addIssue({ code: 'custom', path: ['referenceNumber'], message: 'Reference number is required' });
  });
export type VasInput = z.input<typeof vasSchema>;
export type VasSave = z.output<typeof vasSchema>;

/** Calculation type comes from Data Setup › VAS Type meta; unknown types default to quantity. */
export function vasCalculationType(
  meta: Readonly<Record<string, unknown>> | null | undefined,
): (typeof VAS_CALCULATION_TYPES)[number] {
  return meta?.calculationType === 'Total Price' ? 'Total Price' : 'Vas Quantity';
}
