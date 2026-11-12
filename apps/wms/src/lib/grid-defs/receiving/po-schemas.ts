/**
 * Purchase order form + command schemas (M05). Pure TS (zod) shared by the wizard,
 * the receive drawer and the API handlers, so client and server agree on every rule
 * and every inline message.
 */
import { z } from 'zod';
import { PO_STATUSES, PO_TYPES } from '@/lib/enums';

export const PO_CODE_MAX = 50;
export const PO_REFERENCE_MAX = 100;
export const PO_NOTE_MAX = 500;
export const MAX_PO_LINES = 500;
export const MAX_LINE_QTY = 1_000_000;

/** Required text with a human message when the field is missing or not text ("Warehouse is required."). */
const requiredText = (label: string) => z.string({ message: `${label} is required.` }).trim();
const isoDate = z
  .string({ message: 'Enter a valid date' })
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date');
const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? new Date(v).toISOString() : null));
/**
 * Calendar-date attribute (expiry / production): stored as YYYY-MM-DD, never as an instant,
 * so it can't drift a day across time zones. "2027-05-08" and "2027-05-08T05:00:00.000Z"
 * both store "2027-05-08".
 */
export function toDay(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  return m ? (m[1] as string) : new Date(v).toISOString().slice(0, 10);
}
/**
 * Display value for a calendar-date attribute. "2027-05-28" is the local day May 28 (a bare
 * `new Date("2027-05-28")` reads UTC midnight and renders May 27 west of UTC). Legacy rows
 * that stored an instant ("2027-05-08T05:00:00.000Z") keep their local reading. Null when
 * empty or invalid.
 */
export function calendarDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalises a stored calendar-date value to YYYY-MM-DD in `timeZone` (legacy instants such
 * as "2027-05-08T05:00:00.000Z" were local midnight of the receiving warehouse). Values that
 * already are a day pass through.
 */
export function dayInZone(value: string, timeZone: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const optionalDay = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? toDay(v) : null));
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const poLineSchema = z.object({
  /** Existing line id on edit; absent for a new line. */
  id: z.string().trim().min(1).max(64).optional(),
  productId: z.string({ message: 'Choose a product' }).trim().min(1, 'Choose a product'),
  /** Omitted / blank = the product's base pack type (resolved server-side). */
  packType: z.string().trim().max(60).default(''),
  orderedQuantity: z
    .number({ message: 'Quantity is required' })
    .int('Use a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(MAX_LINE_QTY, 'Quantity is too large'),
  unitCost: z
    .number({ message: 'Price per pack type is required' })
    .min(0, "Price can't be negative")
    .max(10_000_000, 'Price is too large'),
  receivingLocationId: z.string().trim().max(64).optional().nullable(),
  lotNumber: optionalText(100),
  expiryDate: optionalDay,
  productionDate: optionalDay,
  lpTypeId: z.string().trim().max(64).optional().nullable(),
  lpNumber: optionalText(100),
  note: optionalText(500),
});
export type PoLineInput = z.input<typeof poLineSchema>;
export type PoLineValues = z.output<typeof poLineSchema>;

export const customFieldValuesSchema = z
  .record(z.string(), z.union([z.string().max(500), z.boolean(), z.null()]))
  .default({});

export const poHeaderSchema = z.object({
  warehouseId: requiredText('Warehouse').min(1, 'Warehouse is required'),
  clientId: requiredText('Client').min(1, 'Client is required'),
  code: requiredText('PO number')
    .min(1, 'PO number is required')
    .max(PO_CODE_MAX, `Use at most ${PO_CODE_MAX} characters`)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, 'Use letters, numbers, spaces, dots, dashes or slashes'),
  poType: z.enum(PO_TYPES, { message: 'PO type is required' }),
  poDate: z
    .string({ message: 'PO date is required.' })
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
    .transform((v) => new Date(v).toISOString()),
  plannedReceivingDate: optionalDate,
  receivedAt: optionalDate,
  plannedArrivalDate: optionalDate,
  actualArrivalDate: optionalDate,
  referenceNumber: optionalText(PO_REFERENCE_MAX),
  note: optionalText(PO_NOTE_MAX),
});

