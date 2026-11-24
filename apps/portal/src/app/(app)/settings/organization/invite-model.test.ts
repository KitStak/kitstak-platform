import { describe, expect, test } from 'vitest';
import { countTyped, findOnTeam, inviteErrorWords, invitePlanLine, notInvitedYet, parseInviteEmails, seatOfferPayLine, type SeatFacts } from './invite-model';

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

describe('invite answers in our words', () => {
  const TEAM = [
    { email: 'sam@alderstreet.example', name: 'Sam Rivera' },
    { email: 'Drew@AlderStreet.example', name: '' },
  ];

  test('a teammate is found whatever the letter case', () => {
    expect(findOnTeam(' SAM@alderstreet.example ', TEAM)?.name).toBe('Sam Rivera');
    expect(findOnTeam('new@alderstreet.example', TEAM)).toBeNull();
  });

  test('"User is already a member of this organization" becomes a sentence with the first name', () => {
    expect(inviteErrorWords({ code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', message: 'User is already a member of this organization' }, 'sam@alderstreet.example', TEAM)).toBe(
      'Sam is already on your team.',
    );
    // No name on file: the address stands in. No code: the raw sentence is still recognized.
    expect(inviteErrorWords({ message: 'User is already a member of this organization' }, 'drew@alderstreet.example', TEAM)).toBe('Drew@AlderStreet.example is already on your team.');
    expect(inviteErrorWords({ code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION' }, 'ghost@alderstreet.example', TEAM)).toBe('ghost@alderstreet.example is already on your team.');
  });

  test('an open invite and an unknown answer', () => {
    expect(inviteErrorWords({ code: 'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION' }, 'ana@x.co', TEAM)).toBe('ana@x.co already has an invite. It is in the list below.');
    expect(inviteErrorWords({ message: 'Verify your email first.' }, 'ana@x.co', TEAM)).toBe('Verify your email first.');
    expect(inviteErrorWords({}, 'ana@x.co', TEAM)).toBe('We could not send the invite. Try again.');
  });

  test('the people who still wait for a seat are named', () => {
    expect(notInvitedYet(['ana@x.co'])).toBe('1 person was not invited yet: ana@x.co.');
    expect(notInvitedYet(['ana@x.co', 'bo@x.co'])).toBe('2 people were not invited yet: ana@x.co and bo@x.co.');
    expect(notInvitedYet(['ana@x.co', 'bo@x.co', 'cy@x.co'])).toBe('3 people were not invited yet: ana@x.co, bo@x.co and cy@x.co.');
  });
});

describe('seatOfferPayLine: the amount due today comes with its real reason (review round 4)', () => {
  test('credit pays part of it: both amounts are named and they add up', () => {
    // The case from the review: 22 days cost $24.05 and $22.96 of credit was used, so $1.09 is due.
    const line = seatOfferPayLine({ dueTodayCents: 109, proratedCents: 2405, creditAppliedCents: 2296 });
    expect(line).toBe('You pay $1.09 today: $24.05 for the days left, less $22.96 credit.');
    expect(2405 - 2296).toBe(109);
  });

  test('no credit: the plain sentence', () => {
    expect(seatOfferPayLine({ dueTodayCents: 1450, proratedCents: 1450, creditAppliedCents: 0 })).toBe('You pay $14.50 today for the days left.');
  });

  test('credit pays all of it', () => {
    expect(seatOfferPayLine({ dueTodayCents: 0, proratedCents: 1450, creditAppliedCents: 1450 })).toBe(
      'You pay $0.00 today. Your credit pays the $14.50 for the days left.',
    );
  });

  test('nothing to pay and nothing used (a free trial)', () => {
    expect(seatOfferPayLine({ dueTodayCents: 0, proratedCents: 0, creditAppliedCents: 0 })).toBe('You pay $0.00 today.');
  });

  test('numbers that would not add up are never put in one sentence: the server sentence is used', () => {
    // Sales tax on top: 14.50 for the days left plus 1.20 tax.
    const withTax = seatOfferPayLine({
      dueTodayCents: 1570,
      proratedCents: 1450,
      creditAppliedCents: 0,
      dueTodayNote: '$14.50 for the 15 days left in this period. Plus $1.20 sales tax.',
    });
    expect(withTax).toBe('You pay $15.70 today. $14.50 for the 15 days left in this period. Plus $1.20 sales tax.');
    expect(seatOfferPayLine({ dueTodayCents: 500, proratedCents: 1450, creditAppliedCents: 100 })).toBe('You pay $5.00 today.');
  });

  test('never the old sentence that named the wrong reason', () => {
    expect(seatOfferPayLine({ dueTodayCents: 109, proratedCents: 2405, creditAppliedCents: 2296 })).not.toMatch(/\$1\.09 today for the days left/);
  });
});
