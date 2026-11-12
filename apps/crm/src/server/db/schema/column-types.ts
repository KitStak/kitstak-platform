/**
 * Column-type registry: per-type settings schema, default settings, default width,
 * group-footer summary kind and UI metadata. SHARED WITH THE CLIENT (pure, zod only).
 *
 * Only type-level imports from `./cell-values` to avoid a runtime import cycle.
 */
import { z } from 'zod';
import type { ColumnType } from './cell-values';

// ---------------------------------------------------------------------------------------------
// Label palette (token names). The design system maps each to `--label-<name>` in tokens.css.
// Semantic defaults: green = Done, orange = Working on it, red = Stuck, gray = default/empty.
// ---------------------------------------------------------------------------------------------

export const LABEL_COLORS = [
  'green',
  'orange',
  'red',
  'gray',
  'blue',
  'dark-blue',
  'purple',
  'pink',
  'teal',
  'yellow',
  'lime',
  'brown',
  'sky',
  'berry',
  'indigo',
  'peach',
  'green-light',
  'orange-light',
  'red-light',
  'blue-light',
  'purple-light',
  'pink-light',
  'teal-light',
  'yellow-light',
] as const;

export type LabelColor = (typeof LABEL_COLORS)[number];
export const labelColorSchema = z.enum(LABEL_COLORS);

const labelIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const labelSchema = z
  .object({
    id: labelIdSchema,
    name: z.string().max(100),
    color: labelColorSchema,
    position: z.number().int().min(0),
    /** Marks a "done" label: drives progress, battery and completion automations. */
    isDone: z.boolean().optional(),
    /** The label shown for empty cells (rendered gray, never stored). */
    isDefault: z.boolean().optional(),
  })
  .strict();
export type Label = z.infer<typeof labelSchema>;

const labelsSettingsSchema = z
  .object({ labels: z.array(labelSchema).max(200) })
  .strict()
  .refine((value) => new Set(value.labels.map((label) => label.id)).size === value.labels.length, {
    message: 'Label ids must be unique',
  });

// ---------------------------------------------------------------------------------------------
// Settings schemas per type
// ---------------------------------------------------------------------------------------------

const empty = z.object({}).strict();
const numberFormat = z.enum(['plain', 'compact', 'percent']);
const numberSummaryFn = z.enum(['sum', 'average', 'median', 'min', 'max', 'count', 'none']);

export const COLUMN_SETTINGS_SCHEMAS = {
  name: empty,
  text: empty,
  long_text: empty,
  status: labelsSettingsSchema,
  people: z
    .object({ allowMultiple: z.boolean().default(true), allowTeams: z.boolean().default(false) })
    .strict(),
  date: z
    .object({
      includeTime: z.boolean().default(false),
      format: z.enum(['relative', 'short', 'long', 'iso']).default('short'),
    })
    .strict(),
  timeline: z.object({ showDuration: z.boolean().default(false) }).strict(),
  number: z
    .object({
      unit: z.string().max(10).optional(),
      unitPosition: z.enum(['prefix', 'suffix']).default('suffix'),
      decimals: z.number().int().min(0).max(6).default(0),
      format: numberFormat.default('plain'),
      summary: numberSummaryFn.default('sum'),
    })
    .strict(),
  currency: z
    .object({
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .default('USD'),
      decimals: z.number().int().min(0).max(4).default(0),
      summary: numberSummaryFn.default('sum'),
    })
    .strict(),
  email: empty,
  phone: z
    .object({
      defaultCountry: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    })
    .strict(),
  link: empty,
  dropdown: labelsSettingsSchema,
  tags: z.object({ suggestions: z.array(z.string().max(64)).max(500).default([]) }).strict(),
  checkbox: empty,
  rating: z.object({ max: z.number().int().min(1).max(10).default(5) }).strict(),
  progress: z.object({ sourceColumnKeys: z.array(labelIdSchema).max(50).default([]) }).strict(),
  files: z.object({ allowedMimePrefixes: z.array(z.string().max(100)).max(50).optional() }).strict(),
  connect_boards: z
    .object({
      boardIds: z.array(z.uuid()).max(20).default([]),
      allowMultiple: z.boolean().default(true),
      /** Key of the reciprocal connect column on the linked board, if two-way. */
      reciprocalColumnKey: labelIdSchema.optional(),
    })
    .strict(),
  mirror: z
    .object({
      connectColumnKey: labelIdSchema.optional(),
      mirroredColumnKeys: z.record(z.uuid(), labelIdSchema).default({}),
      aggregate: z
        .enum(['list', 'sum', 'average', 'min', 'max', 'count', 'earliest', 'latest'])
        .default('list'),
    })
    .strict(),
  formula: z.object({ expression: z.string().max(4_000).default('') }).strict(),
  location: empty,
  country: empty,
  last_updated: empty,
  creation_log: empty,
  item_id: empty,
  button: z
    .object({
      label: z.string().min(1).max(50).default('Click me'),
      color: labelColorSchema.default('blue'),
      automationId: z.uuid().optional(),
    })
    .strict(),
} as const satisfies Record<ColumnType, z.ZodType>;

