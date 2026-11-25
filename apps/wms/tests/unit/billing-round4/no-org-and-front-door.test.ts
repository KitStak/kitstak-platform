/**
 * Billing review round 4, the WMS side (pure parts).
 *
 *  1. A signed in person with no organization reloaded the lock screen forever: the lock screen sent
 *     them to the setup page, and the setup page (and the proxy) sent them back. Now the lock
 *     screen has an end state for them, and it only ever sends a person to the setup page when that
 *     page will show something. Proven here for every mix of organizations a person can have.
 *  2. One front door: a signed out visit to the WMS sign in goes to the Portal's, with the full WMS
 *     address to come back to. The WMS page stays for the few cases only it can serve.
 */
import { describe, expect, it, vi } from 'vitest';
import type { WmsOrgChoice } from '@/server/tenancy/registry';

// lock-view.ts reads the request and the database when it loads a view. The rules under test are pure.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { restingView, setupHasSomethingToShow } = await import('@/server/tenancy/lock-view');
const { landingDecision, LOCKED_PATH, SETUP_PATH } = await import('@/server/http/landing-gate');
const { frontDoorDecision, isFrontDoorPath } = await import('@/server/http/front-door');
const { isSetupRole, openableOrgs, setupCandidates } = await import('@/server/tenancy/registry');

function org(overrides: Partial<WmsOrgChoice>): WmsOrgChoice {
  return { orgId: 'o1', name: 'Acme', slug: 'acme', memberRole: 'member', schemaName: null, entitled: false, ...overrides };
}

/** What the setup page does with these organizations (the same rules as setup-offers.ts and the page). */
function setupPageRenders(choices: readonly WmsOrgChoice[]): boolean {
  const offers = setupCandidates(choices);
  if (offers.length > 0) return true;
  if (openableOrgs(choices).length > 0) return false; // redirects to the app
  const held = choices.find((c) => c.entitled && c.viewOnly === true && !c.schemaName && isSetupRole(c.memberRole));
  if (held) return true;
  const waitingOn = choices.filter((c) => c.entitled && !c.schemaName);
  return waitingOn.length > 0; // otherwise it redirects to the lock screen
}

