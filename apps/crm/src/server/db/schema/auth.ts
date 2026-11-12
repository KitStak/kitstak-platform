/**
 * Better Auth tables (core.user, core.session, ...) moved to their shared home in
 * `@kitstak/db` (blueprint §1.4: both apps import the same `core` schema objects).
 * This module stays as a pure re-export so every existing `@/server/db/schema` import
 * site — and drizzle-kit, which collects tables through re-exports — is unchanged.
 * Regenerate with `pnpm auth:schema` (writes packages/db/src/schema/core/auth.ts).
 */
export * from "@kitstak/db/schema/core/auth";
