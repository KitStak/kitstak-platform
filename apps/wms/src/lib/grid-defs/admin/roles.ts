/** Roles grid, Add/Edit Role drawer and Manage Restrictions schemas (M14). PURE. */
import { z } from 'zod';
import { ROLE_CATEGORIES, ROLE_RESTRICTIONS } from '@/lib/enums';
import { PERMISSION_TREE, PERMISSIONS, isPermissionKey } from '@/server/auth/permission-catalog';
import { bulkIdsSchema, requiredText, versionField, type AdminField } from './common';

export const ROLES_GRID_KEY = 'roles';

export const RESTRICTION_DEFS: readonly {
  readonly key: (typeof ROLE_RESTRICTIONS)[number];
  readonly label: string;
  readonly description: string;
}[] = [
  {
    key: 'carrier_cost',
    label: 'Carrier cost',
    description: 'Hides shipping rates, carrier fees and related cost information.',
  },
  {
    key: 'carrier_account_data',
    label: 'Carrier account data',
    description: 'Hides carrier account numbers and billing details.',
  },
  {
    key: 'rate_shopping_data',
    label: 'Rate shopping data',
    description: 'Hides rate shopping usage and selected shipping options.',
  },
];

/**
 * What a data restriction actually hides today. Shown wherever restrictions are set or listed, so
 * the control never claims more coverage than it has (API-boundary + export redaction is REQ-R4-1/2).
 */
export const RESTRICTION_COVERAGE =
  'Restricted users see an empty value for these fields everywhere: every screen and API response, and Excel exports (the columns are left out).';

export const restrictionLabel = (key: string): string =>
  RESTRICTION_DEFS.find((r) => r.key === key)?.label ?? key;

export const ROLE_FIELDS: readonly AdminField[] = [
  { field: 'name', label: 'Role name', type: 'text' },
  { field: 'description', label: 'Description', type: 'text' },
  { field: 'category', label: 'Role category', type: 'enum', options: ROLE_CATEGORIES },
  { field: 'restriction', label: 'Restriction', type: 'enum', options: ROLE_RESTRICTIONS },
  { field: 'isSystem', label: 'System role', type: 'boolean' },
  { field: 'userCount', label: 'Users', type: 'number' },
  { field: 'permissionCount', label: 'Permissions', type: 'number' },
  { field: 'createdAt', label: 'Created date', type: 'date' },
];

export const ROLE_SORT_FIELDS = [
  'name',
  'description',
  'category',
  'isSystem',
  'userCount',
  'permissionCount',
  'createdAt',
  'updatedAt',
] as const;
export const ROLE_SEARCH_FIELDS = ['name'] as const;

export const roleSchema = z.object({
  name: requiredText('Name', 60),
  description: requiredText('Description', 250),
  category: z.enum(ROLE_CATEGORIES, { error: 'Choose a role category' }),
  permissions: z
    .array(z.string().max(120))
    .max(PERMISSIONS.length)
    .refine((keys) => keys.every(isPermissionKey), 'Unknown permission'),
  version: versionField,
});

export type RoleFormValues = z.input<typeof roleSchema>;
export type RoleSave = z.output<typeof roleSchema>;

export const ROLE_FORM_DEFAULTS: RoleFormValues = {
  name: '',
  description: '',
  category: 'Operation',
  permissions: [],
};

export const restrictionsSchema = bulkIdsSchema.extend({
  restrictions: z.array(z.enum(ROLE_RESTRICTIONS)).max(ROLE_RESTRICTIONS.length),
});

/* ---------------- permission matrix model ---------------- */

export interface MatrixPage {
  readonly key: string;
  readonly label: string;
  readonly actions: readonly { readonly key: string; readonly label: string }[];
}

export interface MatrixSection {
  readonly label: string;
  readonly pages: readonly MatrixPage[];
}

export interface MatrixGroup {
  readonly key: string;
  readonly label: string;
  readonly sections: readonly MatrixSection[];
  readonly keys: readonly string[];
}

