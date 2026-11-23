import { describe, expect, it } from 'vitest';
import { copyProblems } from '../../tests/support/copy';
import { EMAIL_TEMPLATE_IDS, type EmailTemplateId } from '../email-types';
import { escapeHtml, oneLine, renderContent, safeUrl } from './layout';
import { EmailPayloadError, emailAuditSummary, emailContent, isEmailTemplateId, renderEmail } from './render';
import { SAMPLE_EMAIL_PAYLOADS } from './samples';

const sample = <T extends EmailTemplateId>(template: T) => renderEmail(template, SAMPLE_EMAIL_PAYLOADS[template]);

/** SPEC section 10: the subject and the one button of every email. */
const EXPECTED: Readonly<Record<EmailTemplateId, { subject: string; button: string | null }>> = {
  verify_email: { subject: 'Your KitStak code: 482913', button: null },
  reset_password: { subject: 'Reset your KitStak password', button: null },
  invitation: { subject: 'Maya Chen invited you to Northwind Robotics on KitStak', button: 'Accept invite' },
  welcome: { subject: 'Welcome to KitStak. Your free trial has started.', button: 'Open KitStak' },
  trial_ending: { subject: 'Your KitStak trial ends in 3 days', button: 'Pick a plan' },
  trial_ended: { subject: 'Your KitStak trial has ended. Your data is safe.', button: 'Pick a plan' },
  plan_started: { subject: 'Your KitStak plan is set', button: 'See my plan' },
  receipt: { subject: 'Your KitStak receipt for $395.20', button: 'View invoice' },
  payment_failed: { subject: 'We could not charge your card for KitStak', button: 'Update card' },
  payment_action_required: { subject: 'Your bank needs you to approve a KitStak payment', button: 'Approve payment' },
  grace_ending: { subject: 'Last day to fix your KitStak payment', button: 'Update card' },
  cancel_scheduled: { subject: 'Your KitStak plan will end on Dec 23', button: 'Keep my plan' },
  paused: { subject: 'Your KitStak plan is paused', button: 'See my plan' },
  plan_ended: { subject: 'Your KitStak plan has ended. Your data is safe.', button: 'Pick a plan' },
};

describe('every email template', () => {
  it('covers all 14 templates of the contract', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...EMAIL_TEMPLATE_IDS].sort());
    expect(Object.keys(SAMPLE_EMAIL_PAYLOADS).sort()).toEqual([...EMAIL_TEMPLATE_IDS].sort());
  });

  it.each(EMAIL_TEMPLATE_IDS)('%s has the subject and button from the spec', (template) => {
    const content = emailContent(template, SAMPLE_EMAIL_PAYLOADS[template]);
    expect(content.subject).toBe(EXPECTED[template].subject);
    expect(content.button?.label ?? null).toBe(EXPECTED[template].button);
  });

  it.each(EMAIL_TEMPLATE_IDS)('%s renders an HTML version and a text version that say the same', (template) => {
    const content = emailContent(template, SAMPLE_EMAIL_PAYLOADS[template]);
    const email = sample(template);
    expect(email.subject.length).toBeGreaterThan(10);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html.startsWith('<!doctype html>')).toBe(true);
    expect(email.html).toContain('</html>');
    expect(email.text.trim().length).toBeGreaterThan(40);
    // The heading and every paragraph are in both versions.
    expect(email.html).toContain(escapeHtml(content.heading));
    expect(email.text).toContain(content.heading);
    for (const block of content.blocks) {
      if (block.kind === 'text' || block.kind === 'note') {
        expect(email.html).toContain(escapeHtml(block.text));
        expect(email.text).toContain(block.text);
      }
    }
    // No image, no script, no tracking pixel.
    expect(email.html).not.toMatch(/<img|<script|<link/i);
  });

  it.each(EMAIL_TEMPLATE_IDS)('%s has at most one button, and it is an absolute link', (template) => {
    const email = sample(template);
    // The button and its copyable fallback link share one address. No other link is in the email.
    const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(hrefs).size).toBeLessThanOrEqual(1);
    for (const href of hrefs) expect(href).toMatch(/^https?:\/\//);
    if (EXPECTED[template].button === null) expect(hrefs).toHaveLength(0);
    else expect(hrefs.length).toBeGreaterThan(0);
  });

  it.each(EMAIL_TEMPLATE_IDS)('%s follows the copy rules: plain, short sentences, no dashes', (template) => {
    const content = emailContent(template, SAMPLE_EMAIL_PAYLOADS[template]);
    const strings = [
      content.subject,
      content.preheader,
      content.heading,
      content.footer,
      content.button?.label ?? '',
      ...content.blocks.flatMap((block) => {
        if (block.kind === 'text' || block.kind === 'note') return [block.text];
        if (block.kind === 'facts') return block.rows.flatMap((row) => [row.label, row.value]);
        if (block.kind === 'lines') return [...block.rows.map((row) => row.label), block.total.label];
        return [];
      }),
    ];
    for (const text of strings) expect(copyProblems(text), text).toEqual([]);
    // The preview line is short enough for a phone inbox.
    expect(content.preheader.length).toBeLessThanOrEqual(110);
  });
});

