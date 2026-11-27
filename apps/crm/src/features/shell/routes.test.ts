import { describe, expect, it } from 'vitest';
import { routes } from './routes';

describe('routes.templates', () => {
  it('opens the template center wizard on Home, a page that exists', () => {
    expect(routes.templates('acme')).toBe('/acme?wizard=templates');
  });

  it('can open one template, with the id encoded', () => {
    expect(routes.templates('acme', 'crm-deals')).toBe('/acme?wizard=templates&template=crm-deals');
    expect(routes.templates('acme', 'a b')).toBe('/acme?wizard=templates&template=a%20b');
  });

  it('never points at the workspaces list, which has no template view', () => {
    expect(routes.templates('acme')).not.toContain('/workspaces');
  });
});

describe('list routes behind headline numbers', () => {
  it('builds the automations list, optionally filtered by status', () => {
    expect(routes.automations('acme')).toBe('/acme/automations');
    expect(routes.automations('acme', 'failing')).toBe('/acme/automations?status=failing');
  });

  it('builds the dashboards, API token and pipeline pages', () => {
    expect(routes.dashboards('acme')).toBe('/acme/dashboards');
    expect(routes.apiTokens('acme')).toBe('/acme/admin/api');
    expect(routes.pipeline('acme')).toBe('/acme/crm/pipeline');
  });
});