export const poCreateSchema = poHeaderSchema.extend({
  vendorId: z.string({ message: 'Select a vendor' }).trim().min(1, 'Select a vendor'),
  lines: z
    .array(poLineSchema, { message: 'Add at least one product' })
    .min(1, 'Add at least one product')
    .max(MAX_PO_LINES, `At most ${MAX_PO_LINES} lines`),
  customFields: customFieldValuesSchema,
});
export type PoCreateInput = z.input<typeof poCreateSchema>;
export type PoCreateValues = z.output<typeof poCreateSchema>;

/** Edit: the client is locked, so it is not accepted; `version` guards stale edits. */
export const poUpdateSchema = poCreateSchema
  .omit({ clientId: true })
  .extend({
    version: z
      .number({ message: 'Version is required. Reload the purchase order and try again.' })
      .int()
      .min(1),
  });
export type PoUpdateValues = z.output<typeof poUpdateSchema>;

export const poStatusChangeSchema = z.object({
  status: z.enum(PO_STATUSES, { message: 'Choose the new status' }),
  reason: z
    .string()
    .trim()
    .min(3, 'Enter a reason (at least 3 characters)')
    .max(250, 'Use at most 250 characters'),
  version: z.number().int().min(1),
});

export const bulkIdsBodySchema = z.object({
  ids: z
    .array(z.string().trim().min(1).max(64))
    .min(1, 'Select at least one purchase order')
    .max(1000, 'At most 1000 records at once'),
});

/* ------------------------------------------------------------ receiving */

export const receiveSerialSchema = z.string().trim().min(1, "Serial number can't be empty").max(100);

