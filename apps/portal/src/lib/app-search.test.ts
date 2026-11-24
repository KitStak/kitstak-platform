import { describe, expect, test } from 'vitest';
import { filterApps, type SearchableApp } from './app-search';

const APPS: readonly SearchableApp[] = [
  { module: 'crm', name: 'KitStak CRM', tagline: 'Deals and pipelines' },
  { module: 'wms', name: 'KitStak WMS', tagline: 'Warehouse operations' },
  { module: 'projects', name: 'KitStak Projects', tagline: 'Projects and tasks' },
  { module: 'pulse', name: 'KitStak Pulse', tagline: 'Job performance and profitability' },
];

const modules = (apps: readonly SearchableApp[]): string[] => apps.map((app) => app.module);

describe('filterApps', () => {
  test('returns every app for an empty or blank query', () => {
    expect(modules(filterApps(APPS, ''))).toEqual(['crm', 'wms', 'projects', 'pulse']);
    expect(modules(filterApps(APPS, '   '))).toEqual(['crm', 'wms', 'projects', 'pulse']);
  });

  test('matches the app name without caring about case', () => {
    expect(modules(filterApps(APPS, 'pulse'))).toEqual(['pulse']);
    expect(modules(filterApps(APPS, 'CRM'))).toEqual(['crm']);
  });

  test('matches words in the tagline', () => {
    expect(modules(filterApps(APPS, 'warehouse'))).toEqual(['wms']);
    expect(modules(filterApps(APPS, 'deals'))).toEqual(['crm']);
  });

  test('needs every word to match, in any order', () => {
    expect(modules(filterApps(APPS, 'job profit'))).toEqual(['pulse']);
    expect(modules(filterApps(APPS, 'tasks projects'))).toEqual(['projects']);
    expect(modules(filterApps(APPS, 'deals warehouse'))).toEqual([]);
  });

  test('does not let the shared "KitStak" prefix match every app', () => {
    expect(modules(filterApps(APPS, 'kitstak'))).toEqual(['crm', 'wms', 'projects', 'pulse']);
    expect(modules(filterApps(APPS, 'kitstak wms'))).toEqual(['wms']);
  });

  test('returns nothing when no app matches', () => {
    expect(filterApps(APPS, 'payroll')).toEqual([]);
  });
});
