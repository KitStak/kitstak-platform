/**
 * Pushes every environment variable to the Vercel projects (portal, crm, wms, projects and,
 * once it is listed in deploy/secrets.env, pulse) via the Vercel CLI.
 *
 * KitStak Pulse is the fifth project. It is pushed only when BOTH `URL_PULSE` (for example
 * https://pulse.kitstak.app) and `PROJECT_PULSE` (the Vercel project name) are in
 * deploy/secrets.env, so this script keeps working before that project exists. When they are
 * set, the other four apps also get `NEXT_PUBLIC_PULSE_URL` and trust the Pulse origin.
 * This script never creates a Vercel project: create it in the dashboard first
 * (docs/DEPLOYMENT.md, "KitStak Pulse").
 * Prereqs: `npm i -g vercel`, `vercel login`, and deploy/secrets.env filled in.
 * Usage: node deploy/push-env.mjs   (from the repo root)
 *
 * Idempotent: removes an existing var before re-adding, for each of
 * production/preview/development. Secrets are added with --sensitive.
 *
 * Signup and billing (docs/billing/GO-LIVE.md). The portal is the only app that talks to Stripe
 * and sends mail, so these go to the portal project only, and only when they are in
 * deploy/secrets.env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PORTAL_CONFIGURATION_ID,
 * STRIPE_AUTOMATIC_TAX, CRON_SECRET, EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO,
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET,
 * MICROSOFT_TENANT_ID, NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_TERMS_URL, NEXT_PUBLIC_PRIVACY_URL.
 * The payment, mail and sign in secrets go to the production target ONLY and are removed from
 * preview and development, so a preview build can never charge a card or send real mail. Values
 * are never printed.
 *
 * ENTITLEMENTS_DEV_ALLOW_ALL stays `1` in all five product projects until billing is enforced.
 * To enforce it (GO-LIVE.md step 11) add `ENFORCE_ENTITLEMENTS=1` to deploy/secrets.env and run
 * this script again: the variable is then removed everywhere. Remove that line to open
 * everything again (the roll back).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SECRETS_PATH = path.join(ROOT, 'deploy', 'secrets.env');

const SUPABASE_REF = 'uvrcwgyzbtcujcbdwjom';
const TARGETS = ['production', 'preview', 'development'];

function parseEnvFile(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!existsSync(SECRETS_PATH)) fail('deploy/secrets.env not found — run from the repo root.');
const s = parseEnvFile(SECRETS_PATH);
if (!s.DB_PASSWORD || s.DB_PASSWORD.includes('PASTE_')) fail('Fill in DB_PASSWORD in deploy/secrets.env');
if (!s.SUPABASE_SERVICE_ROLE_KEY || s.SUPABASE_SERVICE_ROLE_KEY.includes('PASTE_'))
  fail('Fill in SUPABASE_SERVICE_ROLE_KEY in deploy/secrets.env');
for (const k of ['BETTER_AUTH_SECRET', 'WEBHOOK_KDF_SECRET', 'INTEGRATION_KEY'])
  if (!s[k]) fail(`${k} missing from deploy/secrets.env`);
const { BETTER_AUTH_SECRET, WEBHOOK_KDF_SECRET, INTEGRATION_KEY } = s;

const pooled = `postgres://postgres.${SUPABASE_REF}:${s.DB_PASSWORD}@aws-1-us-west-1.pooler.supabase.com:6543/postgres`;
const direct = `postgres://postgres.${SUPABASE_REF}:${s.DB_PASSWORD}@aws-1-us-west-1.pooler.supabase.com:5432/postgres`; // session mode: the db.<ref> direct host is IPv6-only
if (!s.URL_PROJECTS || !s.PROJECT_PROJECTS)
  fail('Add URL_PROJECTS (e.g. https://projects.kitstak.app) and PROJECT_PROJECTS (the Vercel project name, e.g. projects) to deploy/secrets.env');
if (Boolean(s.URL_PULSE) !== Boolean(s.PROJECT_PULSE))
  fail('Set both URL_PULSE (e.g. https://pulse.kitstak.app) and PROJECT_PULSE (the Vercel project name), or neither, in deploy/secrets.env');
const withPulse = Boolean(s.URL_PULSE && s.PROJECT_PULSE);
const urls = { portal: s.URL_PORTAL, crm: s.URL_CRM, wms: s.URL_WMS, projects: s.URL_PROJECTS, pulse: withPulse ? s.URL_PULSE : null };
/** Extra entries for the four sibling apps once Pulse is deployed. */
const pulseUrlVar = withPulse ? [['NEXT_PUBLIC_PULSE_URL', urls.pulse, false]] : [];
const pulseOrigin = withPulse ? [urls.pulse] : [];
const LEGACY = [
  'https://portal-kitstakllc.vercel.app',
  'https://crm-kitstakllc.vercel.app',
  'https://wms-kitstakllc.vercel.app',
  'https://projects-kitstakllc.vercel.app',
  ...(withPulse ? ['https://pulse-kitstakllc.vercel.app'] : []),
];
const trusted = (...own) => [...own, ...LEGACY].join(',');
const COOKIE_DOMAIN = '.kitstak.app';
const scope = s.VERCEL_TEAM ? ['--scope', s.VERCEL_TEAM] : [];

