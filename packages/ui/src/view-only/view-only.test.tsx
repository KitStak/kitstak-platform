import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlanBannerNotice } from '../plan-banner';
import { READ_LABEL, VIEW_ONLY_MESSAGE, ViewOnlyGuard, ViewOnlyPage, WRITE_LABEL, controlLabel, isWriteLabel, isWritePath } from './index';

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

describe('isWriteLabel', () => {
  const write = (label: string) => isWriteLabel(label, WRITE_LABEL, READ_LABEL);

  it('knows the labels that start a change in the WMS and in Pulse', () => {
    for (const label of [
      'Create client',
      'Add client',
      'Bulk import/update',
      'Import clients',
      'Update clients',
      'Add a labor class',
      'Save the rate',
      'Save',
      'Edit',
      'New job',
      'Log work',
      'Log many days',
      'Delete',
      '+ Add user',
      'Create warehouse',
      'Duplicate',
      'Upload',
      'Change status',
    ])
      expect(write(label), label).toBe(true);
  });

  it('leaves reading, exporting and a person\'s own view alone', () => {
    for (const label of [
      'Export',
      'Open',
      'Newest first',
      'Add filter',
      'Save view',
      'Save as view',
      'Edit columns',
      'New tab',
      'Restore defaults',
      'Remove Status filter',
      'Save filter',
      'Create new view',
      'Import and export',
      'Import details',
      'Change Log',
      'Change Password',
      'Connected apps',
      'Search',
      'Close',
      'Cancel',
      'Pick a plan',
      '',
    ])
      expect(write(label), label).toBe(false);
  });

  it('reads the label a person sees, then the one a screen reader says', () => {
    expect(controlLabel({ textContent: '  Create\n   client ', getAttribute: () => null })).toBe('Create client');
    expect(controlLabel({ textContent: '', getAttribute: (name) => (name === 'aria-label' ? 'Add user' : null) })).toBe('Add user');
    expect(controlLabel({ textContent: null, getAttribute: () => null })).toBe('');
  });
});

describe('ViewOnlyPage', () => {
  it('shows the banner words and button in the page, with a way back', () => {
    const html = renderToStaticMarkup(<ViewOnlyPage notice={ENDED} homeHref="/jobs" />);
    expect(html).toContain('class="ks-viewonly-page"');
    expect(html).toContain('Your plan is view only right now');
    expect(html).toContain('Your free trial ended on Dec 7. Your data is safe. Pick a plan to keep working.');
    expect(html).toContain('<a href="https://portal.test/billing/plan?from=pulse" class="ks-viewonly-primary" data-testid="view-only-action">Pick a plan</a>');
    expect(html).toContain('<a href="/jobs" class="ks-viewonly-secondary" data-testid="view-only-back">Go back</a>');
    expect(html).not.toContain('<dialog');
  });

  it('a member with no billing rights sees who to ask and no pay button', () => {
    const html = renderToStaticMarkup(<ViewOnlyPage notice={MEMBER} />);
    expect(html).toContain('Ask Maya Chen to pick a plan.');
    expect(html).not.toContain('view-only-action');
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

  it('opens no dialog for a create screen when the app shell shows the message in the page', () => {
    const html = renderToStaticMarkup(<ViewOnlyGuard active notice={ENDED} pathname="/jobs/new" writePaths={['/jobs/new']} writePage="inline" />);
    expect(html).toContain('data-mode="dialog"');
    expect(html).toContain('view-only-close');
  });

  it('uses no dash and keeps sentences short', () => {
    expect(VIEW_ONLY_MESSAGE).not.toMatch(/[–—]|-{2}/);
    for (const sentence of VIEW_ONLY_MESSAGE.split(/(?<=[.?!])\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
});
