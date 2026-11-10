/**
 * Access: the 4 system roles with their default permissions, a restricted custom "Client"
 * role, 10 users (one per role, two client users, one API user) and their warehouse /
 * client scopes.
 */
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLES, PERMISSIONS } from "@/server/auth/permission-catalog";
import * as schema from "@/server/db/schema";
import type { Tx } from "@/server/domain/types";
import type { LEGACY_USER_ROLES, USER_TYPES } from "@/lib/enums";
import type { OrgRefs } from "./org";
import { isoOf, utcAt } from "./runtime";
import type { Id, SeedUser } from "./types";

/** Local demo credential (overridable). Never used in production: seeding refuses there. */
export const DEFAULT_SEED_PASSWORD = "KitStak!demo2026";
/** Lower bcrypt cost for seeding speed; hashes are upgraded on first login. */
const SEED_BCRYPT_ROUNDS = 10;

export const CLIENT_ROLE_KEY = "client";

type RoleKey = (typeof DEFAULT_ROLES)[number]["key"] | typeof CLIENT_ROLE_KEY;

interface UserSeedSpec {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: (typeof LEGACY_USER_ROLES)[number];
  readonly roleKey: RoleKey;
  readonly userType: (typeof USER_TYPES)[number];
  readonly warehouses: readonly ("MLT1" | "KS2")[];
  readonly clientCodes?: readonly string[];
  readonly isApiUser?: boolean;
  readonly daysAgo: number;
}

export const USER_SPECS: readonly UserSeedSpec[] = [
  { email: "admin@kitstak.io", firstName: "Mike", lastName: "Lunsford", role: "admin", roleKey: "admin", userType: "Owner", warehouses: ["MLT1", "KS2"], daysAgo: 720 },
  { email: "ops.manager@kitstak.io", firstName: "Renata", lastName: "Alvarez", role: "manager", roleKey: "manager", userType: "Operation", warehouses: ["MLT1", "KS2"], daysAgo: 610 },
  { email: "j.okafor@kitstak.io", firstName: "Jonah", lastName: "Okafor", role: "operator", roleKey: "operator", userType: "Operation", warehouses: ["MLT1"], daysAgo: 540 },
  { email: "t.nguyen@kitstak.io", firstName: "Thao", lastName: "Nguyen", role: "operator", roleKey: "operator", userType: "Operation", warehouses: ["MLT1"], daysAgo: 420 },
  { email: "d.castillo@kitstak.io", firstName: "Diego", lastName: "Castillo", role: "operator", roleKey: "operator", userType: "Operation", warehouses: ["KS2"], daysAgo: 300 },
  { email: "finance@kitstak.io", firstName: "Grace", lastName: "Whitmore", role: "viewer", roleKey: "viewer", userType: "Operation", warehouses: ["MLT1", "KS2"], daysAgo: 260 },
  { email: "cs.team@kitstak.io", firstName: "Evan", lastName: "Brooks", role: "viewer", roleKey: "viewer", userType: "Operation", warehouses: ["MLT1"], daysAgo: 190 },
  { email: "dana@apexthreads.com", firstName: "Dana", lastName: "Whitfield", role: "viewer", roleKey: CLIENT_ROLE_KEY, userType: "Client", warehouses: ["MLT1", "KS2"], clientCodes: ["APX"], daysAgo: 150 },
  { email: "marcus@novaforge.io", firstName: "Marcus", lastName: "Oyelaran", role: "viewer", roleKey: CLIENT_ROLE_KEY, userType: "Client", warehouses: ["MLT1"], clientCodes: ["NVF"], daysAgo: 120 },
  { email: "integrations@kitstak.io", firstName: "Integration", lastName: "Service", role: "operator", roleKey: "operator", userType: "Operation", warehouses: ["MLT1", "KS2"], isApiUser: true, daysAgo: 400 },
];

const CLIENT_PERMISSION_GROUPS: ReadonlySet<string> = new Set(["fulfillment", "inventory", "reports"]);

/** Client portal users: read-only fulfillment, inventory and reports. */
export const CLIENT_ROLE_PERMISSIONS: readonly string[] = DEFAULT_ROLE_PERMISSIONS.viewer
  .filter((key) => {
    const def = PERMISSIONS.find((p) => p.key === key);
    return !def || CLIENT_PERMISSION_GROUPS.has(def.groupKey) || def.groupKey === "settings" || def.groupKey === "mobile";
  });

export interface AccessRefs {
  readonly users: readonly SeedUser[];
  readonly byEmail: ReadonlyMap<string, SeedUser>;
  readonly admin: SeedUser;
  readonly manager: SeedUser;
  /** Operators per warehouse code (pickers / packers). */
  readonly operators: Readonly<Record<"MLT1" | "KS2", readonly SeedUser[]>>;
  readonly roleIds: ReadonlyMap<RoleKey, Id>;
}

