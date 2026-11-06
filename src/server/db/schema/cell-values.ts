/**
 * CellValue shapes and Zod schemas per column type.
 *
 * SHARED WITH THE CLIENT: this module must stay pure (only `zod`), no Drizzle / Node imports.
 * Items store `values: { [columnKey]: CellValue }` in a jsonb column. Computed column types
 * (progress, mirror, formula, last_updated, creation_log, item_id, button) are never stored;
 * attempts to write them are rejected by `cellValueSchemaFor`.
 */
import { z } from 'zod';

export const COLUMN_TYPES = [
  'name',
  'text',
  'long_text',
  'status',
  'people',
  'date',
  'timeline',
  'number',
  'currency',
  'email',
  'phone',
  'link',
  'dropdown',
  'tags',
  'checkbox',
  'rating',
  'progress',
  'files',
  'connect_boards',
  'mirror',
  'formula',
  'location',
  'country',
  'last_updated',
  'creation_log',
  'item_id',
  'button',
] as const;

export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Column types whose value is derived at read time and never persisted in `items.values`. */
export const COMPUTED_COLUMN_TYPES = [
  'progress',
  'mirror',
  'formula',
  'last_updated',
  'creation_log',
  'item_id',
  'button',
] as const satisfies readonly ColumnType[];

export type ComputedColumnType = (typeof COMPUTED_COLUMN_TYPES)[number];
export type StoredColumnType = Exclude<ColumnType, ComputedColumnType>;

export function isColumnType(value: unknown): value is ColumnType {
  return typeof value === 'string' && (COLUMN_TYPES as readonly string[]).includes(value);
}

