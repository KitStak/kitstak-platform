import { describe, expect, test } from 'vitest';
import { countTyped, invitePlanLine, parseInviteEmails, type SeatFacts } from './invite-model';

const PAID: SeatFacts = { paid: true, limit: 5, used: 2, canManageBilling: true, pulseOnly: false };

describe('parseInviteEmails', () => {
  test('takes several addresses with commas, spaces, semicolons or new lines', () => {
    expect(parseInviteEmails('a@x.co, b@x.co')).toEqual({ ok: true, emails: ['a@x.co', 'b@x.co'] });
    expect(parseInviteEmails('a@x.co;b@x.co\nc@x.co  d@x.co')).toEqual({ ok: true, emails: ['a@x.co', 'b@x.co', 'c@x.co', 'd@x.co'] });
  });

  test('drops doubles and a trailing comma', () => {
    expect(parseInviteEmails('a@x.co, A@X.co,')).toEqual({ ok: true, emails: ['a@x.co'] });
  });

  test('names the address that is wrong', () => {
    expect(parseInviteEmails('a@x.co, bob')).toEqual({ ok: false, message: 'Check this address: bob' });
    expect(parseInviteEmails('bob')).toEqual({ ok: false, message: 'Enter a valid email address.' });
    expect(parseInviteEmails('  ')).toEqual({ ok: false, message: 'Enter an email address.' });
  });

  test('stops at 20 at a time', () => {
    const many = Array.from({ length: 21 }, (_, index) => `p${index}@x.co`).join(',');
    expect(parseInviteEmails(many)).toEqual({ ok: false, message: 'Invite up to 20 people at a time.' });
  });

  test('counts what is typed so far', () => {
    expect(countTyped('')).toBe(0);
    expect(countTyped('a@x.co, b@')).toBe(2);
  });
});

describe('invitePlanLine', () => {
  test('a guest is free', () => {
    expect(invitePlanLine(PAID, 'guest', 1)).toBe('A guest is free. This uses no seat.');
    expect(invitePlanLine(PAID, 'guest', 3)).toBe('Guests are free. This uses no seats.');
  });

  test('a trial has no seat limit', () => {
    expect(invitePlanLine({ ...PAID, paid: false }, 'member', 1)).toBe('No seat limit during your free trial. Seats are counted when you pick a plan.');
  });

  test('open seats are used first and the bill stays the same', () => {
    expect(invitePlanLine(PAID, 'member', 1)).toBe('Uses 1 of your 3 open seats. Your bill stays the same.');
    expect(invitePlanLine({ ...PAID, used: 4 }, 'viewer', 0)).toBe('Uses 1 of your 1 open seat. Your bill stays the same.');
  });

  test('with no open seat it says a price comes first', () => {
    expect(invitePlanLine({ ...PAID, used: 5 }, 'member', 1)).toBe('All 5 seats are in use. We show the price and ask before we add 1 seat.');
    expect(invitePlanLine({ ...PAID, limit: 1, used: 1 }, 'admin', 1)).toBe('Your 1 seat is in use. We show the price and ask before we add 1 seat.');
    expect(invitePlanLine({ ...PAID, used: 4 }, 'member', 3)).toBe('You have 1 open seat for 3 people. We show the price and ask before we add 2 seats.');
  });

  test('a person who cannot pay is told who can', () => {
    expect(invitePlanLine({ ...PAID, used: 5, canManageBilling: false }, 'member', 1)).toBe('All 5 seats are in use. An owner or a billing manager can add one.');
  });

  test('Pulse alone covers 5 seats', () => {
    expect(invitePlanLine({ ...PAID, used: 5, pulseOnly: true }, 'member', 1)).toBe('All 5 seats are in use. Pulse covers up to 5 seats.');
  });

  test('no line is longer than 20 words and none has a dash', () => {
    for (const line of [invitePlanLine(PAID, 'member', 1), invitePlanLine({ ...PAID, used: 4 }, 'member', 3), invitePlanLine({ ...PAID, paid: false }, 'member', 1)]) {
      for (const sentence of line.split(/(?<=[.?!])\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
      expect(line).not.toMatch(/[–—]|-{2}/);
    }
  });
});