describe('what the emails say', () => {
  it('the code emails show the code and how long it works', () => {
    const verify = sample('verify_email');
    expect(verify.text).toContain('482913');
    expect(verify.text).toContain('It works for 10 minutes.');
    expect(verify.html).toContain('482913');
    const reset = sample('reset_password');
    expect(reset.text).toContain('715204');
    expect(reset.text).toContain('If you did not ask for this, ignore this email.');
  });

  it('the trial reminder says tomorrow on the last day, and shows the price after the trial', () => {
    const last = renderEmail('trial_ending', { ...SAMPLE_EMAIL_PAYLOADS.trial_ending, daysLeft: 1 });
    expect(last.subject).toBe('Your KitStak trial ends tomorrow');
    const week = renderEmail('trial_ending', { ...SAMPLE_EMAIL_PAYLOADS.trial_ending, daysLeft: 7 });
    expect(week.subject).toBe('Your KitStak trial ends in 7 days');
    expect(week.text).toContain('Price after the trial: $395.20 per month');
    expect(week.text).toContain('Your apps: CRM and WMS');
    expect(week.text).toContain('Dec 7, 2026');
    expect(week.text).toContain('Nothing is deleted if you wait.');
    expect(week.text).toContain('http://localhost:3300/billing/plan');
    const yearly = renderEmail('trial_ending', { ...SAMPLE_EMAIL_PAYLOADS.trial_ending, interval: 'yearly', totalCents: 403104 });
    expect(yearly.text).toContain('$4,031.04 per year');
  });

  it('the receipt lists the lines, tax as its own line, the total, the card and the next charge', () => {
    const plain = sample('receipt');
    expect(plain.text).toContain('KitStak CRM, 5 users: $116.00');
    expect(plain.text).toContain('KitStak WMS, 1 warehouse: $279.20');
    expect(plain.text).toContain('Total paid: $395.20');
    expect(plain.text).toContain('Card: Ending 4242');
    expect(plain.text).toContain('Invoice: KS-0001');
    expect(plain.text).toContain('Next charge: Jan 7, 2027');
    expect(plain.text).not.toContain('Sales tax');
    expect(plain.text).toContain('http://localhost:3300/billing/invoices/in_test_sample');

    const taxed = renderEmail('receipt', { ...SAMPLE_EMAIL_PAYLOADS.receipt, taxCents: 3261, amountPaidCents: 42781, nextChargeAt: null, last4: null });
    expect(taxed.text).toContain('Sales tax: $32.61');
    expect(taxed.text).toContain('Total paid: $427.81');
    expect(taxed.text).not.toContain('Next charge');
    expect(taxed.text).not.toContain('Card:');
  });

  it('the failed payment email has the amount, the card, the retry date and the access date', () => {
    const email = sample('payment_failed');
    expect(email.text).toContain('We could not charge the card ending 4242 for $395.20.');
    expect(email.text).toContain('We try again on: Dec 10, 2026');
    expect(email.text).toContain('Full access until: Dec 14, 2026');
    expect(email.text).toContain('http://localhost:3300/billing?fix=payment');
    const lastTry = renderEmail('payment_failed', { ...SAMPLE_EMAIL_PAYLOADS.payment_failed, nextRetryAt: null, last4: null });
    expect(lastTry.text).toContain('We could not charge your card for $395.20.');
    expect(lastTry.text).toContain('We try again on: No more tries planned');
  });

  it('the plan email shows $0.00 due today in a trial, and the paid amount otherwise', () => {
    const trial = sample('plan_started');
    expect(trial.text).toContain('Due today: $0.00');
    expect(trial.text).toContain('First charge: $395.20 on Dec 7, 2026');
    const paid = renderEmail('plan_started', { ...SAMPLE_EMAIL_PAYLOADS.plan_started, dueTodayCents: 39520 });
    expect(paid.text).toContain('Paid today: $395.20');
    expect(paid.text).not.toContain('First charge');
  });

  it('cancel, pause and end emails carry their dates and say nothing is deleted', () => {
    expect(sample('cancel_scheduled').text).toContain('You keep everything until Dec 23, 2026.');
    expect(sample('paused').text).toContain('Pause starts: Dec 23, 2026');
    expect(sample('paused').text).toContain('Plan starts again: Feb 23, 2027');
    for (const template of ['trial_ended', 'cancel_scheduled', 'paused', 'plan_ended', 'grace_ending', 'payment_failed'] as const) {
      expect(sample(template).text).toContain('Nothing is deleted');
    }
  });

  it('the invite names the person, the organization and the last day', () => {
    const email = sample('invitation');
    expect(email.text).toContain('Maya Chen invited you to work with Northwind Robotics on KitStak.');
    expect(email.text).toContain('This invite works until Dec 7, 2026.');
    expect(email.text).toContain('http://localhost:3300/invite/inv_sample');
  });
});