function seedRoles(tx: Tx): Map<RoleKey, Id> {
  const roleIds = new Map<RoleKey, Id>();
  const insertRole = (key: RoleKey, row: Omit<typeof schema.roles.$inferInsert, "key">, permissions: readonly string[]): void => {
    const id = tx.insert(schema.roles).values({ key, ...row }).returning({ id: schema.roles.id }).get().id;
    if (permissions.length > 0) tx.insert(schema.rolePermissions).values(permissions.map((permission) => ({ roleId: id, permission }))).run();
    roleIds.set(key, id);
  };
  for (const r of DEFAULT_ROLES) {
    insertRole(r.key, { name: r.name, description: r.description, category: "Operation", isSystem: true, createdAt: isoOf(utcAt(720, 14)) }, DEFAULT_ROLE_PERMISSIONS[r.key]);
  }
  insertRole(CLIENT_ROLE_KEY, {
    name: "Client", description: "Client portal: read-only orders, inventory and reports for the client's own data. Carrier costs and account numbers are hidden.",
    category: "Client", isSystem: false, restrictions: ["carrier_cost", "carrier_account_data", "rate_shopping_data"], createdAt: isoOf(utcAt(160, 15)),
  }, CLIENT_ROLE_PERMISSIONS);
  return roleIds;
}

export function seedAccess(tx: Tx, org: OrgRefs, password: string): AccessRefs {
  const roleIds = seedRoles(tx);
  const passwordHash = hashPassword(password, SEED_BCRYPT_ROUNDS);
  const whIds = { MLT1: org.mlt1, KS2: org.ks2 } as const;
  const users = USER_SPECS.map((u): SeedUser & { spec: UserSeedSpec } => {
    const createdAt = isoOf(utcAt(u.daysAgo, 15));
    const name = `${u.firstName} ${u.lastName}`;
    const id = tx.insert(schema.users).values({
      email: u.email, name, firstName: u.firstName, lastName: u.lastName, passwordHash, role: u.role, userType: u.userType,
      isApiUser: u.isApiUser ?? false, allClients: !u.clientCodes, passwordChangedAt: createdAt,
      preferences: { dateFormat: "M/D/YYYY h:mm:ss A", timeFormat: "12h", numberFormat: "1,025.00", density: "Large", defaultWarehouseId: whIds[u.warehouses[0]] },
      createdAt,
    }).returning({ id: schema.users.id }).get().id;
    tx.insert(schema.userRoles).values({ userId: id, roleId: roleIds.get(u.roleKey) as Id }).run();
    tx.insert(schema.userWarehouses).values(u.warehouses.map((w) => ({ userId: id, warehouseId: whIds[w] }))).run();
    for (const code of u.clientCodes ?? []) {
      const client = org.clientByCode.get(code);
      if (client) tx.insert(schema.userClients).values({ userId: id, clientId: client.id }).run();
    }
    return { id, email: u.email, name, spec: u };
  });
  const byEmail = new Map<string, SeedUser>(users.map((u) => [u.email, { id: u.id, email: u.email, name: u.name }]));
  const plain = (u: SeedUser): SeedUser => ({ id: u.id, email: u.email, name: u.name });
  const operatorsIn = (code: "MLT1" | "KS2") => users.filter((u) => u.spec.roleKey === "operator" && !u.spec.isApiUser && u.spec.warehouses.includes(code)).map(plain);
  return {
    users: users.map(plain), byEmail,
    admin: plain(users[0]), manager: plain(users[1]),
    operators: { MLT1: operatorsIn("MLT1"), KS2: operatorsIn("KS2") },
    roleIds,
  };
}

/** Recent security events (logins, a failed login, a role change) for the audit log. */
export function seedAuditTrail(tx: Tx, access: AccessRefs): number {
  const rows: (typeof schema.auditLog.$inferInsert)[] = [];
  access.users.filter((u) => !u.email.startsWith("integrations@")).forEach((u, i) => {
    for (let d = 0; d < 5; d += 1) {
      rows.push({ userId: u.id, action: "auth.login", entity: "user", entityId: u.id, detail: `Signed in from 10.0.4.${18 + i}`,
        at: isoOf(utcAt(d * 2 + (i % 3), 12 + (i % 5), 5 + i)), ip: `10.0.4.${18 + i}`, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0" });
    }
  });
  const marcus = access.byEmail.get("marcus@novaforge.io");
  if (marcus) rows.push({ userId: marcus.id, action: "auth.login", entity: "user", entityId: marcus.id, detail: "Invalid password", at: isoOf(utcAt(3, 13, 41)), ip: "73.92.14.6", outcome: "failure" });
  rows.push({ userId: access.admin.id, action: "role.update", entity: "role", entityId: access.roleIds.get(CLIENT_ROLE_KEY) ?? "", detail: "Client role: hid carrier costs and account numbers", at: isoOf(utcAt(20, 15, 12)) });
  tx.insert(schema.auditLog).values(rows).run();
  return rows.length;
}
