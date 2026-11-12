/**
 * Shareable board URL state: `?view=<id>&vs=<overlay>&q=<search>`.
 *
 * `vs` carries only the unsaved toolbar changes (base64url JSON) so pasting the URL reproduces
 * exactly what the sender saw on top of the view's saved state. Other params (`item`,
 * `itemTab`, …) are left untouched. Pure and client-safe.
 */
import { z } from 'zod';
import type { FilterGroup, FilterRule } from '@/features/board-table';
import type { ColumnDto } from '@/server/services/contracts/dto';
import { DATE_BUCKETS, type DraftOverlay } from './draft';
import { isFilterable, operatorsFor } from './filter-model';
import { isDateLike, isGroupable } from './group-by';

export const VIEW_PARAM = 'view';
export const OVERLAY_PARAM = 'vs';
export const SEARCH_PARAM = 'q';

const MAX_OVERLAY_LENGTH = 6_000;
const key = z.string().max(64);

const ruleSchema = z.object({ columnKey: key, operator: z.string().max(32), value: z.unknown().optional() });
const leafGroupSchema = z.object({ conjunction: z.enum(['and', 'or']), rules: z.array(ruleSchema).max(50) });

const overlaySchema = z
  .object({
    filters: z
      .object({
        conjunction: z.enum(['and', 'or']),
        rules: z.array(ruleSchema).max(50),
        groups: z.array(leafGroupSchema).max(10).optional(),
      })
      .optional(),
    sort: z.array(z.object({ columnKey: key, direction: z.enum(['asc', 'desc']) })).max(10).optional(),
    personFilter: z.string().max(64).nullable().optional(),
    hiddenColumnKeys: z.array(key).max(200).optional(),
    groupBy: z.object({ columnKey: key, bucket: z.enum(DATE_BUCKETS).optional() }).nullable().optional(),
  })
  .strip();

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeOverlay(overlay: DraftOverlay): string | null {
  if (Object.keys(overlay).length === 0) return null;
  return toBase64Url(JSON.stringify(overlay));
}

/** Decode + validate an overlay from the URL. Anything malformed is ignored (returns null). */
export function decodeOverlay(value: string | null | undefined): DraftOverlay | null {
  if (!value || value.length > MAX_OVERLAY_LENGTH) return null;
  try {
    const parsed = overlaySchema.safeParse(JSON.parse(fromBase64Url(value)));
    if (!parsed.success) return null;
    const out: Record<string, unknown> = {};
    for (const [entry, data] of Object.entries(parsed.data)) if (data !== undefined) out[entry] = data;
    return out as DraftOverlay;
  } catch {
    return null;
  }
}

/** Operators a rule on `column` may use (the editor's, plus the quick-filter / header ones). */
function allowedOperators(column: ColumnDto): ReadonlySet<string> {
  const allowed = new Set<string>(operatorsFor(column).map((option) => option.value));
  if (column.type === 'status' || column.type === 'dropdown' || column.type === 'people') {
    allowed.add('is');
    allowed.add('is_not');
  }
  return allowed;
}

function sanitizeGroup(group: FilterGroup, byKey: ReadonlyMap<string, ColumnDto>, depth: number): FilterGroup {
  const rules = group.rules.filter((rule: FilterRule) => {
    const column = byKey.get(rule.columnKey);
    return Boolean(column && isFilterable(column) && allowedOperators(column).has(rule.operator));
  });
  const groups =
    depth === 0
      ? (group.groups ?? []).map((child) => sanitizeGroup(child, byKey, depth + 1)).filter((child) => child.rules.length > 0)
      : [];
  return groups.length ? { conjunction: group.conjunction, rules, groups } : { conjunction: group.conjunction, rules };
}

/**
 * Drop everything in a decoded overlay that doesn't fit this board: rules on unknown columns or
 * with operators the column type doesn't support, sort / hidden keys on unknown columns, a
 * grouping on a non-groupable column, and a person filter for someone who isn't a member.
 */
export function sanitizeOverlay(
  overlay: DraftOverlay | null,
  columns: readonly ColumnDto[],
  users: readonly { readonly id: string }[],
): DraftOverlay | null {
  if (!overlay) return null;
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const out: Record<string, unknown> = {};
  if (overlay.filters) out.filters = sanitizeGroup(overlay.filters, byKey, 0);
  if (overlay.sort) out.sort = overlay.sort.filter((rule) => byKey.has(rule.columnKey));
  if (overlay.hiddenColumnKeys) out.hiddenColumnKeys = overlay.hiddenColumnKeys.filter((entry) => byKey.has(entry));
  if (overlay.groupBy !== undefined) {
    const column = overlay.groupBy ? byKey.get(overlay.groupBy.columnKey) : undefined;
    if (overlay.groupBy === null) out.groupBy = null;
    else if (column && isGroupable(column))
      out.groupBy = isDateLike(column) ? overlay.groupBy : { columnKey: overlay.groupBy.columnKey };
  }
  if (overlay.personFilter !== undefined) {
    if (overlay.personFilter === null || users.some((user) => user.id === overlay.personFilter))
      out.personFilter = overlay.personFilter;
  }
  return out as DraftOverlay;
}

export interface BoardUrlState {
  readonly viewId: string | null;
  readonly overlay: DraftOverlay | null;
  readonly search: string;
}

export function readBoardUrl(params: URLSearchParams): BoardUrlState {
  const viewId = params.get(VIEW_PARAM);
  return {
    viewId: viewId && z.uuid().safeParse(viewId).success ? viewId : null,
    overlay: decodeOverlay(params.get(OVERLAY_PARAM)),
    search: (params.get(SEARCH_PARAM) ?? '').slice(0, 200),
  };
}

export interface BoardUrlPatch {
  readonly viewId?: string | null;
  readonly overlay?: DraftOverlay | null;
  readonly search?: string;
}

/** Apply a patch to a query string; returns the new `?…` (or '' when empty). */
export function patchBoardSearch(current: string, patch: BoardUrlPatch): string {
  const params = new URLSearchParams(current);
  const set = (name: string, value: string | null | undefined) => {
    if (value) params.set(name, value);
    else params.delete(name);
  };
  if (patch.viewId !== undefined) set(VIEW_PARAM, patch.viewId);
  if (patch.overlay !== undefined) set(OVERLAY_PARAM, patch.overlay ? encodeOverlay(patch.overlay) : null);
  if (patch.search !== undefined) set(SEARCH_PARAM, patch.search.trim() ? patch.search : null);
  const text = params.toString();
  return text ? `?${text}` : '';
}
