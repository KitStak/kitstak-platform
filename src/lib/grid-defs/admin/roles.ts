/** Roles grid, Add/Edit Role drawer and Manage Restrictions schemas (M14). PURE. */
import { z } from "zod";
import { ROLE_CATEGORIES, ROLE_RESTRICTIONS } from "@/lib/enums";
import { PERMISSION_TREE, PERMISSIONS, isPermissionKey } from "@/server/auth/permission-catalog";
import { bulkIdsSchema, requiredText, versionField, type AdminField } from "./common";

export const ROLES_GRID_KEY = "roles";

export const RESTRICTION_DEFS: readonly { readonly key: (typeof ROLE_RESTRICTIONS)[number]; readonly label: string; readonly description: string }[] = [
  { key: "carrier_cost", label: "Carrier cost", description: "Hides shipping rates, carrier fees and related cost information." },
  { key: "carrier_account_data", label: "Carrier account data", description: "Hides carrier account numbers and billing details." },
  { key: "rate_shopping_data", label: "Rate shopping data", description: "Hides rate shopping usage and selected shipping options." },
];

export const restrictionLabel = (key: string): string => RESTRICTION_DEFS.find((r) => r.key === key)?.label ?? key;

export const ROLE_FIELDS: readonly AdminField[] = [
  { field: "name", label: "Role name", type: "text" },
  { field: "description", label: "Description", type: "text" },
  { field: "category", label: "Role category", type: "enum", options: ROLE_CATEGORIES },
  { field: "restriction", label: "Restriction", type: "enum", options: ROLE_RESTRICTIONS },
  { field: "isSystem", label: "System role", type: "boolean" },
  { field: "userCount", label: "Users", type: "number" },
  { field: "permissionCount", label: "Permissions", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const ROLE_SORT_FIELDS = ["name", "description", "category", "isSystem", "userCount", "permissionCount", "createdAt", "updatedAt"] as const;
export const ROLE_SEARCH_FIELDS = ["name"] as const;

export const roleSchema = z.object({
  name: requiredText("Name", 60),
  description: requiredText("Description", 250),
  category: z.enum(ROLE_CATEGORIES, { error: "Choose a role category" }),
  permissions: z.array(z.string().max(120)).max(PERMISSIONS.length).refine((keys) => keys.every(isPermissionKey), "Unknown permission"),
  version: versionField,
});

export type RoleFormValues = z.input<typeof roleSchema>;
export type RoleSave = z.output<typeof roleSchema>;

export const ROLE_FORM_DEFAULTS: RoleFormValues = { name: "", description: "", category: "Operation", permissions: [] };

export const restrictionsSchema = bulkIdsSchema.extend({ restrictions: z.array(z.enum(ROLE_RESTRICTIONS)).max(ROLE_RESTRICTIONS.length) });

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
      actions: PERMISSIONS.filter((p) => p.groupKey === group.key && p.pageKey === pg.key && p.section === section.label).map((p) => ({ key: p.key, label: p.label })),
    })),
  }));
  return { key: group.key, label: group.label, sections, keys: sections.flatMap((s) => s.pages.flatMap((p) => p.actions.map((a) => a.key))) };
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
    return sections.length ? [{ ...g, sections, keys: sections.flatMap((s) => s.pages.flatMap((p) => p.actions.map((a) => a.key))) }] : [];
  });
}

/** Toggling a page's "all" box: grant all when any is missing, otherwise revoke all. */
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
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "role";
}
