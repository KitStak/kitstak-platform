/** LP Types grid + wizard schema (M10). PURE. */
import { z } from 'zod';
import { DIMENSION_UNITS, VOLUME_UNITS, WEIGHT_UNITS } from '@/lib/enums';
import {
  CUSTOM_FIELD_FILTER_FIELDS,
  customFieldValuesSchema,
  nonNegative,
  optionalText,
  requiredId,
  requiredPattern,
  versionField,
  type FacilityField,
} from './common';

export const LP_TYPES_GRID_KEY = 'lp-types';

export const LP_TYPE_PARAMETERS = [
  { key: 'onlyOneExpiry', label: 'Only 1 expiry date', column: 'Is prevent multi expiry date' },
  {
    key: 'onlyOneProductionDate',
    label: 'Only 1 production date',
    column: 'Is prevent multi production date',
  },
  { key: 'onlyOneLot', label: 'Only 1 lot batch number', column: 'Is prevent multi lot batch number' },
  { key: 'onlyOneSku', label: 'Only 1 SKU', column: 'Is prevent multi SKU' },
  { key: 'onlyOneClient', label: 'Only 1 client', column: 'Is prevent multi client' },
  { key: 'onlyOneOrder', label: 'Only 1 order', column: 'Is prevent multi order' },
  { key: 'onlyOneJob', label: 'Only 1 job', column: 'Is prevent multi job' },
  { key: 'suitableForParentLp', label: 'Suitable for parent LP', column: 'Suitable for parent LP' },
  { key: 'useForAiJob', label: 'Use for AI job', column: 'Is use for AI job' },
] as const;

export type LpTypeParamKey = (typeof LP_TYPE_PARAMETERS)[number]['key'];

export const LP_TYPE_FIELDS: readonly FacilityField[] = [
  { field: 'code', label: 'Code', type: 'text' },
  { field: 'description', label: 'Description', type: 'text' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'numberPrefix', label: 'Number prefix', type: 'text' },
  { field: 'numberLength', label: 'Number length', type: 'number' },
  { field: 'suitableForParentLp', label: 'Usable as parent LP', type: 'boolean' },
  { field: 'useForAiJob', label: 'Use for AI jobs', type: 'boolean' },
  { field: 'onlyOneSku', label: 'Prevent multi SKU', type: 'boolean' },
  { field: 'onlyOneClient', label: 'Prevent multi client', type: 'boolean' },
  { field: 'onlyOneExpiry', label: 'Prevent multi expiry date', type: 'boolean' },
  { field: 'onlyOneProductionDate', label: 'Prevent multi production date', type: 'boolean' },
  { field: 'onlyOneLot', label: 'Prevent multi lot', type: 'boolean' },
  { field: 'onlyOneOrder', label: 'Prevent multi order', type: 'boolean' },
  { field: 'onlyOneJob', label: 'Prevent multi job', type: 'boolean' },
  { field: 'dimensionUnit', label: 'Dimension unit', type: 'enum', options: DIMENSION_UNITS },
  { field: 'weightUnit', label: 'Weight unit', type: 'enum', options: WEIGHT_UNITS },
  { field: 'emptyWeight', label: 'Empty weight', type: 'number', decimals: 2 },
  { field: 'maxWeight', label: 'Max weight', type: 'number', decimals: 2 },
  { field: 'maxVolume', label: 'Max volume', type: 'number', decimals: 3 },
  { field: 'createdAt', label: 'Created date', type: 'date' },
  { field: 'lpCount', label: 'LP count', type: 'number' },
  ...CUSTOM_FIELD_FILTER_FIELDS,
];

export const LP_TYPE_SORT_FIELDS = [
  'code',
  'description',
  'warehouseCode',
  'numberPrefix',
  'numberLength',
  'length',
  'width',
  'height',
  'emptyWeight',
  'maxWeight',
  'maxVolume',
  'dimensionUnit',
  'weightUnit',
  'lpCount',
  'createdAt',
  ...CUSTOM_FIELD_FILTER_FIELDS.map((f) => f.field),
] as const;
export const LP_TYPE_SEARCH_FIELDS = ['code', 'description'] as const;

