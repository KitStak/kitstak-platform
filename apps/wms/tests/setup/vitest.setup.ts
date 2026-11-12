/**
 * Global vitest setup. Runs before every test file.
 *
 * Gives tests a deterministic, non-production environment so code that reads
 * secrets at first use (session signing, cron bearer) works without .env.local.
 */
const TEST_ENV: Readonly<Record<string, string>> = {
  SESSION_SECRET: 'test-only-session-secret-0123456789abcdef0123456789abcdef',
  CRON_SECRET: 'test-only-cron-secret',
  TZ: 'UTC',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