export function isComputedColumnType(type: ColumnType): type is ComputedColumnType {
  return (COMPUTED_COLUMN_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------------------------

/** Stable short id used for labels, column keys, etc. (nanoid-style). */
export const shortIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Must contain only letters, digits, "_" or "-"');

export const isoDateSchema = z.iso.date();
/** 24h time `HH:MM` (optional seconds). */
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM');
/** ISO 4217 currency code. */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected a 3-letter ISO 4217 currency code');
/** ISO 3166-1 alpha-2 country code. */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Expected a 2-letter ISO 3166 country code');

const MAX_TEXT = 2_000;
const MAX_LONG_TEXT = 50_000;
const MAX_REFS = 500;

// ---------------------------------------------------------------------------------------------
// Value schemas (stored types)
// ---------------------------------------------------------------------------------------------

export const nameValueSchema = z.string().trim().min(1).max(MAX_TEXT);
export const textValueSchema = z.string().max(MAX_TEXT);
export const longTextValueSchema = z.string().max(MAX_LONG_TEXT);
export const statusValueSchema = z.object({ labelId: shortIdSchema }).strict();
export const peopleValueSchema = z
  .object({
    ids: z.array(z.uuid()).max(MAX_REFS),
    teamIds: z.array(z.uuid()).max(MAX_REFS).optional(),
  })
  .strict();
export const dateValueSchema = z.object({ date: isoDateSchema, time: timeOfDaySchema.optional() }).strict();
export const timelineValueSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine((value) => value.from <= value.to, { message: 'Timeline start must be on or before its end' });
export const numberValueSchema = z.number().finite();
export const currencyValueSchema = z
  .object({ amount: z.number().finite(), currency: currencyCodeSchema })
  .strict();
export const emailValueSchema = z
  .object({ email: z.email().max(320), label: z.string().max(200).optional() })
  .strict();
export const phoneValueSchema = z
  .object({
    phone: z
      .string()
      .min(3)
      .max(32)
      .regex(/^\+?[0-9 ().-]+$/, 'Invalid phone number'),
    country: countryCodeSchema.optional(),
  })
  .strict();
export const linkValueSchema = z
  .object({
    url: z.url({ protocol: /^https?$/, hostname: z.regexes.domain }).max(2_048),
    text: z.string().max(500).optional(),
  })
  .strict();
export const dropdownValueSchema = z.object({ labelIds: z.array(shortIdSchema).max(MAX_REFS) }).strict();
export const tagsValueSchema = z
  .object({ tags: z.array(z.string().trim().min(1).max(64)).max(100) })
  .strict();
export const checkboxValueSchema = z.boolean();
export const ratingValueSchema = z.number().int().min(0).max(10);
export const filesValueSchema = z.object({ fileIds: z.array(z.uuid()).max(MAX_REFS) }).strict();
export const connectBoardsValueSchema = z.object({ itemIds: z.array(z.uuid()).max(MAX_REFS) }).strict();
export const locationValueSchema = z
  .object({
    address: z.string().min(1).max(500),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();
export const countryValueSchema = z.object({ code: countryCodeSchema }).strict();

export const STORED_VALUE_SCHEMAS = {
  name: nameValueSchema,
  text: textValueSchema,
  long_text: longTextValueSchema,
  status: statusValueSchema,
  people: peopleValueSchema,
  date: dateValueSchema,
  timeline: timelineValueSchema,
  number: numberValueSchema,
  currency: currencyValueSchema,
  email: emailValueSchema,
  phone: phoneValueSchema,
  link: linkValueSchema,
  dropdown: dropdownValueSchema,
  tags: tagsValueSchema,
  checkbox: checkboxValueSchema,
  rating: ratingValueSchema,
  files: filesValueSchema,
  connect_boards: connectBoardsValueSchema,
  location: locationValueSchema,
  country: countryValueSchema,
} as const satisfies Record<StoredColumnType, z.ZodType>;

export type StoredCellValueMap = { [K in StoredColumnType]: z.infer<(typeof STORED_VALUE_SCHEMAS)[K]> };

export type NameValue = StoredCellValueMap['name'];
export type TextValue = StoredCellValueMap['text'];
export type LongTextValue = StoredCellValueMap['long_text'];
export type StatusValue = StoredCellValueMap['status'];
export type PeopleValue = StoredCellValueMap['people'];
export type DateValue = StoredCellValueMap['date'];
export type TimelineValue = StoredCellValueMap['timeline'];
export type NumberValue = StoredCellValueMap['number'];
export type CurrencyValue = StoredCellValueMap['currency'];
export type EmailValue = StoredCellValueMap['email'];
export type PhoneValue = StoredCellValueMap['phone'];
export type LinkValue = StoredCellValueMap['link'];
export type DropdownValue = StoredCellValueMap['dropdown'];
export type TagsValue = StoredCellValueMap['tags'];
export type CheckboxValue = StoredCellValueMap['checkbox'];
export type RatingValue = StoredCellValueMap['rating'];
export type FilesValue = StoredCellValueMap['files'];
export type ConnectBoardsValue = StoredCellValueMap['connect_boards'];
export type LocationValue = StoredCellValueMap['location'];
export type CountryValue = StoredCellValueMap['country'];

// ---------------------------------------------------------------------------------------------
// Computed (read-time) value shapes, returned by services alongside stored values
// ---------------------------------------------------------------------------------------------

/** 0–100, derived from status/checkbox columns listed in the progress column settings. */
export type ProgressValue = number;
export type MirrorValue = { readonly display: string; readonly values: readonly unknown[] };
export type FormulaValue = { readonly result: number | string | boolean | null; readonly error?: string };
export type LastUpdatedValue = { readonly at: string; readonly userId: string | null };
export type CreationLogValue = { readonly at: string; readonly userId: string | null };
export type ItemIdValue = string;
export type ButtonValue = null;

export interface ComputedCellValueMap {
  progress: ProgressValue;
  mirror: MirrorValue;
  formula: FormulaValue;
  last_updated: LastUpdatedValue;
  creation_log: CreationLogValue;
  item_id: ItemIdValue;
  button: ButtonValue;
}

export type CellValueMap = StoredCellValueMap & ComputedCellValueMap;
export type CellValueOf<T extends ColumnType> = CellValueMap[T];
/** Any persisted cell value. */
export type StoredCellValue = StoredCellValueMap[StoredColumnType];
/** Any cell value, stored or computed. */
export type CellValue = CellValueMap[ColumnType];

/** The jsonb document in `items.values`: column key → stored value. `null` clears a cell. */
export type ItemValues = Record<string, StoredCellValue>;

/**
 * Returns the Zod schema validating a write of `type`. `null` (clear the cell) is always
 * accepted. Computed types return a schema that rejects every value.
 */
export function cellValueSchemaFor(type: ColumnType): z.ZodType<StoredCellValue | null> {
  if (isComputedColumnType(type)) {
    return z.never({ error: `Column type "${type}" is computed and cannot be written` }) as z.ZodType<never>;
  }
  return (STORED_VALUE_SCHEMAS[type] as z.ZodType<StoredCellValue>).nullable();
}

export type CellValidationResult =
  | { readonly ok: true; readonly value: StoredCellValue | null }
  | { readonly ok: false; readonly message: string };

/** Validate a single cell write without throwing. */
export function validateCellValue(type: ColumnType, value: unknown): CellValidationResult {
  const result = cellValueSchemaFor(type).safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, message: result.error.issues.map((issue) => issue.message).join('; ') };
}

/** A cell is "empty" when it carries no user-visible content (used by filters & summaries). */
export function isEmptyCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (typeof value === 'boolean') return value === false;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['ids', 'labelIds', 'tags', 'fileIds', 'itemIds']) {
      const entry = record[key];
      if (Array.isArray(entry)) return entry.length === 0;
    }
    return Object.keys(record).length === 0;
  }
  return false;
}

export * from './column-types';
