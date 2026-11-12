/**
 * Per-column-type validation of cell writes. Structural validation uses the shared Zod
 * schemas (`cellValueSchemaFor`); referential checks (labels exist, people are org members,
 * connected items live on the configured boards, files belong to the org) run here.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { files, items, member } from '@/server/db/schema';
import {
  isComputedColumnType,
  validateCellValue,
  type ColumnType,
  type Label,
  type StoredCellValue,
} from '@/server/db/schema/cell-values';
import { ValidationError, type FieldIssue } from '@/server/http/errors';
import type { ServiceContext } from './context';

export interface ValidationColumn {
  readonly key: string;
  readonly type: ColumnType;
  readonly settings: unknown;
  readonly scope: 'item' | 'subitem';
  readonly title: string;
}

/** Normalized patch: column key → value (`null` = clear). */
export type ValuesPatch = Record<string, StoredCellValue | null>;

function labelIds(settings: unknown): Set<string> {
  const list = (settings as { labels?: Label[] } | null)?.labels ?? [];
  return new Set(list.filter((label) => !label.isDefault).map((label) => label.id));
}

/**
 * Pure structural + label validation. Returns the normalized patch and the list of issues
 * (empty when valid). Status writes of the "default" (empty) label are normalized to null.
 */
export function validateValuesShape(
  boardColumns: readonly ValidationColumn[],
  values: Record<string, unknown>,
  scope: 'item' | 'subitem',
): { patch: ValuesPatch; issues: FieldIssue[] } {
  const byKey = new Map(
    boardColumns.filter((column) => column.scope === scope).map((column) => [column.key, column]),
  );
  const patch: ValuesPatch = {};
  const issues: FieldIssue[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const column = byKey.get(key);
    if (!column) {
      issues.push({ path: `values.${key}`, message: 'Unknown column' });
      continue;
    }
    if (column.type === 'name') {
      issues.push({ path: `values.${key}`, message: 'Use the "name" field to rename an item' });
      continue;
    }
    if (isComputedColumnType(column.type)) {
      issues.push({ path: `values.${key}`, message: `"${column.title}" is calculated automatically` });
      continue;
    }
    const result = validateCellValue(column.type, raw === undefined ? null : raw);
    if (!result.ok) {
      issues.push({ path: `values.${key}`, message: result.message });
      continue;
    }
    let value = result.value;
    if (value !== null && column.type === 'status') {
      const labelId = (value as { labelId: string }).labelId;
      if (labelId === 'default') value = null;
      else if (!labelIds(column.settings).has(labelId)) {
        issues.push({ path: `values.${key}`, message: 'Unknown status label' });
        continue;
      }
    }
    if (value !== null && column.type === 'dropdown') {
      const allowed = labelIds(column.settings);
      const ids = [...new Set((value as { labelIds: string[] }).labelIds)];
      if (ids.some((id) => !allowed.has(id))) {
        issues.push({ path: `values.${key}`, message: 'Unknown dropdown label' });
        continue;
      }
      value = { labelIds: ids };
    }
    if (value !== null && column.type === 'people') {
      const people = value as { ids: string[]; teamIds?: string[] };
      const allowMultiple = (column.settings as { allowMultiple?: boolean } | null)?.allowMultiple !== false;
      const ids = [...new Set(people.ids)];
      if (!allowMultiple && ids.length > 1) {
        issues.push({ path: `values.${key}`, message: 'Only one person can be assigned' });
        continue;
      }
      value = people.teamIds ? { ids, teamIds: [...new Set(people.teamIds)] } : { ids };
    }
    if (value !== null && column.type === 'connect_boards') {
      const ids = [...new Set((value as { itemIds: string[] }).itemIds)];
      const allowMultiple = (column.settings as { allowMultiple?: boolean } | null)?.allowMultiple !== false;
      if (!allowMultiple && ids.length > 1) {
        issues.push({ path: `values.${key}`, message: 'Only one item can be connected' });
        continue;
      }
      value = { itemIds: ids };
    }
    if (value !== null && column.type === 'rating') {
      const max = (column.settings as { max?: number } | null)?.max ?? 5;
      if ((value as number) > max) {
        issues.push({ path: `values.${key}`, message: `Rating must be at most ${max}` });
        continue;
      }
    }
    patch[key] = value;
  }
  return { patch, issues };
}

/** Referential checks that need the database. */
async function validateReferences(
  ctx: ServiceContext,
  boardColumns: readonly ValidationColumn[],
  patch: ValuesPatch,
): Promise<FieldIssue[]> {
  const issues: FieldIssue[] = [];
  const byKey = new Map(boardColumns.map((column) => [column.key, column]));
  const peopleIds = new Set<string>();
  const fileIds = new Set<string>();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) continue;
    const column = byKey.get(key);
    if (column?.type === 'people') for (const id of (value as { ids: string[] }).ids) peopleIds.add(id);
    if (column?.type === 'files') for (const id of (value as { fileIds: string[] }).fileIds) fileIds.add(id);
  }

  if (peopleIds.size > 0) {
    const rows = await ctx.db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, ctx.orgId), inArray(member.userId, [...peopleIds])));
    const found = new Set(rows.map((row) => row.userId));
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || byKey.get(key)?.type !== 'people') continue;
      if ((value as { ids: string[] }).ids.some((id) => !found.has(id))) {
        issues.push({ path: `values.${key}`, message: 'Every person must be a member of this organization' });
      }
    }
  }

  if (fileIds.size > 0) {
    const rows = await ctx.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.orgId, ctx.orgId), inArray(files.id, [...fileIds]), isNull(files.deletedAt)));
    const found = new Set(rows.map((row) => row.id));
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || byKey.get(key)?.type !== 'files') continue;
      if ((value as { fileIds: string[] }).fileIds.some((id) => !found.has(id))) {
        issues.push({ path: `values.${key}`, message: 'A referenced file does not exist' });
      }
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    const column = byKey.get(key);
    if (value === null || column?.type !== 'connect_boards') continue;
    const ids = (value as { itemIds: string[] }).itemIds;
    if (ids.length === 0) continue;
    const allowedBoards = (column.settings as { boardIds?: string[] } | null)?.boardIds ?? [];
    if (allowedBoards.length === 0) {
      issues.push({ path: `values.${key}`, message: 'This column is not connected to any board yet' });
      continue;
    }
    const rows = await ctx.db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.orgId, ctx.orgId),
          inArray(items.id, ids),
          inArray(items.boardId, allowedBoards),
          isNull(items.deletedAt),
        ),
      );
    if (rows.length !== new Set(ids).size) {
      issues.push({ path: `values.${key}`, message: 'Connected items must belong to the connected boards' });
    }
  }
  return issues;
}

/** Validate a values write end-to-end; throws `ValidationError` (422) listing every issue. */
export async function validateValues(
  ctx: ServiceContext,
  boardColumns: readonly ValidationColumn[],
  values: Record<string, unknown>,
  scope: 'item' | 'subitem',
): Promise<ValuesPatch> {
  const { patch, issues } = validateValuesShape(boardColumns, values, scope);
  if (issues.length > 0) throw new ValidationError(issues);
  const referenceIssues = await validateReferences(ctx, boardColumns, patch);
  if (referenceIssues.length > 0) throw new ValidationError(referenceIssues);
  return patch;
}

/** Apply a patch to stored values immutably (null removes the key). */
export function applyPatch(
  current: Record<string, StoredCellValue>,
  patch: ValuesPatch,
): Record<string, StoredCellValue> {
  const next: Record<string, StoredCellValue> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Deep equality for JSON cell values (order-sensitive for arrays). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
