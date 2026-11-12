import { defineConfig } from "drizzle-kit";

/**
 * Postgres schema + migrations. `drizzle-kit generate` only diffs the schema against
 * `drizzle/meta` snapshots and needs no database. Commands that do connect (`studio`,
 * `push`, `migrate`) use DIRECT_URL (Supabase session/direct connection) when set,
 * else DATABASE_URL. Local dev uses PGlite via `npm run db:migrate` instead.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/kitstak";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
