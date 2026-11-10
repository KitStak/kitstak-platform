/**
 * Permission catalog — the single source of permission keys (`<group>.<page>.<action>`,
 * e.g. `fulfillment.shipment_orders.create`). Drives the M14 role matrix, `role_permissions`
 * seeding (F2), server checks (`permissions.ts`) and client `useCan` (F4).
 *
 * PURE module (no server imports): safe for client components.
 */
import { PERMISSION_TREE, SUPERVISOR_EXCLUDED, type ActionSpec } from "./permission-catalog-data";

export { PERMISSION_TREE } from "./permission-catalog-data";

export interface PermissionDef {
  readonly key: string;
  readonly label: string;
  readonly action: string;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly section: string;
  readonly pageKey: string;
  readonly pageLabel: string;
}

/** Slug used for action keys: "Picking/Job Operations" -> "picking_job_operations". */
export function slugifyAction(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function actionOf(spec: ActionSpec): { key: string; label: string } {
  return typeof spec === "string" ? { key: slugifyAction(spec), label: spec } : { key: spec[0], label: spec[1] };
}

function buildCatalog(): readonly PermissionDef[] {
  return PERMISSION_TREE.flatMap((group) =>
    group.sections.flatMap((section) =>
      section.pages.flatMap((pg) =>
        pg.actions.map((spec): PermissionDef => {
          const action = actionOf(spec);
          return {
            key: `${group.key}.${pg.key}.${action.key}`,
            label: action.label,
            action: action.key,
            groupKey: group.key,
            groupLabel: group.label,
            section: section.label,
            pageKey: pg.key,
            pageLabel: pg.label,
          };
        }),
      ),
    ),
  );
}

export const PERMISSIONS: readonly PermissionDef[] = Object.freeze(buildCatalog());
export const PERMISSION_KEYS: readonly string[] = Object.freeze(PERMISSIONS.map((p) => p.key));
const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);
const BY_KEY: ReadonlyMap<string, PermissionDef> = new Map(PERMISSIONS.map((p) => [p.key, p]));

export type PermissionKey = string;

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && KEY_SET.has(value);
}

export function getPermission(key: string): PermissionDef | undefined {
  return BY_KEY.get(key);
}

/** Group counters for the role matrix header "(granted/total)". */
export function countByGroup(granted: ReadonlySet<string>): readonly { groupKey: string; granted: number; total: number }[] {
  return PERMISSION_TREE.map((group) => {
    const keys = PERMISSIONS.filter((p) => p.groupKey === group.key);
    return { groupKey: group.key, granted: keys.filter((p) => granted.has(p.key)).length, total: keys.length };
  });
}

/* ------------------------------ Default role sets ------------------------------ */

export const DEFAULT_ROLE_KEYS = ["admin", "manager", "operator", "viewer"] as const;
export type DefaultRoleKey = (typeof DEFAULT_ROLE_KEYS)[number];

/** Self-service pages every signed-in user keeps. */
export const SELF_SERVICE_PERMISSIONS: readonly string[] = [
  "settings.my_profile.view",
  "settings.change_password.view",
  "mobile.profile.change_password",
  "mobile.profile.language",
  "mobile.profile.device_settings",
];

const OPERATOR_FULL_GROUPS: ReadonlySet<string> = new Set(["fulfillment", "inventory", "mobile"]);
/** Actions an operator never gets even inside execution groups (config / destructive / commercial). */
const OPERATOR_DENIED_ACTIONS: ReadonlySet<string> = new Set([
  "delete",
  "custom_field_management",
  "download_billing_charges",
  "change_warehouse",
  "override_allocation_cancel_warning",
  "override_job_cancel_warning",
  "import_file",
  "import_serial_numbers",
  "import_shipped_file",
]);
const OPERATOR_VIEW_GROUPS: ReadonlySet<string> = new Set(["automation", "integrations", "reports", "analytics"]);
const VIEWER_GROUPS: ReadonlySet<string> = new Set(["fulfillment", "inventory", "automation", "integrations", "reports", "analytics"]);

function isOperatorPermission(p: PermissionDef): boolean {
  if (OPERATOR_FULL_GROUPS.has(p.groupKey)) return !OPERATOR_DENIED_ACTIONS.has(p.action);
  return OPERATOR_VIEW_GROUPS.has(p.groupKey) && p.action === "view";
}

function withSelfService(keys: readonly string[]): readonly string[] {
  return Object.freeze([...new Set([...keys, ...SELF_SERVICE_PERMISSIONS])]);
}

/**
 * - admin: everything.
 * - manager: Logiwa's Supervisor set (everything except the ✗ items).
 * - operator: execution + view in fulfillment / inventory / mobile, read-only automation,
 *   integrations, reports and analytics; no settings, billing or users.
 * - viewer: every `*.view` outside Settings and Mobile (+ self-service profile pages).
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<Record<DefaultRoleKey, readonly string[]>> = Object.freeze({
  admin: PERMISSION_KEYS,
  manager: withSelfService(PERMISSION_KEYS.filter((k) => !SUPERVISOR_EXCLUDED.includes(k))),
  operator: withSelfService(PERMISSIONS.filter(isOperatorPermission).map((p) => p.key)),
  viewer: withSelfService(PERMISSIONS.filter((p) => VIEWER_GROUPS.has(p.groupKey) && p.action === "view").map((p) => p.key)),
});

/** Seed metadata for the 4 system roles (F2 inserts these into `roles` / `role_permissions`). */
export const DEFAULT_ROLES: readonly { key: DefaultRoleKey; name: string; description: string }[] = [
  { key: "admin", name: "Admin", description: "Full access to every screen and action." },
  { key: "manager", name: "Supervisor", description: "Runs warehouse operations and configuration." },
  { key: "operator", name: "Warehouse Clerk", description: "Executes warehouse work; read-only reports." },
  { key: "viewer", name: "Viewer", description: "Read-only access to operational screens." },
];