describe('safety', () => {
  it('escapes names in the HTML, so a name can never inject markup', () => {
    const email = renderEmail('invitation', {
      ...SAMPLE_EMAIL_PAYLOADS.invitation,
      orgName: '<script>alert(1)</script> & Sons',
      inviterName: 'Eve "<b>" O\'Neil',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<b>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Sons');
    expect(email.text).toContain('<script>alert(1)</script> & Sons');
  });

  it('keeps the subject on one line, so a name can never add a mail header', () => {
    const email = renderEmail('invitation', { ...SAMPLE_EMAIL_PAYLOADS.invitation, inviterName: 'Eve\r\nBcc: all@evil.example' });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(oneLine('a\r\nb\tc')).toBe('a b c');
  });

  it('never puts a link that is not http or https behind a button', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('https://kitstak.app/billing')).toBe('https://kitstak.app/billing');
    const email = renderEmail('invitation', { ...SAMPLE_EMAIL_PAYLOADS.invitation, acceptUrl: 'javascript:alert(1)' });
    expect(email.html).not.toContain('javascript:');
    expect(email.html).not.toContain('href=');
    expect(() => renderEmail('welcome', { ...SAMPLE_EMAIL_PAYLOADS.welcome, portalUrl: 'javascript:alert(1)' })).toThrow(EmailPayloadError);
  });

  it('refuses a payload with a missing value instead of sending half an email', () => {
    expect(() => renderEmail('receipt', { ...SAMPLE_EMAIL_PAYLOADS.receipt, amountPaidCents: undefined as unknown as number })).toThrow(EmailPayloadError);
    expect(() => renderEmail('welcome', { ...SAMPLE_EMAIL_PAYLOADS.welcome, products: [] })).toThrow(EmailPayloadError);
    expect(() => renderEmail('cancel_scheduled', { ...SAMPLE_EMAIL_PAYLOADS.cancel_scheduled, endsAt: 'not a date' })).toThrow(EmailPayloadError);
    // A code that was wiped after sending can never be rendered again.
    expect(() => renderEmail('verify_email', { minutes: 10 } as never)).toThrow(EmailPayloadError);
    expect(() => renderEmail('verify_email', null as never)).toThrow(EmailPayloadError);
  });

  it('knows the template ids and what to write in the activity log', () => {
    expect(isEmailTemplateId('receipt')).toBe(true);
    expect(isEmailTemplateId('newsletter')).toBe(false);
    expect(emailAuditSummary('receipt', 'billing@northwind.example')).toBe('We emailed a receipt to billing@northwind.example.');
    expect(emailAuditSummary('verify_email', 'maya@northwind.example')).toBeNull();
    expect(emailAuditSummary('reset_password', 'maya@northwind.example')).toBeNull();
  });

  it('renders any content with a dark mode block and a hidden preview line', () => {
    const email = renderContent({ subject: 'Hello', preheader: 'Preview line', heading: 'Hello', blocks: [], button: null, footer: 'Footer.' });
    expect(email.html).toContain('prefers-color-scheme: dark');
    expect(email.html).toContain('Preview line');
    expect(email.text).toBe('Hello\n\nFooter.\nKitStak. One account for every KitStak app.\n');
  });
});
