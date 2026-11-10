import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { userPreferencesSchema } from "@/lib/domain-types";
import type { AppDb } from "@/server/api/db";
import { defineRoute } from "@/server/api/define-route";
import { successBody } from "@/server/api/envelope";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { CONTEXT_CLIENT_COOKIE, CONTEXT_WAREHOUSE_COOKIE, hasClient, hasWarehouse } from "@/server/auth/scope";
import { clients, users, warehouses } from "@/server/db/schema";
import { listActiveAppKeys } from "@/server/shell/active-apps";

const MAX_CONTEXT_CLIENTS = 1000;
const CONTEXT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function loadProfile(db: AppDb, auth: AuthContext) {
  const row = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      userType: users.userType,
      isApiUser: users.isApiUser,
      allClients: users.allClients,
      lastLoginAt: users.lastLoginAt,
      passwordChangedAt: users.passwordChangedAt,
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .get();
  if (!row) throw new AppError("UNAUTHENTICATED", "Authentication required");
  const prefs = userPreferencesSchema.safeParse(row.preferences ?? {});
  const profile = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "preferences")) as Omit<typeof row, "preferences">;
  return { profile, preferences: prefs.success ? prefs.data : userPreferencesSchema.parse({}) };
}

function contextOptions(db: AppDb, auth: AuthContext) {
  const whRows = auth.scope.warehouseIds.length
    ? db.select({ id: warehouses.id, code: warehouses.code, name: warehouses.name }).from(warehouses)
        // Deactivated warehouses are left out of the context picker and every picker fed by it (facility-config REQ-R8-4).
        .where(and(inArray(warehouses.id, [...auth.scope.warehouseIds]), eq(warehouses.isActive, true))).orderBy(asc(warehouses.name)).all()
    : [];
  // Inactive clients are excluded from context options and every client select fed by them (M11 §2).
  const active = eq(clients.status, "Active");
  const clientQuery = db.select({ id: clients.id, code: clients.code, name: clients.name }).from(clients);
  const clientRows =
    auth.scope.clientIds === "all"
      ? clientQuery.where(active).orderBy(asc(clients.name)).limit(MAX_CONTEXT_CLIENTS).all()
      : auth.scope.clientIds.length
        ? clientQuery.where(and(active, inArray(clients.id, [...auth.scope.clientIds]))).orderBy(asc(clients.name)).all()
        : [];
  return { warehouses: whRows, clients: clientRows };
}

/**
 * GET /api/me — profile, permission keys, scope, restrictions, preferences and the
 * header context. Feeds F4's `useCan` / `<Can>` and the context switcher.
 */
export const GET = defineRoute({
  name: "GET /api/me",
  handler: ({ db, auth }) => {
    const { profile, preferences } = loadProfile(db, auth);
    return {
      user: profile,
      permissions: [...auth.permissions].sort(),
      roles: auth.roleKeys,
      restrictions: auth.restrictions,
      scope: auth.scope,
      context: auth.context,
      contextOptions: contextOptions(db, auth),
      activeApps: listActiveAppKeys(db),
      preferences,
      session: { id: auth.user.sessionId, expiresAt: auth.user.sessionExpiresAt },
    };
  },
});

const patchSchema = z
  .object({
    preferences: userPreferencesSchema.partial().optional(),
    context: z
      .object({
        warehouseId: z.string().trim().min(1).max(64).nullable().optional(),
        clientId: z.string().trim().min(1).max(64).nullable().optional(),
      })
      .optional(),
  })
  .refine((v) => v.preferences !== undefined || v.context !== undefined, { message: "Nothing to update" });

/** PATCH /api/me — merges preferences; sets/clears the context cookies (scope-checked). */
export const PATCH = defineRoute({
  name: "PATCH /api/me",
  body: patchSchema,
  handler: ({ db, auth, body }) => {
    const ctx = body.context;
    if (ctx?.warehouseId && !hasWarehouse(auth.scope, ctx.warehouseId)) {
      throw new AppError("VALIDATION", "Unknown warehouse", { fieldErrors: { "context.warehouseId": ["Not in your warehouses"] } });
    }
    if (ctx?.clientId && !hasClient(auth.scope, ctx.clientId)) {
      throw new AppError("VALIDATION", "Unknown client", { fieldErrors: { "context.clientId": ["Not in your clients"] } });
    }
    const current = loadProfile(db, auth).preferences;
    // `stations` merges per station kind so saving the packing choice keeps the return station's.
    const stations = body.preferences?.stations ? { ...current.stations, ...body.preferences.stations } : current.stations;
    const preferences = body.preferences ? userPreferencesSchema.parse({ ...current, ...body.preferences, stations }) : current;
    if (body.preferences) db.update(users).set({ preferences }).where(eq(users.id, auth.user.id)).run();

    const response = NextResponse.json(successBody({ preferences, context: { warehouseId: ctx?.warehouseId ?? auth.context.warehouseId, clientId: ctx?.clientId ?? auth.context.clientId } }));
    const cookie = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
    if (ctx && "warehouseId" in ctx) {
      response.cookies.set(CONTEXT_WAREHOUSE_COOKIE, ctx.warehouseId ?? "", { ...cookie, maxAge: ctx.warehouseId ? CONTEXT_COOKIE_MAX_AGE : 0 });
    }
    if (ctx && "clientId" in ctx) {
      response.cookies.set(CONTEXT_CLIENT_COOKIE, ctx.clientId ?? "", { ...cookie, maxAge: ctx.clientId ? CONTEXT_COOKIE_MAX_AGE : 0 });
    }
    return response;
  },
});
