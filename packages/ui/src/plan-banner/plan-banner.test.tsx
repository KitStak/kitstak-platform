import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanBanner, planBannerCanHide, planBannerDay, planBannerStorageKey, type PlanBannerNotice } from './index';

const TRIAL: PlanBannerNotice = {
  kind: 'trial',
  tone: 'info',
  text: 'Free trial. 9 days left. Ends Dec 7.',
  action: { label: 'Pick a plan', href: 'https://portal.test/billing/plan?from=crm' },
  testId: 'plan-notice-trial',
};
const ENDED: PlanBannerNotice = {
  kind: 'trial_ended',
  tone: 'danger',
  text: 'Your free trial ended on Dec 7. Your data is safe. Pick a plan to keep working.',
  action: { label: 'Pick a plan', href: 'https://portal.test/billing/plan?from=crm' },
  testId: 'plan-notice-trial_ended',
};
const MEMBER: PlanBannerNotice = {
  kind: 'trial_ended',
  tone: 'danger',
  text: 'This app is view only right now. Ask Maya Chen to pick a plan.',
  action: null,
  testId: 'plan-notice-trial_ended',
};

describe('PlanBanner', () => {
  it('renders nothing for a null notice', () => {
    expect(renderToStaticMarkup(<PlanBanner notice={null} />)).toBe('');
  });

  it('renders an info notice as a status row with the words and a real link', () => {
    const html = renderToStaticMarkup(<PlanBanner notice={TRIAL} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-testid="plan-notice-trial"');
    expect(html).toContain('data-tone="info"');
    expect(html).toContain('Free trial. 9 days left. Ends Dec 7.');
    expect(html).toContain('<a href="https://portal.test/billing/plan?from=crm" data-testid="plan-notice-action"');
    expect(html).toContain('>Pick a plan</a>');
    expect(html).not.toContain('Hide for today');
  });

  it('renders warning and danger notices as alerts', () => {
    expect(renderToStaticMarkup(<PlanBanner notice={ENDED} />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<PlanBanner notice={{ ...ENDED, tone: 'warning' }} />)).toContain('role="alert"');
  });

  it('shows no link when the notice has no action (members)', () => {
    const html = renderToStaticMarkup(<PlanBanner notice={MEMBER} />);
    expect(html).toContain('Ask Maya Chen to pick a plan.');
    expect(html).not.toContain('plan-notice-action');
    expect(html).not.toContain('<a ');
  });

  it('offers "Hide for today" only on info notices that are dismissible', () => {
    expect(renderToStaticMarkup(<PlanBanner notice={TRIAL} dismissible />)).toContain('aria-label="Hide for today"');
    expect(renderToStaticMarkup(<PlanBanner notice={ENDED} dismissible />)).not.toContain('Hide for today');
    expect(planBannerCanHide(TRIAL, true)).toBe(true);
    expect(planBannerCanHide(TRIAL, false)).toBe(false);
    expect(planBannerCanHide(TRIAL, undefined)).toBe(false);
    expect(planBannerCanHide(ENDED, true)).toBe(false);
    expect(planBannerCanHide({ ...ENDED, tone: 'warning' }, true)).toBe(false);
  });

  it('keeps one storage key per kind and one day string', () => {
    expect(planBannerStorageKey('trial')).toBe('kitstak-notice-hidden:trial');
    expect(planBannerDay(new Date('2026-11-23T23:59:59Z'))).toBe('2026-11-23');
  });

  it('adds the host class name after its own', () => {
    expect(renderToStaticMarkup(<PlanBanner notice={TRIAL} className="print:hidden" />)).toContain('class="ks-planbanner print:hidden"');
  });
});
