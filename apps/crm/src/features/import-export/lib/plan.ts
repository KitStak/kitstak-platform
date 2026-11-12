/**
 * Turns a mapping into a concrete column plan (resolved target columns, new columns, label
 * additions) and converts file rows into import payloads + per-row issues. The same plan drives
 * the preview, validation, and the actual import, so what you see is exactly what lands.
 */
import type { Label } from '@/server/db/schema/cell-values';
import { convertValue, planLabels, stableLabelId, type ConvertContext } from './convert';
import { stripFormulaGuard } from './csv';
import { splitList } from './parse-values';
import type {
  ColumnMapping,
  ColumnProfile,
  CreatableType,
  DedupeConfig,
  ImportRowPayload,
  RowIssue,
  TargetColumn,
} from './types';
import { COLUMN_TYPE_REGISTRY } from '@/server/db/schema/column-types';

export interface PlannedColumn {
  readonly sourceIndex: number;
  /** Resolved target (virtual key `new_<index>` for columns that don't exist yet). */
  readonly column: TargetColumn;
  readonly isNew: boolean;
  /** Existing status/dropdown column whose labels must be extended before import. */
  readonly labelUpdate?: { readonly columnKey: string; readonly labels: Label[]; readonly added: number };
  readonly addedLabels: number;
}

export interface ColumnPlan {
  readonly nameIndex: number | null;
  /** File column whose values pick the group each row lands in. */
  readonly groupIndex: number | null;
  readonly columns: readonly PlannedColumn[];
}

export function newColumnRef(sourceIndex: number): string {
  return `new_${sourceIndex}`;
}

function distinctFor(profile: ColumnProfile | undefined, values: readonly string[], multi: boolean): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    for (const part of multi ? splitList(raw) : [raw.trim()]) {
      if (part && !seen.has(part.toLowerCase())) seen.set(part.toLowerCase(), part);
    }
  }
  return seen.size ? [...seen.values()] : [...(profile?.distinct ?? [])];
}

export function buildColumnPlan(
  mappings: readonly ColumnMapping[],
  profiles: readonly ColumnProfile[],
  boardColumns: readonly TargetColumn[],
  dataRows: readonly (readonly string[])[],
  options: { readonly maxLabels?: number } = {},
): ColumnPlan {
  let nameIndex: number | null = null;
  let groupIndex: number | null = null;
  const columns: PlannedColumn[] = [];
  for (const mapping of mappings) {
    const { target, sourceIndex } = mapping;
    const profile = profiles[sourceIndex];
    if (target.kind === 'skip') continue;
    if (target.kind === 'group') {
      groupIndex ??= sourceIndex;
      continue;
    }
    if (target.kind === 'name') {
      nameIndex ??= sourceIndex;
      continue;
    }
    const values = dataRows.map((row) => row[sourceIndex] ?? '');
    if (target.kind === 'new') {
      const type: CreatableType = target.type;
      let settings: unknown = COLUMN_TYPE_REGISTRY[type].defaultSettings();
      let added = 0;
      if (type === 'status' || type === 'dropdown') {
        const plan = planLabels(null, distinctFor(profile, values, type === 'dropdown'), {
          isStatus: type === 'status',
          max: options.maxLabels,
          idFactory: (name) => stableLabelId(`${sourceIndex}:${name.toLowerCase()}`),
        });
        settings = { labels: plan.labels };
        added = plan.added.length;
      }
      if (type === 'currency' && profile?.currency) settings = { ...(settings as object), currency: profile.currency };
      columns.push({
        sourceIndex,
        column: { key: newColumnRef(sourceIndex), title: target.title.trim(), type, settings },
        isNew: true,
        addedLabels: added,
      });
      continue;
    }
    const existing = boardColumns.find((column) => column.key === target.columnKey);
    if (!existing) continue;
    if (existing.type === 'status' || existing.type === 'dropdown') {
      const plan = planLabels(existing.settings, distinctFor(profile, values, existing.type === 'dropdown'), {
        isStatus: existing.type === 'status',
        max: options.maxLabels,
        idFactory: (name) => stableLabelId(`${existing.key}:${name.toLowerCase()}`),
      });
      const column = { ...existing, settings: { ...(existing.settings as object), labels: plan.labels } };
      columns.push({
        sourceIndex,
        column,
        isNew: false,
        addedLabels: plan.added.length,
        ...(plan.added.length
          ? { labelUpdate: { columnKey: existing.key, labels: plan.labels, added: plan.added.length } }
          : {}),
      });
      continue;
    }
    columns.push({ sourceIndex, column: existing, isNew: false, addedLabels: 0 });
  }
  return { nameIndex, groupIndex, columns };
}

