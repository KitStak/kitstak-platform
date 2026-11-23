import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlanBannerNotice } from '../plan-banner';
import { VIEW_ONLY_MESSAGE, ViewOnlyGuard, isWritePath } from './index';

const ENDED: PlanBannerNotice = {
  kind: 'trial_ended',
  tone: 'danger',
  text: 'Your free trial ended on Dec 7. Your data is safe. Pick a plan to keep working.',
  action: { label: 'Pick a plan', href: 'https://portal.test/billing/plan?from=pulse' },
  testId: 'plan-notice-trial_ended',
};
const MEMBER: PlanBannerNotice = { ...ENDED, text: 'This app is view only right now. Ask Maya Chen to pick a plan.', action: null };

describe('isWritePath', () => {
  it('matches a create screen by its whole path or by its end, and nothing else', () => {
    expect(isWritePath('/jobs/new', ['/jobs/new'])).toBe(true);
    expect(isWritePath('/jobs/new/', ['/jobs/new'])).toBe(true);
    expect(isWritePath('/acme/jobs/new', ['/jobs/new'])).toBe(true);
    expect(isWritePath('/jobs', ['/jobs/new'])).toBe(false);
    expect(isWritePath('/jobs/new/review', ['/jobs/new'])).toBe(false);
    expect(isWritePath('/projects/new', [/^\/projects\/new(\/|$)/])).toBe(true);
    expect(isWritePath('/projects', [])).toBe(false);
    expect(isWritePath('/projects')).toBe(false);
  });
});

describe('ViewOnlyGuard', () => {
  it('renders nothing while the plan is not view only', () => {
    expect(renderToStaticMarkup(<ViewOnlyGuard active={false} notice={ENDED} pathname="/jobs/new" writePaths={['/jobs/new']} />)).toBe('');
  });

  it('repeats the banner words and the banner button', () => {
    const html = renderToStaticMarkup(<ViewOnlyGuard active notice={ENDED} pathname="/jobs" writePaths={['/jobs/new']} />);
    expect(html).toContain('Your plan is view only right now');
    expect(html).toContain('Your free trial ended on Dec 7. Your data is safe. Pick a plan to keep working.');
    expect(html).toContain('<a href="https://portal.test/billing/plan?from=pulse" class="ks-viewonly-primary" data-testid="view-only-action">Pick a plan</a>');
    expect(html).toContain('data-mode="dialog"');
    expect(html).toContain('data-testid="view-only-close"');
  });

  it('a member with no billing rights sees who to ask and no pay button', () => {
    const html = renderToStaticMarkup(<ViewOnlyGuard active notice={MEMBER} pathname="/jobs" />);
    expect(html).toContain('Ask Maya Chen to pick a plan.');
    expect(html).not.toContain('view-only-action');
  });

  it('falls back to the one shared sentence when there is no banner', () => {
    expect(renderToStaticMarkup(<ViewOnlyGuard active notice={null} pathname="/" />)).toContain(VIEW_ONLY_MESSAGE);
  });

  it('on a create screen it covers the page and offers a way back instead of Close', () => {
    const html = renderToStaticMarkup(<ViewOnlyGuard active notice={ENDED} pathname="/jobs/new" writePaths={['/jobs/new']} homeHref="/jobs" />);
    expect(html).toContain('data-mode="page"');
    expect(html).toContain('<a href="/jobs" class="ks-viewonly-secondary" data-testid="view-only-back">Go back</a>');
    expect(html).not.toContain('view-only-close');
  });

  it('uses no dash and keeps sentences short', () => {
    expect(VIEW_ONLY_MESSAGE).not.toMatch(/[–—]|-{2}/);
    for (const sentence of VIEW_ONLY_MESSAGE.split(/(?<=[.?!])\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
});
