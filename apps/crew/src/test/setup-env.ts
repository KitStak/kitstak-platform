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

// The database guard is ON for every test run (the Pulse rule): the suite runs as the plain role
// crew_app with the workspace setting. Set CREW_DB_GUARD=0 to run the suite as the table owner.
process.env.CREW_DB_GUARD ??= '1';

// A statement the guard refused fails the file, even when a fail soft reader swallowed the error.
afterAll(() => {
  const slot = globalThis as typeof globalThis & { __kitstakCrewGuardRefusals?: string[] };
  const refused = slot.__kitstakCrewGuardRefusals ?? [];
  slot.__kitstakCrewGuardRefusals = [];
  if (refused.length > 0) {
    throw new Error(`The database guard refused ${refused.length} statement(s) in this file. First one:\n${refused[0]}`);
  }
});
