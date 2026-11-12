/**
 * Shapes of the JSON columns in the schema, with zod validators. Safe to import
 * from client and server code.
 *
 * Settings objects are stored sparsely (the column default is `{}`). Parsing
 * with the schemas below fills every missing switch with its default, so
 * readers always get a complete object.
 */
import { z } from 'zod';
import {
  ADDRESS_TYPES,
  GRID_FILTER_OPS,
  LABEL_FORMATS,
  MARKUP_TYPES,
  MATCH_MODES,
  RULE_COMPARATORS,
  SORT_DIRECTIONS,
} from './enums';

/* ------------------------------------------------------------- conditions */
const conditionScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const conditionValueSchema = z.union([conditionScalar, z.array(z.union([z.string(), z.number()]))]);
export type ConditionValue = z.infer<typeof conditionValueSchema>;

/** A saved grid-filter clause; `op` uses the grid query grammar (BUILD_PLAN 0.2). */
export const filterConditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(GRID_FILTER_OPS),
  value: conditionValueSchema,
  label: z.string(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

/** A rule-engine condition (algorithms, workflows, billing fees). */
export const ruleConditionSchema = z.object({
  field: z.string().min(1),
  comparator: z.enum(RULE_COMPARATORS),
  value: conditionValueSchema,
});
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

/**
 * A nested AND/OR group of rule conditions (workflows). A condition list may mix plain
 * conditions and groups: `[A, {group:"Any", conditions:[B, C]}]` with top-level match All
 * reads "A AND (B OR C)". Plain `RuleCondition[]` lists stay valid.
 */
export const ruleConditionGroupSchema = z.object({
  group: z.enum(MATCH_MODES),
  conditions: z.array(ruleConditionSchema).min(1, 'Add at least one condition to the group').max(20),
});
export type RuleConditionGroup = z.infer<typeof ruleConditionGroupSchema>;
export const ruleConditionNodeSchema = z.union([ruleConditionGroupSchema, ruleConditionSchema]);
export type RuleConditionNode = RuleCondition | RuleConditionGroup;
export function isConditionGroup(node: RuleConditionNode): node is RuleConditionGroup {
  return (
    typeof node === 'object' &&
    node !== null &&
    'group' in node &&
    Array.isArray((node as RuleConditionGroup).conditions)
  );
}

export const orderByClauseSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(SORT_DIRECTIONS),
});
export type OrderByClause = z.infer<typeof orderByClauseSchema>;

/* ---------------------------------------------------------------- address */
export const addressValueSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  companyName: z.string().optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().optional(),
  addressType: z.enum(ADDRESS_TYPES).optional(),
});
export type AddressValue = z.infer<typeof addressValueSchema>;

/* -------------------------------------------------------------- job types */
const off = z.boolean().default(false);
const on = z.boolean().default(true);

export const JOB_ORDER_SCOPES = [
  'All Orders',
  'Identical Item Orders',
  'Single Item Orders',
  'Multi-Item Orders',
  'Identical Kit to Order',
] as const;
export const JOB_TEMPLATES = [
  'Custom',
  'Single Item Order',
  'Multi-Item Orders',
  'Identical Item Orders',
  'Pre-Cartonization',
  'Single SKU Cluster Pick',
  'Putwall Process',
  'Retailer Compliance',
  'Identical Kit to Order',
] as const;

export const jobTypeSettingsSchema = z.object({
  template: z.enum(JOB_TEMPLATES).default('Custom'),
  orderScope: z.enum(JOB_ORDER_SCOPES).default('All Orders'),
  picking: z
    .object({
      overrideForLastJob: on,
      onlyPick: off,
      onlyPack: off,
      createLoadingTask: off,
      disableFullLpPicking: off,
      autoCompletePickingTasks: off,
      createSortingTask: off,
      oneByOneSorting: off,
      disableToteScanning: off,
      enablePickerSelfAssign: off,
    })
    .prefault({}),
  batch: z
    .object({
      method: z.enum(['Nof Order', 'Nof Item']).default('Nof Order'),
      min: z.number().int().min(0).default(1),
      max: z.number().int().min(0).default(50),
    })
    .prefault({}),
  mobileScreens: z.object({ pickAndSort: off, pickToLocation: off }).prefault({}),
  count: z
    .object({
      oneByOneCount: off,
      autoUpdateNoDifferenceLines: off,
      instantCount: off,
      lockLocationForInstantCount: off,
      autoFillTrackingAttributes: off,
      /** Counters don't see the system quantity (count sheet / quick count hide it). */
      blindCount: off,
    })
    .prefault({}),
  replenishment: z
    .object({
      algorithmMethod: z.enum(['FEFO', 'FIFO', 'LIFO']).default('FEFO'),
      flow: z.enum(['Pick & Put', 'Direct Put']).default('Pick & Put'),
      type: z.enum(['Dynamic', 'Static']).default('Static'),
      allowExceedTaskQuantity: off,
      updateTaskQuantityIfLessPicked: off,
      pickFullPack: off,
      zoneBased: off,
      allowHigherPackTypeConversion: off,
      locationGroupBased: off,
      onlyPickFullLp: off,
      allowScanningAnotherPutLocation: off,
      allowSuggestAnother: off,
      enableLpSwap: off,
    })
    .prefault({}),
  workOrder: z.object({ pickingAndKitting: on }).prefault({}),
});
export type JobTypeSettings = z.infer<typeof jobTypeSettingsSchema>;

