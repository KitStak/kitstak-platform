import { describe, expect, test } from 'vitest';
import { MODULES } from './modules';
import { PREVIEW_APPS, isPreviewApp, previewAccess, previewOrgSlugs } from './preview';

const PROD = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

describe('previewOrgSlugs', () => {
  test('reads a comma separated list, trimmed and lower cased', () => {
    expect([...previewOrgSlugs({ ...PROD, KITSTAK_PREVIEW_ORGS: ' Team1, kitstak ,,driftwood ' })]).toEqual([
      'team1',
      'kitstak',
      'driftwood',
    ]);
  });

  test('is empty when the variable is missing or blank', () => {
    expect(previewOrgSlugs(PROD).size).toBe(0);
    expect(previewOrgSlugs({ ...PROD, KITSTAK_PREVIEW_ORGS: '  ' }).size).toBe(0);
  });
});

describe('previewAccess', () => {
  test('lets in only listed orgs in production', () => {
    const env = { ...PROD, KITSTAK_PREVIEW_ORGS: 'team1' };
    expect(previewAccess('crew', 'team1', env)).toBe('full');
    expect(previewAccess('ledger', 'TEAM1', env)).toBe('full');
    expect(previewAccess('crew', 'someone-else', env)).toBe('locked');
    expect(previewAccess('crew', null, env)).toBe('locked');
  });

  test('fails closed in production with no list', () => {
    expect(previewAccess('crew', 'team1', PROD)).toBe('locked');
  });

  test('lets everyone in outside production, unless allow-all is switched off', () => {
    expect(previewAccess('crew', 'anyone', { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe('full');
    expect(previewAccess('crew', 'anyone', { NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe('full');
    expect(
      previewAccess('crew', 'anyone', { NODE_ENV: 'development', ENTITLEMENTS_DEV_ALLOW_ALL: 'false' } as NodeJS.ProcessEnv),
    ).toBe('locked');
  });

  test('ENTITLEMENTS_DEV_ALLOW_ALL=true opens it even in production, like the other apps', () => {
    expect(previewAccess('ledger', 'anyone', { ...PROD, ENTITLEMENTS_DEV_ALLOW_ALL: 'true' })).toBe('full');
  });
});

describe('preview apps', () => {
  test('are Crew and Ledger, and never a billed module', () => {
    expect(PREVIEW_APPS).toEqual(['crew', 'ledger']);
    for (const app of PREVIEW_APPS) expect((MODULES as readonly string[]).includes(app)).toBe(false);
    expect(isPreviewApp('crew')).toBe(true);
    expect(isPreviewApp('pulse')).toBe(false);
  });
});
