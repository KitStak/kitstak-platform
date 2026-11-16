import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';

const webRoot = path.resolve(__dirname, '../..');
const hasProjectsApp = existsSync(path.resolve(webRoot, '../projects/src'));

describe('Projects snapshot', () => {
  it.runIf(hasProjectsApp)('matches the Projects app code (run sync:projects if this fails)', () => {
    const tsx = path.resolve(webRoot, 'node_modules/tsx/dist/cli.mjs');
    expect(() =>
      execFileSync(process.execPath, [tsx, '--tsconfig', 'scripts/tsconfig.sync.json', 'scripts/sync-projects.ts', '--check'], {
        cwd: webRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 60_000);

  it('describes every cross-app recipe by the app it needs', () => {
    const crossApp = PROJECTS_CATALOG.automation.recipes.filter((r) => r.categories.includes('CRM and WMS' as never));
    expect(crossApp.length).toBeGreaterThan(0);
    expect(crossApp.every((r) => r.needs === 'crm' || r.needs === 'wms')).toBe(true);
  });
});
