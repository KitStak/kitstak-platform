import { describe, expect, it } from 'vitest';
import { APP_SWITCHER_BADGE_LABELS, appSwitcherRow } from './index';

const urls = {
  portal: 'https://portal.test/',
  crm: 'https://crm.test',
  wms: 'https://wms.test',
  projects: 'https://projects.test',
  pulse: 'https://pulse.test',
};
const crm = { id: 'crm', name: 'KitStak CRM' } as const;
const wms = { id: 'wms', name: 'KitStak WMS' } as const;

describe('appSwitcherRow', () => {
  it('opens the app when no plan state is passed (old callers)', () => {
    expect(appSwitcherRow(wms, { current: 'crm', urls })).toMatchObject({ locked: false, href: 'https://wms.test', badge: null });
  });

  it('keeps the old locked row for callers that pass only entitled flags', () => {
    const row = appSwitcherRow(wms, { current: 'crm', urls, entitled: { crm: true, wms: false } });
    expect(row).toMatchObject({
      locked: true,
      href: 'https://portal.test/billing',
      badge: null,
      lockedLabel: 'Locked. Unlock it in Portal billing',
      handoffTitle: 'Opening Portal billing',
    });
    expect(appSwitcherRow(wms, { current: 'crm', urls, notInPlan: ['wms'] }).lockedLabel).toBe('Not in your plan');
  });

  it('sends a row that is not in the plan to the picker with that app turned on', () => {
    const row = appSwitcherRow(wms, { current: 'crm', urls, planBadges: { wms: 'not_in_plan' } });
    expect(row).toMatchObject({
      locked: true,
      href: 'https://portal.test/billing/plan?add=wms',
      badge: 'not_in_plan',
      handoffTitle: 'Opening your plan',
    });
  });

  it('uses the addHref of the host app when one is given', () => {
    const row = appSwitcherRow(wms, {
      current: 'crm',
      urls,
      planBadges: { wms: 'not_in_plan' },
      addHref: (app) => `https://portal.test/billing/plan?add=${app}&from=crm`,
    });
    expect(row.href).toBe('https://portal.test/billing/plan?add=wms&from=crm');
  });

  it('opens a view only app, because view only is never a wall', () => {
    const row = appSwitcherRow(wms, { current: 'crm', urls, planBadges: { wms: 'view_only' } });
    expect(row).toMatchObject({ locked: false, href: 'https://wms.test', badge: 'view_only' });
  });

  it('lets the badge win over the old entitled flag', () => {
    const row = appSwitcherRow(wms, { current: 'crm', urls, entitled: { crm: true, wms: false }, planBadges: { wms: 'trial' } });
    expect(row).toMatchObject({ locked: false, href: 'https://wms.test', badge: 'trial' });
  });

  it('never locks the app the person is in', () => {
    const row = appSwitcherRow(crm, { current: 'crm', urls, planBadges: { crm: 'not_in_plan' } });
    expect(row).toMatchObject({ locked: false, href: 'https://crm.test', badge: 'not_in_plan' });
  });

  it('gives the Portal row no badge', () => {
    const row = appSwitcherRow({ id: 'portal', name: 'KitStak Portal' }, { current: 'crm', urls, planBadges: { crm: 'trial' } });
    expect(row).toMatchObject({ locked: false, badge: null, href: 'https://portal.test/' });
  });

  it('has the six badge words from the billing contract', () => {
    expect(APP_SWITCHER_BADGE_LABELS).toEqual({
      trial: 'Trial',
      active: 'Active',
      past_due: 'Payment due',
      view_only: 'View only',
      not_in_plan: 'Not in your plan',
      included: 'Included',
    });
  });
});

describe('preview apps (Crew, Ledger)', () => {
  const crew = { id: 'crew', name: 'KitStak Crew' } as const;

  it('opens Crew from its own origin and never shows a plan badge or an add to plan link', () => {
    const row = appSwitcherRow(crew, {
      current: 'pulse',
      urls: { ...urls, crew: 'https://crew.test' },
      planBadges: { pulse: 'trial' },
      addHref: () => 'https://portal.test/billing/plan?add=x',
    });
    expect(row).toMatchObject({ locked: false, href: 'https://crew.test', badge: null });
  });

  it('lists Crew as the current app inside Crew even with no origin passed', () => {
    expect(appSwitcherRow(crew, { current: 'crew', urls })).toMatchObject({ locked: false, badge: null });
  });
});