export type ColumnSettingsMap = { [K in ColumnType]: z.output<(typeof COLUMN_SETTINGS_SCHEMAS)[K]> };
export type ColumnSettings = ColumnSettingsMap[ColumnType];

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

/** How the group footer / board summary aggregates the column. */
export type SummaryKind =
  | 'none'
  | 'battery' // stacked label distribution bar (status / dropdown / checkbox)
  | 'numeric' // sum/avg/... per settings.summary (number / currency / rating / progress / formula)
  | 'date_range' // earliest → latest (date / timeline)
  | 'people' // avatar stack of distinct people
  | 'count'; // count of non-empty cells

export type ColumnCategory = 'essentials' | 'people' | 'time' | 'numbers' | 'contact' | 'relations' | 'meta';

export interface ColumnTypeDefinition<T extends ColumnType = ColumnType> {
  readonly type: T;
  readonly label: string;
  readonly description: string;
  /** lucide-react icon name used in the column picker and header. */
  readonly icon: string;
  readonly category: ColumnCategory;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly summary: SummaryKind;
  readonly computed: boolean;
  readonly sortable: boolean;
  readonly filterable: boolean;
  /** Only one per board (name, item_id...) and not offered in the "add column" picker. */
  readonly unique: boolean;
  readonly defaultSettings: () => ColumnSettingsMap[T];
}

const STATUS_DEFAULT_LABELS: readonly Label[] = [
  { id: 'working', name: 'Working on it', color: 'orange', position: 0 },
  { id: 'done', name: 'Done', color: 'green', position: 1, isDone: true },
  { id: 'stuck', name: 'Stuck', color: 'red', position: 2 },
  { id: 'default', name: '', color: 'gray', position: 3, isDefault: true },
];

const DROPDOWN_DEFAULT_LABELS: readonly Label[] = [];

function def<T extends ColumnType>(
  type: T,
  meta: Omit<ColumnTypeDefinition<T>, 'type' | 'defaultSettings' | 'computed' | 'unique' | 'minWidth'> & {
    readonly computed?: boolean;
    readonly unique?: boolean;
    readonly minWidth?: number;
    readonly defaults?: () => ColumnSettingsMap[T];
  },
): ColumnTypeDefinition<T> {
  const { defaults, computed = false, unique = false, minWidth = 60, ...rest } = meta;
  return {
    type,
    computed,
    unique,
    minWidth,
    ...rest,
    defaultSettings: defaults ?? (() => COLUMN_SETTINGS_SCHEMAS[type].parse({}) as ColumnSettingsMap[T]),
  };
}

const base = { sortable: true, filterable: true } as const;

