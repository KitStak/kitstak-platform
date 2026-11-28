/**
 * The preview gate (docs/crew/SPEC.md 3.4): `orgCrewAccess` is the only caller of `previewAccess`,
 * and every gated surface goes through it. The launch test turns on once `crew` is a module.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isModule } from '@kitstak/entitlements';
import { describe, expect, it } from 'vitest';
import { orgCrewAccess } from './entitlements';

const SRC = path.resolve(__dirname, '..');
const org = { id: '11111111-1111-4111-8111-111111111111', slug: 'kitstak' };
const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'production', ...extra }) as unknown as NodeJS.ProcessEnv;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('orgCrewAccess', () => {
  it('lets everyone in outside production, unless the allow all switch says no', async () => {
    expect(await orgCrewAccess(org, { NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv)).toBe('full');
    expect(await orgCrewAccess(org, { NODE_ENV: 'development', ENTITLEMENTS_DEV_ALLOW_ALL: 'false' } as unknown as NodeJS.ProcessEnv)).toBe('locked');
  });

  it('in production lets in listed orgs only, ignoring case and spaces', async () => {
    expect(await orgCrewAccess(org, prod())).toBe('locked');
    expect(await orgCrewAccess(org, prod({ KITSTAK_PREVIEW_ORGS: 'acme, KitStak ,' }))).toBe('full');
    expect(await orgCrewAccess({ ...org, slug: 'acme-2' }, prod({ KITSTAK_PREVIEW_ORGS: 'acme' }))).toBe('locked');
    expect(await orgCrewAccess(org, prod({ ENTITLEMENTS_DEV_ALLOW_ALL: 'true' }))).toBe('full');
  });
});

describe('every gate goes through orgCrewAccess', () => {
  const files = walk(SRC);
  const read = (relative: string) => fs.readFileSync(path.join(SRC, relative), 'utf8');

  it('only src/server/entitlements.ts calls previewAccess', () => {
    const callers = files.filter((file) => /previewAccess\(/.test(fs.readFileSync(file, 'utf8'))).map((file) => path.relative(SRC, file).replace(/\\/g, '/'));
    expect(callers).toEqual(['server/entitlements.ts']);
  });

  it('the (app) layout, route handlers and server actions use the gate', () => {
    expect(read('features/shell/shell-frame.tsx')).toContain('orgCrewAccess(context.org)');
    expect(read('app/(app)/layout.tsx')).toContain('PreviewLockedFrame');
    expect(read('server/http/api.ts')).toContain('assertPlanAllows(context.org');
    expect(read('server/actions/_action.ts')).toContain('assertPlanAllows(context.org');
    expect(read('server/plan-gate.ts')).toContain('orgCrewAccess(org)');
    // Pages render in parallel with the layout, so each one checks the gate itself.
    expect(read('server/page.ts')).toContain('orgCrewAccess(context.org)');
  });

  it('every signed in API route under /api/v1 uses apiRoute or csvRoute (and so the gate)', () => {
    const routes = files.filter((file) => /[\\/]app[\\/]api[\\/]v1[\\/].*route\.ts$/.test(file) && !/[\\/]agency[\\/]/.test(file));
    expect(routes.length).toBeGreaterThan(0);
    for (const file of routes) expect(fs.readFileSync(file, 'utf8'), file).toMatch(/\b(apiRoute|csvRoute)(<[^>]*>)?\(/);
    expect(read('server/http/api.ts').match(/assertPlanAllows\(context\.org/g)?.length).toBe(2);
  });

  it('the public agency link checks the gate of the link workspace (a locked org answers "not active")', () => {
    expect(read('app/api/v1/agency/[token]/route.ts')).toContain('submitAgencyRows(');
    expect(read('app/join/a/[token]/page.tsx')).toContain('readPublicLink(');
    expect(read('server/domain/agency-public.ts')).toContain('orgCrewAccess({ id: row.orgId, slug: row.orgSlug })');
  });

  it('every server action file runs through runAction (and so the gate)', () => {
    const actions = files.filter((file) => /[\\/]server[\\/]actions[\\/](?!_action)[^\\/]+\.ts$/.test(file));
    for (const file of actions) expect(fs.readFileSync(file, 'utf8'), file).toContain('runAction(');
  });

  it.skipIf(!isModule('crew'))('at launch Crew no longer calls previewAccess', () => {
    expect(files.some((file) => /previewAccess\(/.test(fs.readFileSync(file, 'utf8')))).toBe(false);
  });
});