const PRODUCTION_ONLY = ['production'];
/** `[key, null, false]` means: make sure the variable is not set in any target. */
const enforce = s.ENFORCE_ENTITLEMENTS === '1';
const allowAllVar = [['ENTITLEMENTS_DEV_ALLOW_ALL', enforce ? null : '1', false]];

/** A portal variable that is pushed only when deploy/secrets.env has it. */
const optional = (key, sensitive = false, targets = undefined) => (s[key] ? [[key, s[key], sensitive, targets]] : []);

if (s.STRIPE_SECRET_KEY && !s.STRIPE_WEBHOOK_SECRET)
  fail('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. Billing stays off without both (docs/billing/GO-LIVE.md step 8).');
if (s.STRIPE_SECRET_KEY && !/^(sk|rk)_(live|test)_/.test(s.STRIPE_SECRET_KEY))
  fail('STRIPE_SECRET_KEY in deploy/secrets.env does not look like a Stripe secret key.');
if (s.RESEND_API_KEY && !s.EMAIL_FROM)
  fail('RESEND_API_KEY is set but EMAIL_FROM is not. Resend needs a sender address on a verified domain.');
if (Boolean(s.GOOGLE_CLIENT_ID) !== Boolean(s.GOOGLE_CLIENT_SECRET))
  fail('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither.');
if (Boolean(s.MICROSOFT_CLIENT_ID) !== Boolean(s.MICROSOFT_CLIENT_SECRET))
  fail('Set both MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET, or neither.');

/** Signup and billing, portal only. Payment, mail and sign in secrets: production target only. */
const portalBilling = [
  ...optional('STRIPE_SECRET_KEY', true, PRODUCTION_ONLY),
  ...optional('STRIPE_WEBHOOK_SECRET', true, PRODUCTION_ONLY),
  ...optional('STRIPE_PORTAL_CONFIGURATION_ID', false, PRODUCTION_ONLY),
  ...optional('STRIPE_AUTOMATIC_TAX', false, PRODUCTION_ONLY),
  // Vercel Cron sends it to /api/billing/jobs/tick every minute. Without it the route answers 503.
  ...optional('CRON_SECRET', true, PRODUCTION_ONLY),
  ...optional('EMAIL_PROVIDER', false, PRODUCTION_ONLY),
  ...optional('RESEND_API_KEY', true, PRODUCTION_ONLY),
  ...optional('EMAIL_FROM', false, PRODUCTION_ONLY),
  ...optional('EMAIL_REPLY_TO', false, PRODUCTION_ONLY),
  ...optional('GOOGLE_CLIENT_ID', false, PRODUCTION_ONLY),
  ...optional('GOOGLE_CLIENT_SECRET', true, PRODUCTION_ONLY),
  ...optional('MICROSOFT_CLIENT_ID', false, PRODUCTION_ONLY),
  ...optional('MICROSOFT_CLIENT_SECRET', true, PRODUCTION_ONLY),
  ...optional('MICROSOFT_TENANT_ID', false, PRODUCTION_ONLY),
  ...optional('NEXT_PUBLIC_SITE_URL'),
  ...optional('NEXT_PUBLIC_TERMS_URL'),
  ...optional('NEXT_PUBLIC_PRIVACY_URL'),
];

