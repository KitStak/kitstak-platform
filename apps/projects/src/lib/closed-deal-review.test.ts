import { describe, expect, it } from 'vitest';
import { closedDealTaskNeedsReview } from './closed-deal-review';

describe('closedDealTaskNeedsReview', () => {
  it('leaves follow-up work after a win alone (FRA-14 Phase 3 proposal, due after the close)', () => {
    expect(closedDealTaskNeedsReview({ outcome: 'won', closeDate: '2026-09-08', dueDate: '2026-12-14', createdDay: '2026-10-17' })).toBe(false);
  });
  it('flags work that was due on or before a won close date', () => {
    expect(closedDealTaskNeedsReview({ outcome: 'won', closeDate: '2027-04-18', dueDate: '2026-11-16', createdDay: '2026-11-06' })).toBe(true);
    expect(closedDealTaskNeedsReview({ outcome: 'won', closeDate: '2026-09-08', dueDate: '2026-09-08', createdDay: '2026-08-01' })).toBe(true);
  });
  it('uses the created day when there is no due date', () => {
    expect(closedDealTaskNeedsReview({ outcome: 'won', closeDate: '2026-09-08', dueDate: null, createdDay: '2026-10-01' })).toBe(false);
    expect(closedDealTaskNeedsReview({ outcome: 'won', closeDate: '2026-09-08', dueDate: null, createdDay: '2026-09-01' })).toBe(true);
  });
  it('always flags open work on a lost deal, and a won deal without a close date', () => {
    expect(closedDealTaskNeedsReview({ outcome: 'lost', closeDate: '2026-09-01', dueDate: '2026-12-01', createdDay: null })).toBe(true);
    expect(closedDealTaskNeedsReview({ outcome: 'won', closeDate: null, dueDate: '2026-12-01', createdDay: null })).toBe(true);
  });
});
