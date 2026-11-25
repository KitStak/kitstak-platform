import { describe, expect, it } from 'vitest';
import { seatLimitKind } from './seat-limit-link';

describe('seatLimitKind', () => {
  it('recognizes the seat sentence a person who can manage billing gets', () => {
    expect(seatLimitKind('All 5 seats are in use. Add a seat in Billing, then invite again.')).toBe('seats');
    expect(seatLimitKind('All 1 seat is in use. Add a seat in Billing, then invite again.')).toBe('seats');
  });

  it('recognizes the sentence for a member, which already names who to ask', () => {
    expect(seatLimitKind('All 5 seats are in use. Ask Maya Chen to add one.')).toBe('ask');
  });

  it('recognizes the Pulse seat rule', () => {
    expect(seatLimitKind('Pulse covers up to 5 seats. For a bigger team, talk to us.')).toBe('pulse');
  });

  it('ignores every other message', () => {
    expect(seatLimitKind('This person is already a member')).toBeNull();
    expect(seatLimitKind('1 not sent: You cannot invite people with this role')).toBeNull();
    expect(seatLimitKind(null)).toBeNull();
    expect(seatLimitKind('')).toBeNull();
  });

  it('still finds the sentence inside a longer error line', () => {
    expect(seatLimitKind('2 not sent: All 5 seats are in use. Add a seat in Billing, then invite again.')).toBe('seats');
  });
});