/** [key, value, sensitive] per project */
const PLANS = {
  [s.PROJECT_PORTAL]: [
    ['DATABASE_URL', pooled, true],
    ['BETTER_AUTH_SECRET', BETTER_AUTH_SECRET, true],
    ['BETTER_AUTH_URL', urls.portal, false],
    ['NEXT_PUBLIC_APP_URL', urls.portal, false],
    ['NEXT_PUBLIC_CRM_URL', urls.crm, false],
    ['NEXT_PUBLIC_WMS_URL', urls.wms, false],
    ['NEXT_PUBLIC_PROJECTS_URL', urls.projects, false],
    ...pulseUrlVar,
    ['TRUSTED_ORIGINS', trusted(urls.crm, urls.wms, urls.projects, ...pulseOrigin), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
    ...allowAllVar,
    ...portalBilling,
  ],
  [s.PROJECT_CRM]: [
    ['DATABASE_URL', pooled, true],
    ['DATABASE_URL_UNPOOLED', direct, true],
    ['BETTER_AUTH_SECRET', BETTER_AUTH_SECRET, true],
    ['WEBHOOK_KDF_SECRET', WEBHOOK_KDF_SECRET, true],
    ['BETTER_AUTH_URL', urls.crm, false],
    ['NEXT_PUBLIC_APP_URL', urls.crm, false],
    ['NEXT_PUBLIC_PORTAL_URL', urls.portal, false],
    ['NEXT_PUBLIC_WMS_URL', urls.wms, false],
    ['NEXT_PUBLIC_PROJECTS_URL', urls.projects, false],
    ...pulseUrlVar,
    ['TRUSTED_ORIGINS', trusted(urls.portal, urls.wms, urls.projects, ...pulseOrigin), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
    ...allowAllVar,
  ],
  [s.PROJECT_WMS]: [
    ['DATABASE_URL', pooled, true],
    ['DIRECT_URL', direct, true],
    ['BETTER_AUTH_SECRET', BETTER_AUTH_SECRET, true],
    ['INTEGRATION_KEY', INTEGRATION_KEY, true],
    ['SUPABASE_SERVICE_ROLE_KEY', s.SUPABASE_SERVICE_ROLE_KEY, true],
    ['SUPABASE_URL', `https://${SUPABASE_REF}.supabase.co`, false],
    ['BETTER_AUTH_URL', urls.wms, false],
    ['NEXT_PUBLIC_PORTAL_URL', urls.portal, false],
    ['NEXT_PUBLIC_CRM_URL', urls.crm, false],
    ['NEXT_PUBLIC_WMS_URL', urls.wms, false],
    ['NEXT_PUBLIC_PROJECTS_URL', urls.projects, false],
    ...pulseUrlVar,
    ['TRUSTED_ORIGINS', trusted(urls.portal, urls.crm, urls.projects, ...pulseOrigin), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
    ...allowAllVar,
  ],
  // KitStak Projects (Root Directory apps/projects). Reads CRM/WMS through the shared database;
  // WMS data is offered only to the org that owns the single-tenant WMS install.
  [s.PROJECT_PROJECTS]: [
    ['DATABASE_URL', pooled, true],
    ['DIRECT_URL', direct, true],
    ['BETTER_AUTH_SECRET', BETTER_AUTH_SECRET, true],
    ['BETTER_AUTH_URL', urls.projects, false],
    ['NEXT_PUBLIC_APP_URL', urls.projects, false],
    ['NEXT_PUBLIC_PORTAL_URL', urls.portal, false],
    ['NEXT_PUBLIC_CRM_URL', urls.crm, false],
    ['NEXT_PUBLIC_WMS_URL', urls.wms, false],
    ...pulseUrlVar,
    ['TRUSTED_ORIGINS', trusted(urls.portal, urls.crm, urls.wms, ...pulseOrigin), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
    ['WMS_PLATFORM_ORG_SLUG', s.WMS_PLATFORM_ORG_SLUG || 'kitstak', false],
    ...allowAllVar,
    // Vercel Cron authenticates with this (drains CRM/WMS events into Projects automations).
    ...(s.CRON_SECRET ? [['CRON_SECRET', s.CRON_SECRET, true]] : []),
    // Attachments go to Vercel Blob when set (else stored in the database).
    ...(s.BLOB_READ_WRITE_TOKEN ? [['BLOB_READ_WRITE_TOKEN', s.BLOB_READ_WRITE_TOKEN, true]] : []),
  ],
  // KitStak Pulse (Root Directory apps/pulse). Reads CRM, WMS and Projects through the shared
  // database and works with none of them. Its API is same origin only, so the sibling origins
  // are trusted for the shared sign-in, not for cross-origin API calls.
  ...(withPulse
    ? {
        [s.PROJECT_PULSE]: [
          ['DATABASE_URL', pooled, true],
          ['DIRECT_URL', direct, true],
          ['BETTER_AUTH_SECRET', BETTER_AUTH_SECRET, true],
          ['BETTER_AUTH_URL', urls.pulse, false],
          ['NEXT_PUBLIC_APP_URL', urls.pulse, false],
          ['NEXT_PUBLIC_PULSE_URL', urls.pulse, false],
          ['NEXT_PUBLIC_PORTAL_URL', urls.portal, false],
          ['NEXT_PUBLIC_CRM_URL', urls.crm, false],
          ['NEXT_PUBLIC_WMS_URL', urls.wms, false],
          ['NEXT_PUBLIC_PROJECTS_URL', urls.projects, false],
          ['TRUSTED_ORIGINS', trusted(urls.portal, urls.crm, urls.wms, urls.projects), false],
          ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
          // Same posture as the other apps until billing is enforced (docs/billing/GO-LIVE.md step 11).
          ...allowAllVar,
          // Vercel Cron authenticates with this. Without it the three Pulse crons answer 503:
          // sibling sync and alerts then run only while someone has Pulse open.
          ...(s.CRON_SECRET ? [['CRON_SECRET', s.CRON_SECRET, true]] : []),
        ],
      }
    : {}),
};
if (!withPulse) console.log('\n(KitStak Pulse skipped: URL_PULSE and PROJECT_PULSE are not in deploy/secrets.env.)');
console.log(
  enforce
    ? '\nENFORCE_ENTITLEMENTS=1: removing ENTITLEMENTS_DEV_ALLOW_ALL everywhere. Access now follows core.entitlements.'
    : '\nENTITLEMENTS_DEV_ALLOW_ALL=1 stays in every product project (every organization can open every app).',
);
if (!s.STRIPE_SECRET_KEY) console.log('No STRIPE_SECRET_KEY in deploy/secrets.env: billing stays off in production (it fails closed).');
else console.log(`Stripe key found: ${/^(sk|rk)_live_/.test(s.STRIPE_SECRET_KEY) ? 'LIVE mode' : 'TEST mode (screens will say "Test mode")'}.`);
if (!s.RESEND_API_KEY) console.log('No RESEND_API_KEY in deploy/secrets.env: emails stay queued in production.');
if (!s.CRON_SECRET) console.log('No CRON_SECRET in deploy/secrets.env: the billing job answers 503 in production.');

function vercel(args, opts = {}) {
  return execFileSync('vercel', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: true, ...opts });
}

for (const [project, vars] of Object.entries(PLANS)) {
  const cwd = path.join(ROOT, 'deploy', '.link', project);
  mkdirSync(cwd, { recursive: true });
  console.log(`\n── ${project} ──`);
  vercel(['link', '--yes', '--project', project, ...scope], { cwd });
  for (const [key, value, sensitive, only] of vars) {
    for (const target of TARGETS) {
      try {
        vercel(['env', 'rm', key, target, '--yes', ...scope], { cwd });
      } catch {
        /* did not exist: fine */
      }
      // A null value, or a target this variable is not meant for, stays removed.
      if (value === null || (only && !only.includes(target))) {
        process.stdout.write(`  ${key} -> ${target} (not set)\n`);
        continue;
      }
      const flags = sensitive && target === 'production' ? ['--sensitive'] : [];
      vercel(['env', 'add', key, target, ...flags, ...scope], { cwd, input: value });
      process.stdout.write(`  ${key} -> ${target}${sensitive ? ' (sensitive)' : ''}\n`);
    }
  }
}
console.log('\n✓ All environment variables pushed. Now redeploy each project (Deployments -> … -> Redeploy).');