const params = Object.fromEntries(
  LP_TYPE_PARAMETERS.map((p) => [p.key, z.boolean().default(false)]),
) as Record<LpTypeParamKey, z.ZodDefault<z.ZodBoolean>>;

const GENERAL_SHAPE = {
  warehouseId: requiredId('Warehouse'),
  code: requiredPattern('Code', 40, /^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Letters, numbers, dash or underscore'),
  numberPrefix: requiredPattern('Number prefix', 10, /^[A-Za-z0-9-]+$/, 'Letters, numbers or dash'),
  numberLength: z
    .number({ error: 'Number length is required' })
    .int('Whole number')
    .min(1, 'At least 1 digit')
    .max(12, 'At most 12 digits'),
  length: nonNegative('Length'),
  width: nonNegative('Width'),
  height: nonNegative('Height'),
  dimensionUnit: z.enum(DIMENSION_UNITS),
  weightUnit: z.enum(WEIGHT_UNITS),
  emptyWeight: nonNegative('Empty weight'),
  maxWeight: nonNegative('Max weight'),
  volumeUnit: z.enum(VOLUME_UNITS),
  maxVolume: nonNegative('Max volume', 1_000_000_000),
};

/** Cross-field rule shared by the schema and the wizard's live check (0 max = no limit). */
export function maxWeightIssue(
  emptyWeight: number | null | undefined,
  maxWeight: number | null | undefined,
): string | null {
  const empty = Number(emptyWeight ?? 0);
  const max = Number(maxWeight ?? 0);
  return max > 0 && max < empty ? 'Max weight must be at least the empty weight' : null;
}

const checkWeight = (v: { maxWeight: number; emptyWeight: number }, ctx: z.RefinementCtx) => {
  const message = maxWeightIssue(v.emptyWeight, v.maxWeight);
  if (message) ctx.addIssue({ code: 'custom', path: ['maxWeight'], message });
};

/** Wizard step 1 (General, with units). */
export const lpTypeGeneralSchema = z.object(GENERAL_SHAPE).superRefine(checkWeight);
/** Wizard step 3 (Other info). */
export const lpTypeOtherSchema = z.object({
  description: optionalText(250),
  customFields: customFieldValuesSchema,
});

export const lpTypeSchema = z
  .object({
    ...GENERAL_SHAPE,
    description: optionalText(250),
    ...params,
    customFields: customFieldValuesSchema,
    version: versionField,
  })
  .superRefine(checkWeight);

export type LpTypeInput = z.input<typeof lpTypeSchema>;
export type LpTypeSave = z.output<typeof lpTypeSchema>;

export const LP_TYPE_DEFAULTS: LpTypeInput = {
  warehouseId: '',
  code: '',
  numberPrefix: '',
  numberLength: 5,
  description: '',
  length: 0,
  width: 0,
  height: 0,
  dimensionUnit: 'Inch',
  weightUnit: 'Ounce',
  emptyWeight: 0,
  maxWeight: 0,
  volumeUnit: 'Cubic Inch',
  maxVolume: 0,
  onlyOneExpiry: false,
  onlyOneProductionDate: false,
  onlyOneLot: false,
  onlyOneSku: false,
  onlyOneClient: false,
  onlyOneOrder: false,
  onlyOneJob: false,
  suitableForParentLp: false,
  useForAiJob: false,
  customFields: {},
};

/** "KSE-" + 1 padded to 5 -> "KSE-00001" (matches sequences.formatCode). */
export function lpNumberPreview(prefix: string, length: number, next: number): string {
  return `${prefix}${String(next).padStart(Math.max(1, length), '0')}`;
}

/** Delete-blocked tooltip: "1 LP number uses this type" / "3 LP numbers use this type". */
export function lpTypeInUseReason(count: number): string {
  const base =
    count === 1 ? '1 LP number uses this type' : `${count.toLocaleString('en-US')} LP numbers use this type`;
  return `${base}. Delete unused LPs in LP Numbers first.`;
}
