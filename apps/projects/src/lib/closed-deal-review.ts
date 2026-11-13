/**
 * Should an open task linked to a closed deal be raised for review? A lost deal: yes, the work may
 * no longer be needed. A won deal: only when the task was due (or, without a due date, created) on
 * or before the close date, i.e. work that was meant to close the deal. Follow-up work planned
 * after the win is normal. With no close date we cannot tell, so the direct link alone counts.
 */
export function closedDealTaskNeedsReview(input: {
  readonly outcome: 'won' | 'lost';
  readonly closeDate: string | null;
  readonly dueDate: string | null;
  readonly createdDay: string | null;
}): boolean {
  if (input.outcome === 'lost') return true;
  if (!input.closeDate) return true;
  const when = input.dueDate ?? input.createdDay;
  return when !== null && when.slice(0, 10) <= input.closeDate;
}
