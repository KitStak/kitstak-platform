/**
 * Config consumed only by the Better Auth CLI to generate `src/server/db/schema/auth.ts`.
 * Run via `npm run auth:schema`. The runtime instance lives in `src/server/auth/auth.ts`.
 */
import { betterAuth } from 'better-auth';
import { sharedAuthOptions } from '../src/server/auth/options';

export const auth = betterAuth({
  ...sharedAuthOptions,
  secret: 'schema-generation-only-not-a-real-secret-0000000000',
  baseURL: 'http://localhost:3100',
});
