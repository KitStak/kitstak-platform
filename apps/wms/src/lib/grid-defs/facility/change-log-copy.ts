/**
 * Change-log copy for every M10 entity (critic R4: "Lp type KS-… is created.", raw labels such
 * as "Is Locked" / "Max Sku Qty", and a double space when the old value was empty). PURE: shared
 * by the module's change-log writers and their tests.
 */

/** Display name per M10 entity type ("LP Type KS-TOTE is created."). */
export const FACILITY_ENTITY_LABELS: Readonly<Record<string, string>> = {
  location: 'Location',
  warehouse: 'Warehouse',
  lp_type: 'LP Type',
  license_plate: 'LP Number',
  mobile_cart: 'Mobile Cart',
  shipment_package: 'Shipment Package',
};

/** Fields whose generated label reads wrong; everything else is split camel case, sentence case. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  isLocked: 'Locked',
  isActive: 'Active',
  isDefault: 'Default',
  maxSkuQty: 'Max SKU qty',
  maxCapacityQty: 'Max capacity qty',
  abcCode: 'ABC code',
  lpTypeId: 'LP type',
  lpType: 'LP type',
  parentLpId: 'Parent LP',
  sscc: 'SSCC',
  numberPrefix: 'Number prefix',
  onlyOneSku: 'Only 1 SKU',
  onlyOneLot: 'Only 1 lot batch number',
  onlyOneExpiry: 'Only 1 expiry date',
  onlyOneProductionDate: 'Only 1 production date',
  onlyOneClient: 'Only 1 client',
  onlyOneOrder: 'Only 1 order',
  onlyOneJob: 'Only 1 job',
  useForAiJob: 'Use for AI job',
  suitableForParentLp: 'Suitable for parent LP',
  useLpDimsForPutaway: 'Use LP dimensions for putaway',
  mobileAutoLogout: 'Mobile auto logout',
  dedicatedClient: 'Dedicated client',
};

const ACRONYMS: Readonly<Record<string, string>> = {
  sku: 'SKU',
  lp: 'LP',
  abc: 'ABC',
  ai: 'AI',
  id: 'ID',
  sscc: 'SSCC',
  ups: 'UPS',
  qty: 'qty',
};

/** "walkingPathPriority" → "Walking path priority", "isLocked" → "Locked", "maxSkuQty" → "Max SKU qty". */
export function facilityFieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const custom = /^customFields\.(.+)$/.exec(field);
  if (custom?.[1]) return custom[1];
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]+/g, ' ')
    .trim()
    .split(/\s+/);
  if (words.length > 1 && /^is$/i.test(words[0] ?? '')) words.shift();
  const out = words.map((w, i) => {
    const acronym = ACRONYMS[w.toLowerCase()];
    if (acronym) return acronym;
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
  });
  return out.join(' ');
}

/** "LP Type KS-TOTE" (or just "LP Type" without a code). */
export function facilityEntityName(entityType: string, code: string | null | undefined): string {
  const label = FACILITY_ENTITY_LABELS[entityType] ?? facilityFieldLabel(entityType);
  return code ? `${label} ${code}` : label;
}

/** A stored side of a change: empty reads "(blank)", so the sentence never has a double space. */
export function blankAware(value: string): string {
  return value.trim() === '' ? '(blank)' : value;
}

/** "Walking path priority is modified. (blank) --> 77" */
export function facilityUpdateMessage(label: string, from: string, to: string): string {
  return `${label} is modified. ${blankAware(from)} --> ${blankAware(to)}`;
}

/* ---------------- capacity lines (location wizard steps 2 and 3) ---------------- */

