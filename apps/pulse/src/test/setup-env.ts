/**
 * Vitest setup: loads `.env.local` (then `.env`) so tests that import server modules can read
 * `DATABASE_URL`. Pure tests do not need it. Database tests skip themselves when the database
 * cannot be reached (see src/test/db.ts).
 */
import path from 'node:path';
import { afterAll } from 'vitest';
import { config as loadDotenv } from 'dotenv';

const root = path.resolve(__dirname, '../..');
loadDotenv({ path: path.join(root, '.env.local'), quiet: true });
loadDotenv({ path: path.join(root, '.env'), quiet: true });

// The database guard is ON for every test run (CONTRACTS section 12, rule 13): the suite runs as the plain role
// with the workspace setting, the way production does once PULSE_DB_GUARD=1 is set there. Set
// PULSE_DB_GUARD=0 to run the suite the old way, as the table owner.
process.env.PULSE_DB_GUARD ??= '1';

// A statement the guard refused (no workspace scope, or the plain role reached for something it
// has no grant on) fails the file, even when a fail soft reader swallowed the error.
afterAll(() => {
  const slot = globalThis as typeof globalThis & { __kitstakPulseGuardRefusals?: string[] };
  const refused = slot.__kitstakPulseGuardRefusals ?? [];
  slot.__kitstakPulseGuardRefusals = [];
  if (refused.length > 0) {
    throw new Error(`The database guard refused ${refused.length} statement(s) in this file. First one:\n${refused[0]}`);
  }
});