/* ---------------------------------------------- client settings (05 sec 7) */
export const clientSettingsSchema = z.object({
  notifications: z
    .object({
      receivedPo: off,
      dailyInventory: off,
      dailyInventoryByLocation: off,
      safetyStock: off,
    })
    .prefault({}),
  fulfillment: z
    .object({
      preventReallocationIfMissing: off,
      retainAllocationDuringMissing: off,
      allowDifferentLocationLpn: off,
    })
    .prefault({}),
  packing: z
    .object({
      directPrintPackList: off,
      enablePackAll: off,
      disableShippingOptionChange: off,
      disablePackageChange: off,
      disableBatchOrderPacking: off,
      disableCarrierRate: off,
      disallowMultipleShipmentPackages: off,
      disablePackingWithoutLabel: off,
      enableEnterQuantity: off,
      enablePackageSuggestion: off,
      forcePackageTypeValidation: off,
      directPrintAttachedDocuments: off,
      scanOnlyPackTypeBarcodes: off,
      captureLabelImagesForPackingList: off,
      autoCompletePackingOnLastScan: off,
      usePreProducedLabelsInMultiBox: off,
      forceCartonizationInstructions: off,
    })
    .prefault({}),
  advanced: z
    .object({
      keepReceivingDateOnInventory: off,
      allowUniqueSkuBarcodes: off,
      keepPoNumberOnInventory: off,
      receivingPhysicalAttributeVerification: off,
    })
    .prefault({}),
  /** Logiwa Edit Client › Others "SSCC18 Barcode Creation" (M11 writes it; M10 builds SSCC-18 from it). */
  sscc: z
    .object({ extensionDigit: z.string(), gs1CompanyPrefix: z.string(), serialNumber: z.string() })
    .partial()
    .optional(),
});
export type ClientSettings = z.infer<typeof clientSettingsSchema>;
/** Stored form: any subset of the switches (column default `{}`). */
export type ClientSettingsInput = z.input<typeof clientSettingsSchema>;

/* ------------------------------------------------------ channel settings */
export const channelSettingsSchema = z.object({
  paymentStatuses: z.array(z.string()).default([]),
  taxIdMapping: z.string().nullable().default(null),
  tagFilter: z
    .object({
      method: z.enum(['Included', 'Excluded']).default('Included'),
      condition: z.enum(['All Following Tags', 'Any Following Tags']).default('All Following Tags'),
      tags: z.array(z.string()).default([]),
    })
    .prefault({}),
  products: z.object({ download: off, uom: z.string().default('Unit') }).prefault({}),
  orders: z
    .object({
      download: off,
      shipmentOrderType: z.string().default('D2C Order'),
      downloadFrom: z.string().nullable().default(null), // ISO date; null = let KitStaks decide
      partialOrders: off,
      createNonexistentProducts: off,
      skipAddressVerification: off,
    })
    .prefault({}),
  inventory: z
    .object({ sync: off, method: z.enum(['On Hand', 'Available']).default('Available') })
    .prefault({}),
  shipments: z.object({ sendShipmentInfo: off }).prefault({}),
});
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
export type ChannelSettingsInput = z.input<typeof channelSettingsSchema>;

/* ------------------------------------------------------ carrier settings */
export const carrierSettingsSchema = z.object({
  shipFrom: z
    .object({
      useRetailerAddress: off,
      address: addressValueSchema.nullable().default(null),
    })
    .prefault({}),
  generalMarkup: z
    .object({
      type: z.enum(MARKUP_TYPES),
      amount: z.number().min(0),
    })
    .nullable()
    .default(null),
  label: z
    .object({
      format: z.enum(LABEL_FORMATS).default('PDF'),
      size: z.string().default('4x6'),
      messages: z.array(z.string()).max(3).default([]),
    })
    .prefault({}),
  international: z
    .object({
      taxType: z.enum(['EIN', 'DNS', 'FGN']).nullable().default(null),
      taxId: z.string().nullable().default(null),
      useComponentsOnCommercialInvoice: off,
      customerReferenceInvoice: z.string().nullable().default(null),
      customerReferencePo: z.string().nullable().default(null),
    })
    .prefault({}),
  returnLabel: z.object({ generateWithShippingLabel: off }).prefault({}),
});
export type CarrierSettings = z.infer<typeof carrierSettingsSchema>;
export type CarrierSettingsInput = z.input<typeof carrierSettingsSchema>;

/* -------------------------------------------------------- user preferences */
export const userPreferencesSchema = z.object({
  dateFormat: z.string().default('M/D/YYYY h:mm:ss A'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  numberFormat: z.enum(['1,025.00', '1.025,00']).default('1,025.00'),
  density: z.enum(['Large', 'Small']).default('Large'),
  defaultWarehouseId: z.string().optional(),
  /** Station choices remembered per user on any device (docs/requests/stations-returns.md REQ-3). */
  stations: z
    .object({
      packing: z.object({ warehouseId: z.string().nullable(), stationId: z.string().nullable() }).partial(),
      returns: z
        .object({
          warehouseId: z.string().nullable(),
          stationId: z.string().nullable(),
          targetKind: z.enum(['location', 'lp']),
          targetId: z.string().nullable(),
          targetCode: z.string().nullable(),
        })
        .partial(),
    })
    .partial()
    .optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/** Parses a settings JSON value, filling defaults; invalid input throws a ZodError. */
export function parseSettings<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value ?? {});
}
