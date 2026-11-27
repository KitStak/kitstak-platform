import { describe, expect, it } from 'vitest';
import { routes } from './routes';

describe('routes.automations', () => {
  it('is the plain page with no options', () => {
    expect(routes.automations()).toBe('/automations');
    expect(routes.automations({ tab: 'rules' })).toBe('/automations');
  });

  it('carries the tab and filters the stat tiles link to', () => {
    expect(routes.automations({ state: 'on' })).toBe('/automations?state=on');
    expect(routes.automations({ tab: 'history', result: 'failed' })).toBe('/automations?tab=history&result=failed');
  });
});