export type CellOverrides = Readonly<Record<string, string>>;

export function overrideKey(row: number, sourceIndex: number): string {
  return `${row}:${sourceIndex}`;
}

export interface BuiltRows {
  readonly rows: ImportRowPayload[];
  readonly issues: RowIssue[];
  /** Source rows not imported (empty name, or skipped by the user). */
  readonly skippedRows: number[];
  /** Rows with at least one invalid cell. */
  readonly rowsWithIssues: number;
}

export interface BuildRowsInput {
  readonly dataRows: readonly (readonly string[])[];
  /** 1-based file row number of `dataRows[0]`. */
  readonly firstRowNumber: number;
  readonly plan: ColumnPlan;
  readonly headers: readonly string[];
  readonly ctx: ConvertContext;
  /** Per-column conversion context (detected date order / currency). */
  readonly columnContext?: (sourceIndex: number, source: readonly string[]) => ConvertContext;
  readonly overrides?: CellOverrides;
  readonly excludedRows?: ReadonlySet<number>;
  readonly skipRowsWithIssues?: boolean;
  readonly dedupe?: DedupeConfig;
  /** Map virtual keys (`new_<i>`) to real column keys once the columns exist. */
  readonly keyMap?: Readonly<Record<string, string>>;
}

export function buildRows(input: BuildRowsInput): BuiltRows {
  const { dataRows, plan, ctx, headers } = input;
  const overrides = input.overrides ?? {};
  const rows: ImportRowPayload[] = [];
  const issues: RowIssue[] = [];
  const skippedRows: number[] = [];
  let rowsWithIssues = 0;
  const realKey = (key: string) => input.keyMap?.[key] ?? key;

  dataRows.forEach((source, offset) => {
    const rowNumber = input.firstRowNumber + offset;
    if (input.excludedRows?.has(rowNumber)) {
      skippedRows.push(rowNumber);
      return;
    }
    const cell = (index: number) => stripFormulaGuard(overrides[overrideKey(rowNumber, index)] ?? source[index] ?? '');
    const rowIssues: RowIssue[] = [];
    const name = plan.nameIndex === null ? '' : cell(plan.nameIndex).trim().slice(0, 2_000);
    if (!name && plan.nameIndex !== null) {
      rowIssues.push({
        row: rowNumber,
        sourceIndex: plan.nameIndex,
        column: headers[plan.nameIndex] ?? 'Name',
        raw: '',
        message: 'Item name is empty, so this row will be skipped',
      });
    }
    const values: Record<string, ImportRowPayload['values'][string]> = {};
    const links: Record<string, string[]> = {};
    let key: string | undefined;
    if (input.dedupe?.key === 'name') key = name;
    for (const planned of plan.columns) {
      const raw = cell(planned.sourceIndex);
      const result = convertValue(raw, planned.column, input.columnContext?.(planned.sourceIndex, source) ?? ctx);
      const columnKey = realKey(planned.column.key);
      if (!result.ok) {
        rowIssues.push({
          row: rowNumber,
          sourceIndex: planned.sourceIndex,
          column: headers[planned.sourceIndex] ?? planned.column.title,
          raw,
          message: result.message,
        });
        continue;
      }
      if ('links' in result) {
        if (result.links.length) links[columnKey] = [...result.links];
        continue;
      }
      if (result.value !== null && result.value !== false) values[columnKey] = result.value;
      if (input.dedupe?.key && input.dedupe.key === planned.column.key && raw.trim()) {
        const value = result.value as unknown;
        key =
          typeof value === 'object' && value !== null && 'email' in value
            ? String((value as { email: string }).email)
            : typeof value === 'object' && value !== null && 'phone' in value
              ? String((value as { phone: string }).phone)
              : raw.trim();
      }
    }
    issues.push(...rowIssues);
    const blocking = !name;
    if (rowIssues.length > 0 && !blocking) rowsWithIssues += 1;
    if (blocking || (input.skipRowsWithIssues && rowIssues.length > 0)) {
      if (blocking) rowsWithIssues += 1;
      skippedRows.push(rowNumber);
      return;
    }
    const groupTitle = plan.groupIndex === null ? '' : cell(plan.groupIndex).trim().slice(0, 255);
    rows.push({
      row: rowNumber,
      name,
      ...(groupTitle ? { groupTitle } : {}),
      values,
      ...(Object.keys(links).length ? { links } : {}),
      ...(key ? { key } : {}),
    });
  });
  return { rows, issues, skippedRows, rowsWithIssues };
}