/** The catalog arranged as group -> section -> page -> permission keys. */
export const PERMISSION_MATRIX: readonly MatrixGroup[] = PERMISSION_TREE.map((group) => {
  const sections = group.sections.map((section) => ({
    label: section.label,
    pages: section.pages.map((pg) => ({
      key: pg.key,
      label: pg.label,
      actions: PERMISSIONS.filter(
        (p) => p.groupKey === group.key && p.pageKey === pg.key && p.section === section.label,
      ).map((p) => ({ key: p.key, label: p.label })),
    })),
  }));
  return {
    key: group.key,
    label: group.label,
    sections,
    keys: sections.flatMap((s) => s.pages.flatMap((p) => p.actions.map((a) => a.key))),
  };
});

/** Case-insensitive match on group, section, page or action label. */
export function filterMatrix(matrix: readonly MatrixGroup[], search: string): readonly MatrixGroup[] {
  const q = search.trim().toLowerCase();
  if (!q) return matrix;
  return matrix.flatMap((g) => {
    if (g.label.toLowerCase().includes(q)) return [g];
    const sections = g.sections.flatMap((s) => {
      if (s.label.toLowerCase().includes(q)) return [s];
      const pages = s.pages.flatMap((p) => {
        if (p.label.toLowerCase().includes(q)) return [p];
        const actions = p.actions.filter((a) => a.label.toLowerCase().includes(q));
        return actions.length ? [{ ...p, actions }] : [];
      });
      return pages.length ? [{ ...s, pages }] : [];
    });
    return sections.length
      ? [
          {
            ...g,
            sections,
            keys: sections.flatMap((s) => s.pages.flatMap((p) => p.actions.map((a) => a.key))),
          },
        ]
      : [];
  });
}

/** Toggling a page's "all" box: grant all when any is missing, otherwise revoke all. */
/** Page id of a permission (`group|page|section`), or null for an unknown key. */
function pageIdOf(key: string): string | null {
  const def = PERMISSIONS.find((p) => p.key === key);
  return def ? `${def.groupKey}|${def.pageKey}|${def.section}` : null;
}

/** page id -> that page's View permission key (pages without a View action are absent). */
const VIEW_KEY_BY_PAGE: ReadonlyMap<string, string> = new Map(
  PERMISSIONS.filter((p) => p.action === 'view').map(
    (p) => [`${p.groupKey}|${p.pageKey}|${p.section}`, p.key] as const,
  ),
);

/** The View key that `key` depends on, or null when `key` is a View itself or its page has no View. PURE. */
export function requiredViewOf(key: string): string | null {
  const page = pageIdOf(key);
  if (!page) return null;
  const view = VIEW_KEY_BY_PAGE.get(page);
  return view && view !== key ? view : null;
}

/**
 * Actions imply View: adds the page's View permission for every granted action, so a role can
 * never mutate records on a screen it cannot open. Order-preserving and idempotent. PURE.
 */
export function withImpliedViews(keys: readonly string[]): string[] {
  const out = [...new Set(keys)];
  const set = new Set(out);
  for (const k of [...out]) {
    const view = requiredViewOf(k);
    if (view && !set.has(view)) {
      set.add(view);
      out.push(view);
    }
  }
  return out;
}

/**
 * Matrix toggle with the View rule: ticking any action ticks the page's View; unticking View
 * clears that page's actions. Returns the new keys plus the page labels whose actions were cleared
 * (so the UI can say so). PURE.
 */
export function toggleWithViewRule(
  current: readonly string[],
  keys: readonly string[],
): { keys: string[]; clearedPages: string[] } {
  const next = new Set(togglePermissions(current, keys));
  const clearedPages: string[] = [];
  for (const k of current) {
    const def = PERMISSIONS.find((p) => p.key === k);
    if (!def || def.action !== 'view' || next.has(k)) continue;
    // View was removed: drop the page's other actions too.
    const page = `${def.groupKey}|${def.pageKey}|${def.section}`;
    let cleared = false;
    for (const other of [...next])
      if (pageIdOf(other) === page) {
        next.delete(other);
        cleared = true;
      }
    if (cleared) clearedPages.push(def.pageLabel);
  }
  return { keys: withImpliedViews([...next]), clearedPages };
}

export function togglePermissions(current: readonly string[], keys: readonly string[]): string[] {
  const set = new Set(current);
  const allOn = keys.every((k) => set.has(k));
  for (const k of keys) {
    if (allOn) set.delete(k);
    else set.add(k);
  }
  return [...set];
}

/** "carrier-admin" style key from a role name. */
export function roleKeyFromName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50) || 'role'
  );
}