export const COLUMN_TYPE_REGISTRY: { readonly [K in ColumnType]: ColumnTypeDefinition<K> } = {
  name: def('name', {
    ...base,
    label: 'Name',
    description: 'The item name',
    icon: 'Type',
    category: 'essentials',
    // The name cell reserves ~165px for its affordances (expand toggle, rename pencil, the
    // "Open" reveal spacer and the updates bubble), so typical seeded deal names (~320-345px
    // of text) need ~520px before they stop ellipsizing.
    defaultWidth: 520,
    minWidth: 200,
    summary: 'none',
    unique: true,
  }),
  text: def('text', {
    ...base,
    label: 'Text',
    description: 'Short free text',
    icon: 'Type',
    category: 'essentials',
    defaultWidth: 180,
    summary: 'count',
  }),
  long_text: def('long_text', {
    ...base,
    sortable: false,
    label: 'Long text',
    description: 'Multi-line notes',
    icon: 'AlignLeft',
    category: 'essentials',
    defaultWidth: 220,
    summary: 'count',
  }),
  status: def('status', {
    ...base,
    label: 'Status',
    description: 'Colored labels to track progress',
    icon: 'CircleDot',
    category: 'essentials',
    defaultWidth: 160,
    summary: 'battery',
    defaults: () => ({ labels: STATUS_DEFAULT_LABELS.map((label) => ({ ...label })) }),
  }),
  people: def('people', {
    ...base,
    label: 'People',
    description: 'Assign owners and collaborators',
    icon: 'Users',
    category: 'people',
    defaultWidth: 140,
    summary: 'people',
  }),
  date: def('date', {
    ...base,
    label: 'Date',
    description: 'Due dates and deadlines',
    icon: 'Calendar',
    category: 'time',
    defaultWidth: 140,
    summary: 'date_range',
  }),
  timeline: def('timeline', {
    ...base,
    label: 'Timeline',
    description: 'Start and end dates',
    icon: 'CalendarRange',
    category: 'time',
    defaultWidth: 180,
    summary: 'date_range',
  }),
  number: def('number', {
    ...base,
    label: 'Numbers',
    description: 'Numeric values with sums',
    icon: 'Hash',
    category: 'numbers',
    defaultWidth: 130,
    summary: 'numeric',
  }),
  currency: def('currency', {
    ...base,
    label: 'Currency',
    description: 'Monetary amounts',
    icon: 'DollarSign',
    category: 'numbers',
    defaultWidth: 140,
    summary: 'numeric',
  }),
  email: def('email', {
    ...base,
    label: 'Email',
    description: 'Email addresses',
    icon: 'Mail',
    category: 'contact',
    defaultWidth: 200,
    summary: 'count',
  }),
  phone: def('phone', {
    ...base,
    label: 'Phone',
    description: 'Phone numbers with country',
    icon: 'Phone',
    category: 'contact',
    defaultWidth: 160,
    summary: 'count',
  }),
  link: def('link', {
    ...base,
    label: 'Link',
    description: 'Web links',
    icon: 'Link',
    category: 'contact',
    defaultWidth: 180,
    summary: 'count',
  }),
  dropdown: def('dropdown', {
    ...base,
    label: 'Dropdown',
    description: 'Multi-select labels',
    icon: 'ListChecks',
    category: 'essentials',
    defaultWidth: 180,
    summary: 'battery',
    defaults: () => ({ labels: DROPDOWN_DEFAULT_LABELS.map((label) => ({ ...label })) }),
  }),
  tags: def('tags', {
    ...base,
    label: 'Tags',
    description: 'Free-form tags',
    icon: 'Tag',
    category: 'essentials',
    defaultWidth: 180,
    summary: 'count',
  }),
  checkbox: def('checkbox', {
    ...base,
    label: 'Checkbox',
    description: 'Yes / no',
    icon: 'SquareCheck',
    category: 'essentials',
    defaultWidth: 100,
    summary: 'battery',
  }),
  rating: def('rating', {
    ...base,
    label: 'Rating',
    description: 'Star rating',
    icon: 'Star',
    category: 'numbers',
    defaultWidth: 140,
    summary: 'numeric',
  }),
  progress: def('progress', {
    ...base,
    label: 'Progress',
    description: 'Completion from status columns',
    icon: 'Gauge',
    category: 'numbers',
    defaultWidth: 160,
    summary: 'numeric',
    computed: true,
  }),
  files: def('files', {
    ...base,
    sortable: false,
    label: 'Files',
    description: 'Attachments',
    icon: 'Paperclip',
    category: 'essentials',
    defaultWidth: 140,
    summary: 'count',
  }),
  connect_boards: def('connect_boards', {
    ...base,
    label: 'Connect boards',
    description: 'Link items across boards',
    icon: 'Cable',
    category: 'relations',
    defaultWidth: 200,
    summary: 'count',
  }),
  mirror: def('mirror', {
    ...base,
    label: 'Mirror',
    description: 'Show values from connected items',
    icon: 'Copy',
    category: 'relations',
    defaultWidth: 180,
    summary: 'numeric',
    computed: true,
  }),
  formula: def('formula', {
    ...base,
    label: 'Formula',
    description: 'Calculate from other columns',
    icon: 'Sigma',
    category: 'numbers',
    defaultWidth: 160,
    summary: 'numeric',
    computed: true,
  }),
  location: def('location', {
    ...base,
    label: 'Location',
    description: 'Addresses and places',
    icon: 'MapPin',
    category: 'contact',
    defaultWidth: 200,
    summary: 'count',
  }),
  country: def('country', {
    ...base,
    label: 'Country',
    description: 'Country with flag',
    icon: 'Flag',
    category: 'contact',
    defaultWidth: 150,
    summary: 'count',
  }),
  last_updated: def('last_updated', {
    ...base,
    label: 'Last updated',
    description: 'When and by whom',
    icon: 'History',
    category: 'meta',
    defaultWidth: 170,
    summary: 'none',
    computed: true,
    unique: true,
  }),
  creation_log: def('creation_log', {
    ...base,
    label: 'Creation log',
    description: 'Created at and by',
    icon: 'CalendarPlus',
    category: 'meta',
    defaultWidth: 170,
    summary: 'none',
    computed: true,
    unique: true,
  }),
  item_id: def('item_id', {
    ...base,
    label: 'Item ID',
    description: 'Unique item identifier',
    icon: 'Fingerprint',
    category: 'meta',
    defaultWidth: 140,
    summary: 'none',
    computed: true,
    unique: true,
  }),
  button: def('button', {
    sortable: false,
    filterable: false,
    label: 'Button',
    description: 'Run an action with one click',
    icon: 'MousePointerClick',
    category: 'meta',
    defaultWidth: 140,
    summary: 'none',
    computed: true,
  }),
};

