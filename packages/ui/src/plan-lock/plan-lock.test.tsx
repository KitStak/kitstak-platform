import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PLAN_LOCK_POINTS, PlanLockScreen, billingOnlyLock, type PlanLockView } from './index';

/** An en dash, an em dash, or two hyphens in a row: none may appear in UI copy. */
const DASHES = new RegExp('[\\u2013\\u2014]|-{2}');

const PAID: PlanLockView = {
  title: 'CRM is not in your plan yet',
  body: 'Add CRM for $23.20 per user each month.',
  priceLine: 'That price includes your bundle discount.',
  primary: { label: 'Add CRM to my plan', href: 'https://portal.test/billing/plan?add=crm&from=crm' },
  secondary: { label: 'Back to Portal', href: 'https://portal.test' },
  testId: 'plan-lock',
};
const MEMBER: PlanLockView = {
  title: 'CRM is not in your plan yet',
  body: 'Ask Maya Chen to add it.',
  priceLine: null,
  primary: null,
  secondary: { label: 'Back to Portal', href: 'https://portal.test' },
  testId: 'plan-lock',
};

describe('PlanLockScreen', () => {
  it('renders the title, the body and the price line, body first', () => {
    const html = renderToStaticMarkup(<PlanLockScreen app="crm" lock={PAID} />);
    expect(html).toContain('data-testid="plan-lock"');
    expect(html).toContain('<h1');
    expect(html).toContain('CRM is not in your plan yet');
    expect(html.indexOf('Add CRM for $23.20 per user each month.')).toBeGreaterThan(-1);
    expect(html.indexOf('That price includes your bundle discount.')).toBeGreaterThan(html.indexOf('Add CRM for $23.20'));
  });

  it('renders both actions as real links with the contract test ids', () => {
    const html = renderToStaticMarkup(<PlanLockScreen app="crm" lock={PAID} />);
    expect(html).toContain('<a href="https://portal.test/billing/plan?add=crm&amp;from=crm" data-testid="plan-lock-primary"');
    expect(html).toContain('<a href="https://portal.test" data-testid="plan-lock-secondary"');
    expect(html).toContain('ks-planlock-button-quiet');
  });

  it('makes "Back to Portal" the main button when the person cannot add the app', () => {
    const html = renderToStaticMarkup(<PlanLockScreen app="crm" lock={MEMBER} />);
    expect(html).toContain('Ask Maya Chen to add it.');
    expect(html).not.toContain('plan-lock-primary');
    expect(html).toContain('data-testid="plan-lock-secondary" class="ks-planlock-button ks-planlock-button-primary"');
    expect(html).not.toContain('ks-planlock-price');
  });

  it('labels the section with its heading and names the app', () => {
    const html = renderToStaticMarkup(<PlanLockScreen app="wms" lock={{ ...PAID, title: 'WMS is not in your plan yet' }} />);
    expect(html).toContain('aria-labelledby="ks-planlock-title-wms"');
    expect(html).toContain('id="ks-planlock-title-wms"');
    expect(html).toContain('KitStak WMS');
    expect(html).toContain('data-app="wms"');
  });

  it('has three short lines per app, with no dashes', () => {
    for (const app of ['crm', 'wms', 'projects', 'pulse'] as const) {
      const meta = PLAN_LOCK_POINTS[app];
      expect(meta.points).toHaveLength(3);
      for (const point of meta.points) {
        expect(point).not.toMatch(DASHES);
        expect(point.split(/\s+/).length).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe('billingOnlyLock', () => {
  it('tells a person who only manages billing why no app opens, with one way back', () => {
    const lock = billingOnlyLock('Whitlock Supply Co', 'https://portal.test/');
    expect(lock.title).toBe('You have billing access only');
    expect(lock.body).toBe('You manage billing for Whitlock Supply Co. You do not have a seat in the apps. Ask an owner if you need this app.');
    expect(lock.primary).toBeNull();
    expect(lock.secondary).toEqual({ label: 'Back to Billing', href: 'https://portal.test/billing' });
    expect(lock.priceLine).toBeNull();
    for (const text of [lock.title, lock.body, lock.secondary.label]) expect(text).not.toMatch(DASHES);
  });

  it('renders in the shared lock screen with no price and no list of what the app does', () => {
    const html = renderToStaticMarkup(<PlanLockScreen app="crm" lock={billingOnlyLock('Whitlock Supply Co', 'https://portal.test')} hidePoints />);
    expect(html).toContain('data-testid="plan-lock-billing-only"');
    expect(html).toContain('<a href="https://portal.test/billing" data-testid="plan-lock-secondary"');
    expect(html).not.toContain('ks-planlock-points');
    expect(html).not.toContain('ks-planlock-price');
    for (const point of PLAN_LOCK_POINTS.crm.points) expect(html).not.toContain(point);
  });
});
