/**
 * Vitest setup: loads `.env.local` (then `.env`) so database tests can read `DATABASE_URL`. Pure
 * tests do not need it. Database tests skip themselves when the database cannot be reached
 * (see src/test/db.ts).
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

const root = path.resolve(__dirname, '../..');
loadDotenv({ path: path.join(root, '.env.local'), quiet: true });
loadDotenv({ path: path.join(root, '.env'), quiet: true });