export interface CapacityLine {
  /** Identity of the line: product + pack type, or LP type + product. */
  readonly key: string;
  /** What the line is about: "APX-TEE (Each)" or "PLT" / "PLT · APX-TEE". */
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

export interface CapacityChange {
  readonly type: 'Create' | 'Update' | 'Delete';
  readonly field: 'productCapacity' | 'lpCapacity';
  readonly fieldLabel: string;
  readonly from: string;
  readonly to: string;
  readonly message: string;
}

const KIND: Readonly<Record<CapacityChange['field'], string>> = {
  productCapacity: 'Product capacity',
  lpCapacity: 'LP capacity',
};
const minMax = (c: CapacityLine) =>
  `Min ${c.min.toLocaleString('en-US')}, Max ${c.max.toLocaleString('en-US')}`;

/**
 * One change per added, edited or removed capacity line, e.g.
 * "APX-KIT-TEE3 (Each) -> Product capacity is created. Min 10, Max 50". Ordered by label.
 */
export function capacityLineChanges(
  field: CapacityChange['field'],
  before: readonly CapacityLine[],
  after: readonly CapacityLine[],
): CapacityChange[] {
  const kind = KIND[field];
  const was = new Map(before.map((c) => [c.key, c]));
  const now = new Map(after.map((c) => [c.key, c]));
  const out: { label: string; change: CapacityChange }[] = [];
  for (const c of after) {
    const old = was.get(c.key);
    if (!old) {
      out.push({
        label: c.label,
        change: {
          type: 'Create',
          field,
          fieldLabel: `${c.label} · ${kind}`,
          from: '',
          to: minMax(c),
          message: `${c.label} -> ${kind} is created. ${minMax(c)}`,
        },
      });
    } else if (old.min !== c.min || old.max !== c.max) {
      out.push({
        label: c.label,
        change: {
          type: 'Update',
          field,
          fieldLabel: `${c.label} · ${kind}`,
          from: minMax(old),
          to: minMax(c),
          message: `${c.label} -> ${kind} is modified. ${minMax(old)} --> ${minMax(c)}`,
        },
      });
    }
  }
  for (const c of before) {
    if (!now.has(c.key))
      out.push({
        label: c.label,
        change: {
          type: 'Delete',
          field,
          fieldLabel: `${c.label} · ${kind}`,
          from: minMax(c),
          to: '',
          message: `${c.label} -> ${kind} is deleted. Was ${minMax(c)}`,
        },
      });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label)).map((o) => o.change);
}

/* ---------------- read-side normalization (critic R5) ---------------- */

/** Fields whose label is derived from the field key (capacity lines carry their own label). */
const DERIVED_LABEL_FIELD = /^(?:[a-z][A-Za-z0-9]*|customFields\.[^.]+)$/;
const CAPACITY_FIELDS: ReadonlySet<string> = new Set(['productCapacity', 'lpCapacity']);

export interface StoredChangeRow {
  readonly type: string;
  readonly field: string | null;
  readonly fieldLabel: string | null;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly message: string;
}

/**
 * Stored rows from earlier rounds read "Is Locked is modified" / "Max Sku Qty" while new rows
 * read "Locked" / "Max SKU qty" (critic R5). On read, every field-level Update row takes its
 * label from the field key and its sentence is rebuilt, so one history never mixes two names.
 */
export function normalizeChangeRow<T extends StoredChangeRow>(row: T): T {
  if (
    row.type !== 'Update' ||
    !row.field ||
    CAPACITY_FIELDS.has(row.field) ||
    !DERIVED_LABEL_FIELD.test(row.field)
  )
    return row;
  const label = facilityFieldLabel(row.field);
  return {
    ...row,
    fieldLabel: label,
    message: facilityUpdateMessage(label, row.fromValue ?? '', row.toValue ?? ''),
  };
}

export type ChangeChannel = 'UI' | 'Import' | 'Integration' | 'Workflow' | 'System';

/**
 * Logiwa's SOURCE column: which channel made the change. Rows written by a signed-in user store
 * the user's email (UI); M10 imports store "Import · <email>"; integrations, workflows and
 * background jobs store their own name.
 */
export function changeChannel(source: string | null | undefined): ChangeChannel {
  const s = (source ?? '').trim();
  if (/^import\b/i.test(s)) return 'Import';
  if (/integration|webhook|\bapi\b|shopify|amazon|edi/i.test(s)) return 'Integration';
  if (/^workflow\b/i.test(s)) return 'Workflow';
  if (s.includes('@') || /^(web|ui)$/i.test(s)) return 'UI';
  return 'System';
}

/** The user an import / UI source names ("Import · a@b.io" → "a@b.io"), or null. */
export function changeSourceUser(source: string | null | undefined): string | null {
  const m = /([^\s·]+@[^\s·]+)/.exec(source ?? '');
  return m?.[1] ?? null;
}
