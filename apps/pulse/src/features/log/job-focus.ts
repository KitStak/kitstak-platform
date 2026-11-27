/**
 * What Log work says when a link asks for a job (`/log?job=J-1024`, from CRM, WMS or a job page) and
 * that job has no row on the day. No React here, so the rules are tested on their own.
 */
import type { JobStatusValue } from '@/lib/constants';
import { JOB_STATUS_LABELS } from '@/lib/constants';
import { shortDate } from '@/lib/profit';

/** The job a link asked for, as the server found it. `null` fields mean the job was not found. */
export interface FocusJob {
  readonly ref: string;
  readonly id: string | null;
  readonly number: string | null;
  readonly name: string | null;
  readonly status: JobStatusValue | null;
  readonly siteId: string | null;
  readonly siteName: string | null;
  readonly startDate: string | null;
}

export type FocusAction = 'start' | 'go_to_start' | 'go_to_site' | 'open_job' | 'none';

export interface FocusNote {
  readonly text: string;
  /** The main button, when there is one the person may press. */
  readonly action: FocusAction;
  readonly actionLabel: string | null;
}

/** Why the job is not on this day, and the one thing that fixes it. `canManage` is `job:manage`. */
export function focusNote(job: FocusJob, day: { readonly date: string; readonly siteId: string }, canManage: boolean): FocusNote {
  if (!job.id || !job.status) return { text: `Pulse has no job called ${job.ref}. Check the number, or find the job on the Jobs page.`, action: 'none', actionLabel: null };
  const label = `${job.number ?? job.ref}${job.name ? `, ${job.name},` : ''}`;
  if (job.siteId && job.siteId !== day.siteId) return { text: `${label} is done at ${job.siteName ?? 'another site'}, not this one.`, action: 'go_to_site', actionLabel: `Go to ${job.siteName ?? 'that site'}` };
  if (job.status === 'completed' || job.status === 'cancelled')
    return { text: `${label} is ${JOB_STATUS_LABELS[job.status].toLowerCase()}, so it is not on the day. Reopen it on the job page to log more work.`, action: 'open_job', actionLabel: 'Open the job' };
  const later = job.startDate !== null && job.startDate > day.date;
  if (job.status === 'active' && later)
    return canManage
      ? { text: `${label} starts on ${shortDate(job.startDate as string)}, so it is not on this day yet. Start it today to log work now.`, action: 'start', actionLabel: 'Start it today' }
      : { text: `${label} starts on ${shortDate(job.startDate as string)}, so it is not on this day yet.`, action: 'go_to_start', actionLabel: `Go to ${shortDate(job.startDate as string)}` };
  if (job.status === 'active') return { text: `${label} is not on this day.`, action: 'none', actionLabel: null };
  const state = JOB_STATUS_LABELS[job.status].toLowerCase();
  return canManage
    ? { text: `${label} is ${state}, so it is not on the day yet. Start the job to log work on it.`, action: 'start', actionLabel: 'Start the job and log work' }
    : { text: `${label} is ${state}, so it is not on the day yet. Ask a manager to start the job, then log work on it.`, action: 'none', actionLabel: null };
}
