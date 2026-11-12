/**
 * Job progress-bar tone (critic R5): a healthy job reads green, never brand red. Amber for an
 * open pick short; red only for an overdue or cancelled job. PURE.
 */
export type JobProgressTone = 'success' | 'warning' | 'danger';

export function progressTone(input: {
  readonly percent: number;
  readonly status: string;
  readonly hasPickShort: boolean;
  readonly overdue: boolean;
}): JobProgressTone {
  if (input.status === 'Cancelled') return 'danger';
  if (input.percent >= 100 || input.status === 'Completed') return input.hasPickShort ? 'warning' : 'success';
  if (input.overdue) return 'danger';
  if (input.hasPickShort) return 'warning';
  return 'success';
}
