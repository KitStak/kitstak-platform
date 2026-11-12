/**
 * Better Auth tables (core.user, core.session, ...) moved to their shared home in
 * `@kitstak/db` (blueprint §1.4: both apps import the same `core` schema objects).
 * This module stays as a pure re-export so every existing `@/server/db/schema` import
 * site — and drizzle-kit, which collects tables through re-exports — is unchanged.
 * Regenerate with `pnpm auth:schema` (writes packages/db/src/schema/core/auth.ts).
 */
export * from "@kitstak/db/schema/core/auth";
// Shared auth security state the @kitstak/auth factory needs on EVERY instance
// (auth review 2026-11-11): the lockout plugin's model (H1) and Better Auth's
// database rate-limit storage (M4). The Drizzle adapter resolves models by their
// mapped model name, so the snake_case alias is exported alongside.
export * from "@kitstak/db/schema/core/auth-policy";
export { passwordPolicyState as password_policy_state } from "@kitstak/db/schema/core/auth-policy";
export * from "@kitstak/db/schema/core/rate-limit";
