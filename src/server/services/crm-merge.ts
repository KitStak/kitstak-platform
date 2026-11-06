/**
 * Pure merge planning for duplicate records (client-safe, no db imports): which values the kept
 * record ends up with. Order of precedence per column:
 *   1. an explicit field choice (the user picked a duplicate's value in the compare grid),
 *   2. the kept record's own non-empty value,
 *   3. the first duplicate with a value (fill empty),
 * and connect_boards relations are unioned (never pointing at the merged-away records).
 */

/** Column types that are computed or relational and never compared / copied field-by-field. */
export const NON_COMPARABLE_TYPES: ReadonlySet<string> = new Set([
  'connect_boards',
  'mirror',
  'formula',
  'auto_number',
  'creation_log',
  'last_updated',
  'item_id',
  'button',
  'dependency',
  'subtasks',
  'files',
]);

export interface MergeColumn {
  readonly key: string;
  readonly title: string;
  readonly type: string;
  readonly scope: string;
  readonly settings: unknown;
}

export interface MergeRecord {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function connectIds(values: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = values[key];
  const ids = value && typeof value === 'object' ? (value as { itemIds?: unknown }).itemIds : undefined;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function buildPrimaryPatch(
  columns: readonly MergeColumn[],
  primary: MergeRecord,
  duplicates: readonly MergeRecord[],
  fieldChoices: Readonly<Record<string, string>> = {},
): { patch: Record<string, unknown>; filled: string[] } {
  const duplicateIds = duplicates.map((row) => row.id);
  const everyone = [primary, ...duplicates];
  const patch: Record<string, unknown> = {};
  const filled: string[] = [];
  for (const column of columns) {
    if (column.scope !== 'item' || column.key === 'name') continue;
    if (column.type === 'connect_boards') {
      const union = [...new Set(everyone.flatMap((row) => connectIds(row.values, column.key)))].filter(
        (id) => !duplicateIds.includes(id) && id !== primary.id,
      );
      const allowMultiple = (column.settings as { allowMultiple?: boolean } | null)?.allowMultiple !== false;
      const next = allowMultiple ? union : union.slice(0, 1);
      const current = connectIds(primary.values, column.key);
      if (next.length !== current.length || next.some((id) => !current.includes(id))) {
        patch[column.key] = next.length > 0 ? { itemIds: next } : null;
      }
      continue;
    }
    if (NON_COMPARABLE_TYPES.has(column.type)) continue;
    const chosenId = fieldChoices[column.key];
    const chosen = chosenId ? everyone.find((row) => row.id === chosenId) : undefined;
    if (chosen && chosen.id !== primary.id) {
      const value = chosen.values[column.key];
      if (JSON.stringify(value ?? null) !== JSON.stringify(primary.values[column.key] ?? null)) {
        patch[column.key] = isEmptyValue(value) ? null : value;
        filled.push(column.title);
      }
      continue;
    }
    if (chosen || !isEmptyValue(primary.values[column.key])) continue;
    const donor = duplicates.find((row) => !isEmptyValue(row.values[column.key]));
    if (donor) {
      patch[column.key] = donor.values[column.key];
      filled.push(column.title);
    }
  }
  return { patch, filled };
}
