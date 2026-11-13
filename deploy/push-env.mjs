/**
 * Pushes every environment variable to the four Vercel projects (portal, crm, wms, projects)
 * via the Vercel CLI.
 * Prereqs: `npm i -g vercel`, `vercel login`, and deploy/secrets.env filled in.
 * Usage: node deploy/push-env.mjs   (from the repo root)
 *
 * Idempotent: removes an existing var before re-adding, for each of
 * production/preview/development. Secrets are added with --sensitive.
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
const urls = { portal: s.URL_PORTAL, crm: s.URL_CRM, wms: s.URL_WMS, projects: s.URL_PROJECTS };
const LEGACY = [
  'https://portal-kitstakllc.vercel.app',
  'https://crm-kitstakllc.vercel.app',
  'https://wms-kitstakllc.vercel.app',
  'https://projects-kitstakllc.vercel.app',
];
const trusted = (...own) => [...own, ...LEGACY].join(',');
const COOKIE_DOMAIN = '.kitstak.app';
const scope = s.VERCEL_TEAM ? ['--scope', s.VERCEL_TEAM] : [];

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
    ['TRUSTED_ORIGINS', trusted(urls.crm, urls.wms, urls.projects), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
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
    ['TRUSTED_ORIGINS', trusted(urls.portal, urls.wms, urls.projects), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
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
    ['TRUSTED_ORIGINS', trusted(urls.portal, urls.crm, urls.projects), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
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
    ['TRUSTED_ORIGINS', trusted(urls.portal, urls.crm, urls.wms), false],
    ['AUTH_COOKIE_DOMAIN', COOKIE_DOMAIN, false],
    ['WMS_PLATFORM_ORG_SLUG', s.WMS_PLATFORM_ORG_SLUG || 'kitstak', false],
    ['ENTITLEMENTS_DEV_ALLOW_ALL', '1', false],
    // Vercel Cron authenticates with this (drains CRM/WMS events into Projects automations).
    ...(s.CRON_SECRET ? [['CRON_SECRET', s.CRON_SECRET, true]] : []),
    // Attachments go to Vercel Blob when set (else stored in the database).
    ...(s.BLOB_READ_WRITE_TOKEN ? [['BLOB_READ_WRITE_TOKEN', s.BLOB_READ_WRITE_TOKEN, true]] : []),
  ],
};

function vercel(args, opts = {}) {
  return execFileSync('vercel', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], shell: true, ...opts });
}

for (const [project, vars] of Object.entries(PLANS)) {
  const cwd = path.join(ROOT, 'deploy', '.link', project);
  mkdirSync(cwd, { recursive: true });
  console.log(`\n── ${project} ──`);
  vercel(['link', '--yes', '--project', project, ...scope], { cwd });
  for (const [key, value, sensitive] of vars) {
    for (const target of TARGETS) {
      try {
        vercel(['env', 'rm', key, target, '--yes', ...scope], { cwd });
      } catch {
        /* did not exist: fine */
      }
      const flags = sensitive && target === 'production' ? ['--sensitive'] : [];
      vercel(['env', 'add', key, target, ...flags, ...scope], { cwd, input: value });
      process.stdout.write(`  ${key} -> ${target}${sensitive ? ' (sensitive)' : ''}\n`);
    }
  }
}
console.log('\n✓ All environment variables pushed. Now redeploy each project (Deployments -> … -> Redeploy).');
