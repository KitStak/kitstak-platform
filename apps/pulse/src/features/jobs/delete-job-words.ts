/**
 * What the delete dialog says will leave the reports: the job's revenue and labor hours, in
 * plain words. Money is left out when the server hid it (`revenueCents` is null for a reader who
 * may not see money), so nothing here can leak a dollar figure.
 */
import { formatHours, formatMoney } from '@/lib/format';

export interface DeleteJobFacts {
  readonly number: string;
  readonly stats?: {
    /** Integer cents, or null when the reader may not see money. */
    readonly revenueCents: number | null;
    readonly hours: string;
  } | null;
}

export function deleteJobWarning(job: DeleteJobFacts): string {
  const revenue = job.stats?.revenueCents ?? null;
  const hours = Number(job.stats?.hours ?? 0);
  const parts: string[] = [];
  if (revenue !== null && revenue !== 0) parts.push(`${formatMoney(revenue, { cents: false })} of revenue`);
  if (Number.isFinite(hours) && hours > 0) {
    const text = formatHours(job.stats?.hours, { maxDigits: 1 });
    parts.push(`${text} labor ${text === '1' ? 'hour' : 'hours'}`);
  }
  if (parts.length === 0) return `${job.number} has no work logged yet. It leaves every list until you restore the job.`;
  const leave = parts.length === 1 ? 'That leaves' : 'They leave';
  return `${job.number} has ${parts.join(' and ')}. ${leave} every report until you restore the job.`;
}
