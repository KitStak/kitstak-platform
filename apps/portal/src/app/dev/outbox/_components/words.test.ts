import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATE_IDS } from '@kitstak/billing/email-types';
import { TEMPLATE_LABELS, codeIn, outboxTime, statusWords, templateLabel, timeAgo } from './words';

describe('dev outbox words', () => {
  it('has a plain name for every email template', () => {
    expect(Object.keys(TEMPLATE_LABELS).sort()).toEqual([...EMAIL_TEMPLATE_IDS].sort());
    expect(templateLabel('receipt')).toBe('Receipt');
    // A template this page does not know yet still shows, by its id.
    expect(templateLabel('something_new')).toBe('something_new');
  });

  it('reads the 6 digit code from a code email only', () => {
    const text = 'Your code\n\nEnter this code to verify your email.\n\n    482913\n\nIt works for 10 minutes.\n';
    expect(codeIn('verify_email', text)).toBe('482913');
    expect(codeIn('reset_password', text)).toBe('482913');
    // A receipt can hold six digits in a row (an amount, an invoice number). That is not a code.
    expect(codeIn('receipt', 'Invoice 123456')).toBeNull();
    expect(codeIn('verify_email', null)).toBeNull();
    expect(codeIn('verify_email', 'It works for 10 minutes.')).toBeNull();
    // Seven digits is not a code either.
    expect(codeIn('verify_email', 'Ref 1234567 only')).toBeNull();
  });

  it('says when an email arrived, in words', () => {
    const now = new Date('2026-11-23T20:15:00.000Z');
    expect(timeAgo(new Date('2026-11-23T20:14:40.000Z'), now)).toBe('just now');
    expect(timeAgo(new Date('2026-11-23T20:11:00.000Z'), now)).toBe('4 min ago');
    expect(timeAgo(new Date('2026-11-23T17:15:00.000Z'), now)).toBe('3 hr ago');
    expect(timeAgo(new Date('2026-11-20T20:15:00.000Z'), now)).toBe('Nov 20, 2026, 8:15 PM UTC');
    // The test tools can move an email into the future of the wall clock. Show its date then.
    expect(timeAgo(new Date('2026-11-24T20:15:00.000Z'), now)).toBe('Nov 24, 2026, 8:15 PM UTC');
    expect(outboxTime(now)).toBe('Nov 23, 2026, 8:15 PM UTC');
  });

  it('names each status without color alone', () => {
    expect(statusWords('sent')).toEqual({ label: 'Delivered here', tone: 'success' });
    expect(statusWords('queued')).toEqual({ label: 'Waiting', tone: 'info' });
    expect(statusWords('failed')).toEqual({ label: 'Failed', tone: 'danger' });
    expect(statusWords('skipped')).toEqual({ label: 'Skipped', tone: 'neutral' });
  });
});
