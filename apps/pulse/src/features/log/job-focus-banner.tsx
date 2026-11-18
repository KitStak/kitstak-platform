'use client';
/** The note above the day grid when a "Log work" link asks for a job that has no row on the day. */
import { useEffect, useRef } from 'react';
import { Info, Play } from 'lucide-react';
import { Button } from '@/components/ui';
import { ButtonLink } from '@/components/pulse/button-link';
import { useServerAction } from '@/lib/hooks/use-action';
import { routes } from '@/lib/routes';
import { startJobForDayAction } from '@/server/actions/log';
import { focusNote, type FocusJob } from './job-focus';

export interface JobFocusBannerProps {
  readonly job: FocusJob;
  readonly date: string;
  readonly siteId: string;
  readonly canManage: boolean;
  /** After the job starts: refresh the day and put focus on its row. */
  readonly onStarted: (jobId: string) => Promise<void> | void;
  readonly onGo: (date: string, siteId?: string) => void;
  readonly onDismiss: () => void;
}

export function JobFocusBanner({ job, date, siteId, canManage, onStarted, onGo, onDismiss }: JobFocusBannerProps) {
  const note = focusNote(job, { date, siteId }, canManage);
  const box = useRef<HTMLDivElement>(null);
  // Keyboard first: the fix is one key press away when the page opens from a link.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button, a')?.focus();
  }, []);
  const start = useServerAction(startJobForDayAction, { successMessage: `${job.number ?? job.ref} is active and on the day` });
  async function run() {
    if (!job.id) return;
    const done = await start.run({ jobId: job.id, date });
    if (done) await onStarted(job.id);
  }
  return (
    <div ref={box} data-testid="job-focus-banner" role="status" className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-info-subtle px-4 py-2 text-sm text-info-text">
      <Info aria-hidden className="size-4 shrink-0" />
      <span className="min-w-[12rem] flex-1">{note.text}</span>
      <span className="flex items-center gap-2">
        {note.action === 'start' ? (
          <Button size="sm" leadingIcon={<Play aria-hidden />} loading={start.pending} onClick={() => void run()}>
            {note.actionLabel}
          </Button>
        ) : note.action === 'go_to_start' && job.startDate ? (
          <Button size="sm" variant="secondary" onClick={() => onGo(job.startDate as string)}>
            {note.actionLabel}
          </Button>
        ) : note.action === 'go_to_site' && job.siteId ? (
          <Button size="sm" variant="secondary" onClick={() => onGo(date, job.siteId as string)}>
            {note.actionLabel}
          </Button>
        ) : null}
        {job.id ? (
          <ButtonLink size="sm" variant={note.action === 'open_job' ? 'secondary' : 'tertiary'} href={routes.job(job.number ?? job.id)}>
            {note.action === 'open_job' ? note.actionLabel : 'Open the job'}
          </ButtonLink>
        ) : (
          <ButtonLink size="sm" variant="secondary" href={routes.jobs()}>
            See jobs
          </ButtonLink>
        )}
        <Button size="sm" variant="tertiary" onClick={onDismiss}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}