describe('the lock screen and the setup page can not send a person back and forth', () => {
  it('a person in no organization gets an end state, never the setup page', () => {
    expect(restingView([])).toEqual({ kind: 'no_org' });
    expect(setupHasSomethingToShow([])).toBe(false);
    // And the proxy sends such a person from every page to the lock screen, where that state shows.
    for (const path of ['/', '/dashboard', SETUP_PATH, '/orders']) {
      expect(landingDecision(path, { kind: 'no_warehouse', canSetUp: false, anyEntitled: false })).toBe(LOCKED_PATH);
    }
    expect(landingDecision(LOCKED_PATH, { kind: 'no_warehouse', canSetUp: false, anyEntitled: false })).toBeNull();
  });

  it('the setup page is only ever named when it will render, for every mix of organizations', () => {
    const roles = ['owner', 'admin', 'member', 'viewer', 'billing'];
    const shapes: Partial<WmsOrgChoice>[] = [];
    for (const memberRole of roles) {
      for (const entitled of [true, false]) {
        for (const schemaName of [null, 'wms_0123456789abcdef0123456789abcdef']) {
          for (const viewOnly of [false, true]) shapes.push({ memberRole, entitled, schemaName, ...(viewOnly && entitled ? { viewOnly: true } : {}) });
        }
      }
    }
    let seen = 0;
    const sets: WmsOrgChoice[][] = [[]];
    shapes.forEach((a, i) => {
      sets.push([org({ ...a, orgId: 'a' })]);
      shapes.forEach((b, j) => {
        if (j > i) sets.push([org({ ...a, orgId: 'a' }), org({ ...b, orgId: 'b' })]);
      });
    });
    for (const choices of sets) {
      const view = restingView(choices);
      if (view.kind === 'setup') {
        // The lock screen redirects to the setup page: that page must render, not redirect back.
        expect(setupPageRenders(choices), JSON.stringify(choices)).toBe(true);
        seen += 1;
      }
      if (view.kind === 'open') expect(openableOrgs(choices).length).toBeGreaterThan(0);
      if (view.kind === 'no_org') expect(choices).toHaveLength(0);
      if (view.kind === 'no_warehouse') {
        expect(choices.length).toBeGreaterThan(0);
        expect(openableOrgs(choices)).toHaveLength(0);
        expect(setupHasSomethingToShow(choices)).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(sets.length).toBeGreaterThan(500);
  });

  it('an organization with the WMS and no warehouse yet goes to the setup page', () => {
    expect(restingView([org({ entitled: true, memberRole: 'owner' })])).toEqual({ kind: 'setup' });
    expect(restingView([org({ entitled: true, memberRole: 'member' })])).toEqual({ kind: 'setup' });
  });

  it('a warehouse that opens wins, and nothing to open or set up is an end state too', () => {
    expect(restingView([org({ entitled: true, schemaName: 'wms' })])).toEqual({ kind: 'open' });
    expect(restingView([org({ entitled: false, schemaName: 'wms' })])).toEqual({ kind: 'no_warehouse' });
    expect(restingView([org({ entitled: false, schemaName: null })])).toEqual({ kind: 'no_warehouse' });
  });
});

describe('one front door: the WMS sign in page', () => {
  const facts = { hasValidSession: false, ssoEnabled: false, portalUrl: 'https://portal.kitstak.io', appUrl: 'https://wms.kitstak.io' };
  const params = (query: string) => new URLSearchParams(query);

  it('a signed out visit goes to the Portal sign in, with the full WMS address to come back to', () => {
    expect(frontDoorDecision('/login', params('next=%2Forders%3Ftab%3Dopen'), facts)).toBe(
      `https://portal.kitstak.io/login?next=${encodeURIComponent('https://wms.kitstak.io/orders?tab=open')}`,
    );
    expect(frontDoorDecision('/login', params(''), facts)).toBe(`https://portal.kitstak.io/login?next=${encodeURIComponent('https://wms.kitstak.io/')}`);
    // Signed out after a long time away: the Portal says so.
    expect(frontDoorDecision('/login', params('reason=idle&next=%2Fdashboard'), facts)).toBe(
      `https://portal.kitstak.io/login?next=${encodeURIComponent('https://wms.kitstak.io/dashboard')}&notice=idle`,
    );
    // A path that could be read as another site is dropped.
    expect(frontDoorDecision('/login', params('next=%2F%2Fevil.example'), facts)).toBe(`https://portal.kitstak.io/login?next=${encodeURIComponent('https://wms.kitstak.io/')}`);
  });

  it('"Forgot password" goes to the one place a password is reset', () => {
    expect(frontDoorDecision('/forgot-password', params(''), facts)).toBe('https://portal.kitstak.io/forgot-password');
  });

  it('the WMS page stays for company single sign on, its errors, tests, and a person the WMS itself refused', () => {
    expect(frontDoorDecision('/login', params(''), { ...facts, ssoEnabled: true })).toBeNull();
    expect(frontDoorDecision('/login', params('sso_error=Denied'), facts)).toBeNull();
    expect(frontDoorDecision('/login', params('local=1'), facts)).toBeNull();
    // The Portal sent the person here, or the browser holds a session the WMS refuses: going back
    // to the Portal would only bounce them here again.
    expect(frontDoorDecision('/login', params('from=portal&next=%2Forders'), facts)).toBeNull();
    expect(frontDoorDecision('/login', params(''), { ...facts, hasValidSession: true })).toBeNull();
  });

  it('a WMS with no Portal address keeps its own pages, and no other path is touched', () => {
    expect(frontDoorDecision('/login', params(''), { ...facts, portalUrl: null })).toBeNull();
    expect(frontDoorDecision('/forgot-password', params(''), { ...facts, portalUrl: '' })).toBeNull();
    expect(frontDoorDecision('/reset-password', params('token=abc'), facts)).toBeNull();
    expect(frontDoorDecision('/dashboard', params(''), facts)).toBeNull();
    expect(isFrontDoorPath('/login')).toBe(true);
    expect(isFrontDoorPath('/forgot-password')).toBe(true);
    expect(isFrontDoorPath('/login/extra')).toBe(false);
    expect(isFrontDoorPath('/api/auth/sign-in/email')).toBe(false);
  });
});