export function getColumnTypeDefinition<T extends ColumnType>(type: T): ColumnTypeDefinition<T> {
  return COLUMN_TYPE_REGISTRY[type];
}

/** Average glyph width used to approximate header text (matches board-table's `approxMeasure`). */
const APPROX_GLYPH_WIDTH = 7.4;
/** Header padding + reveal-on-hover menu button around the title (matches board-table's chrome). */
const HEADER_CHROME = 48;

/**
 * Stored width for a new column without an explicit width: the registry default, widened so
 * `title` fits the header. Stored widths are honored as-is by the table, so the title fit is
 * baked in at creation time; templates that set a width deliberately keep their narrow pick.
 */
export function defaultStoredWidth(type: ColumnType, title: string): number {
  const definition = COLUMN_TYPE_REGISTRY[type];
  return Math.max(definition.defaultWidth, Math.ceil(title.length * APPROX_GLYPH_WIDTH + HEADER_CHROME));
}

/** Validate (and fill defaults for) column settings of the given type. */
export function parseColumnSettings<T extends ColumnType>(type: T, settings: unknown): ColumnSettingsMap[T] {
  return COLUMN_SETTINGS_SCHEMAS[type].parse(settings ?? {}) as ColumnSettingsMap[T];
}

export function safeParseColumnSettings<T extends ColumnType>(
  type: T,
  settings: unknown,
): { ok: true; settings: ColumnSettingsMap[T] } | { ok: false; message: string } {
  const result = COLUMN_SETTINGS_SCHEMAS[type].safeParse(settings ?? {});
  if (result.success) return { ok: true, settings: result.data as ColumnSettingsMap[T] };
  return { ok: false, message: result.error.issues.map((issue) => issue.message).join('; ') };
}