export const receiveLineSchema = z.object({
  lineId: z
    .string({ message: 'Choose the purchase order line' })
    .trim()
    .min(1, 'Choose the purchase order line'),
  quantity: z
    .number({ message: 'Enter a quantity' })
    .int('Use a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(MAX_LINE_QTY),
  locationId: z.string().trim().min(1, 'Choose a receiving location'),
  lpMode: z
    .enum(['none', 'existing', 'new'], { message: 'LP mode must be none, existing or new' })
    .default('none'),
  lpId: z.string().trim().max(64).optional().nullable(),
  lpTypeId: z.string().trim().max(64).optional().nullable(),
  lotNumber: optionalText(100),
  expiryDate: optionalDay,
  productionDate: optionalDay,
  damageReason: optionalText(60),
  damageImageFileId: z.string().trim().max(64).optional().nullable(),
  serials: z.array(receiveSerialSchema).max(MAX_LINE_QTY).default([]),
  note: optionalText(500),
  /**
   * Directed putaway. `true`: the location came from the putaway suggestion. `false`: the user
   * overrode it. Omitted (API callers): the server checks whether the algorithm directs to the
   * posted location. Either way the server re-runs the algorithm and, when it still directs
   * there, records the algorithm / rule on the Receiving ledger row.
   */
  fromSuggestion: z.boolean({ message: 'fromSuggestion must be true or false' }).optional(),
  /**
   * The inputs the drawer's putaway suggestion was computed with (it may predate the lot / expiry).
   * Every key is optional; `qty` defaults to the line quantity.
   */
  suggestBasis: z
    .object({
      qty: z
        .number({ message: 'suggestBasis.qty must be a whole number of units' })
        .int('suggestBasis.qty must be a whole number of units')
        .min(1, 'suggestBasis.qty must be at least 1')
        .max(MAX_LINE_QTY)
        .optional(),
      lot: z.string().trim().max(100).nullable().optional(),
      expiry: z.string().trim().max(40).nullable().optional(),
      damageReason: z.string().trim().max(60).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type ReceiveLineInput = z.input<typeof receiveLineSchema>;
export type ReceiveLineValues = z.output<typeof receiveLineSchema>;

export const receiveBodySchema = z.object({
  lines: z.array(receiveLineSchema).min(1, 'Enter a quantity for at least one line').max(MAX_PO_LINES),
  /** Over-receipt must be confirmed explicitly. */
  allowOverReceipt: z.boolean().default(false),
  /** Receiving a lot whose expiry date has already passed must be confirmed explicitly. */
  allowExpired: z.boolean().default(false),
  version: z.number().int().min(1).optional(),
});
export type ReceiveBodyValues = z.output<typeof receiveBodySchema>;

/**
 * `POST /api/purchase-orders/[id]/receive` body. One object schema (not a union) so field
 * errors stay specific (`lines.0.quantity`, …). `{ all: true }` is a full receive; otherwise
 * `lines` is required. A line without `locationId` is received into the warehouse's default
 * receiving location (Logiwa parity); an empty `locationId` is still "Choose a receiving location".
 */
export const receiveApiBodySchema = receiveBodySchema
  .extend({
    all: z.literal(true).optional(),
    lines: z
      .array(receiveLineSchema.extend({ locationId: receiveLineSchema.shape.locationId.optional() }))
      .min(1, 'Enter a quantity for at least one line')
      .max(MAX_PO_LINES)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.all && !v.lines)
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Enter a quantity for at least one line' });
  });
export type ReceiveApiBodyValues = z.output<typeof receiveApiBodySchema>;

/** Tracking requirements of a product for receiving (flags + screen config). */
export interface TrackingRequirements {
  readonly lot: boolean;
  readonly expiry: boolean;
  readonly production: boolean;
  readonly serial: boolean;
}

/** Inline messages for missing tracking data, keyed by receive-line field. Pure (unit tested). */
export function trackingIssues(
  line: {
    lotNumber?: string | null;
    expiryDate?: string | null;
    productionDate?: string | null;
    serials?: readonly string[];
    quantity: number;
    uomRatio?: number;
  },
  req: TrackingRequirements,
  sku: string,
): Readonly<Record<string, string>> {
  const issues: Record<string, string> = {};
  if (req.lot && !line.lotNumber) issues.lotNumber = `${sku} is lot tracked: enter a lot/batch number.`;
  if (req.expiry && !line.expiryDate) issues.expiryDate = `${sku} is expiry tracked: enter an expiry date.`;
  if (req.production && !line.productionDate)
    issues.productionDate = `${sku} tracks production date: enter one.`;
  if (req.serial) {
    const need = line.quantity * (line.uomRatio ?? 1);
    const have = line.serials?.length ?? 0;
    if (have !== need)
      issues.serials = `${need} serial number${need === 1 ? '' : 's'} required; ${have} entered.`;
  }
  return issues;
}

/** Today as YYYY-MM-DD in `timeZone` (the receiving warehouse); local when omitted. */
export function todayIn(timeZone?: string, now: Date = new Date()): string {
  if (!timeZone)
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dayInZone(now.toISOString(), timeZone) ?? now.toISOString().slice(0, 10);
}

/** True when a calendar-date expiry is before `today` (both YYYY-MM-DD; expiring today is still sellable). */
export function isExpired(expiry: string | null | undefined, today: string): boolean {
  if (!expiry) return false;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(expiry.trim())?.[1];
  return Boolean(day && day < today);
}

export const EXPIRED_LOT_MESSAGE = 'This lot is already expired.';

/** Difference shown on receiving screens: received − ordered (negative = short). */
export function receivingDifference(ordered: number, received: number): number {
  return received - ordered;
}

/** Σ qty × price, rounded to cents (0.1 rule). */
export function purchasePriceOf(
  lines: readonly { readonly orderedQuantity: number; readonly unitCost: number }[],
): number {
  return Math.round(lines.reduce((sum, l) => sum + l.orderedQuantity * l.unitCost, 0) * 100) / 100;
}
