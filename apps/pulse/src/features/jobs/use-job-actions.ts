'use client';
/**
 * The job level actions shared by the jobs list and the job page: change status, copy, archive,
 * delete and restore. Each one shows an undo toast and refreshes every number that depends on it.
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { JOB_STATUS_LABELS, type JobStatusValue } from '@/lib/constants';
import { qk } from '@/lib/query-keys';
import type { JobDetailDTO, JobListItemDTO } from '@/lib/types';
import type { ActionResult } from '@/server/actions/_action';
import {
  archiveJobAction,
  bulkUpdateJobsAction,
  deleteJobAction,
  duplicateJobAction,
  restoreJobAction,
  setJobStatusAction,
} from '@/server/actions/jobs';

type JobLike = Pick<JobListItemDTO, 'id' | 'number' | 'name' | 'status' | 'archivedAt' | 'ownerId'>;

/** Runs a server action; on failure shows the server's plain message and returns undefined. */
export async function callAction<T>(
  promise: Promise<ActionResult<T>>,
  errorTitle = "Couldn't save your change",
): Promise<T | undefined> {
  try {
    const result = await promise;
    if (!result.ok) {
      toast.error(errorTitle, result.error.message);
      return undefined;
    }
    return result.data;
  } catch {
    toast.error(errorTitle, 'Check your connection and try again.');
    return undefined;
  }
}

export interface JobActionHooks {
  /** Called at once when a job leaves the screen (delete, archive), before the server answers. */
  readonly onHide?: (jobId: string) => void;
  /** Called when a hidden job has to come back (the write failed, or the person pressed Undo). */
  readonly onShow?: (jobId: string) => void;
  /** Called at once with the new status, before the server answers. */
  readonly onStatus?: (jobId: string, status: JobStatusValue | null) => void;
  readonly onCopied?: (copy: JobDetailDTO) => void;
}

export function useJobActions(hooks: JobActionHooks = {}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.jobsRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.profitRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.summaryRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.badges() }),
      queryClient.invalidateQueries({ queryKey: qk.activity() }),
    ]);
    router.refresh();
  }, [queryClient, router]);

  const setStatus = useCallback(
    async (job: JobLike, status: JobStatusValue) => {
      if (job.status === status) return;
      const previous = job.status;
      hooks.onStatus?.(job.id, status);
      setBusy(true);
      const saved = await callAction(
        setJobStatusAction({ jobId: job.id, status }),
        "Couldn't change the status",
      );
      setBusy(false);
      if (!saved) {
        hooks.onStatus?.(job.id, null);
        return;
      }
      await refresh();
      hooks.onStatus?.(job.id, null);
      toast.undo(`${job.number} is now ${JOB_STATUS_LABELS[status].toLowerCase()}`, {
        id: `job-status:${job.id}`,
        onUndo: async () => {
          hooks.onStatus?.(job.id, previous);
          // A finished or cancelled job reopens as active first, then moves to where it was.
          const direct = await setJobStatusAction({ jobId: job.id, status: previous });
          if (!direct.ok) {
            const reopened = await callAction(
              setJobStatusAction({ jobId: job.id, status: 'active' }),
              "Couldn't undo",
            );
            if (reopened && previous !== 'active')
              await callAction(setJobStatusAction({ jobId: job.id, status: previous }), "Couldn't undo");
          }
          await refresh();
          hooks.onStatus?.(job.id, null);
        },
      });
    },
    [hooks, refresh],
  );

  const remove = useCallback(
    async (job: JobLike) => {
      hooks.onHide?.(job.id);
      setBusy(true);
      const result = await deleteJobAction({ jobId: job.id });
      setBusy(false);
      if (!result.ok) {
        hooks.onShow?.(job.id);
        toast.error("Couldn't delete the job", result.error.message);
        return false;
      }
      await refresh();
      toast.undo(`Deleted ${job.number}`, {
        id: `job-delete:${job.id}`,
        description: 'Its entries stay safe and come back with it.',
        onUndo: async () => {
          const restored = await callAction(
            restoreJobAction({ jobId: job.id }),
            "Couldn't bring the job back",
          );
          if (restored) {
            hooks.onShow?.(job.id);
            await refresh();
            toast.success(`${job.number} is back`);
          }
        },
      });
      return true;
    },
    [hooks, refresh],
  );

  const archive = useCallback(
    async (job: JobLike, archived = true) => {
      if (archived) hooks.onHide?.(job.id);
      setBusy(true);
      const saved = await callAction(
        archiveJobAction({ jobId: job.id, archived }),
        archived ? "Couldn't archive the job" : "Couldn't bring the job back",
      );
      setBusy(false);
      if (!saved) {
        if (archived) hooks.onShow?.(job.id);
        return false;
      }
      await refresh();
      toast.undo(archived ? `Archived ${job.number}` : `${job.number} is back in the lists`, {
        id: `job-archive:${job.id}`,
        description: archived ? 'It keeps its numbers and stays in reports. Find it under All.' : undefined,
        onUndo: async () => {
          const undone = await callAction(
            archiveJobAction({ jobId: job.id, archived: !archived }),
            "Couldn't undo",
          );
          if (undone) {
            if (archived) hooks.onShow?.(job.id);
            await refresh();
          }
        },
      });
      return true;
    },
    [hooks, refresh],
  );

  const duplicate = useCallback(
    async (job: JobLike) => {
      setBusy(true);
      const copy = await callAction(
        duplicateJobAction({ jobId: job.id, withPlans: true }),
        "Couldn't copy the job",
      );
      setBusy(false);
      if (!copy) return undefined;
      await refresh();
      hooks.onCopied?.(copy);
      toast.undo(`Copied ${job.number} as ${copy.number}`, {
        id: `job-copy:${copy.id}`,
        description: 'The copy starts as planned, with the same price and plan and no entries.',
        onUndo: async () => {
          const gone = await deleteJobAction({ jobId: copy.id });
          if (!gone.ok) toast.error("Couldn't undo the copy", gone.error.message);
          await refresh();
        },
      });
      return copy;
    },
    [hooks, refresh],
  );

  /** Bulk change with one undo that puts every job back the way it was. */
  const bulk = useCallback(
    async (
      jobs: readonly JobLike[],
      change: { status?: JobStatusValue; ownerId?: string | null; archived?: boolean },
      label: string,
    ) => {
      if (jobs.length === 0) return;
      setBusy(true);
      const result = await callAction(bulkUpdateJobsAction({ jobIds: jobs.map((job) => job.id), ...change }));
      setBusy(false);
      if (!result) return;
      await refresh();
      const failedIds = new Set(result.failed.map((item) => item.jobId));
      const changed = jobs.filter((job) => !failedIds.has(job.id));
      if (result.failed.length > 0) {
        toast.warning(
          `${result.failed.length} of ${jobs.length} jobs could not change`,
          result.failed[0]?.message,
        );
      }
      if (changed.length === 0) return;
      toast.undo(`${label}: ${changed.length} ${changed.length === 1 ? 'job' : 'jobs'}`, {
        id: 'job-bulk',
        onUndo: async () => {
          const groups = new Map<
            string,
            {
              ids: string[];
              change: { status?: JobStatusValue; ownerId?: string | null; archived?: boolean };
            }
          >();
          for (const job of changed) {
            const back =
              change.status !== undefined
                ? { status: job.status }
                : change.ownerId !== undefined
                  ? { ownerId: job.ownerId }
                  : { archived: job.archivedAt !== null };
            const key = JSON.stringify(back);
            const group = groups.get(key) ?? { ids: [], change: back };
            group.ids.push(job.id);
            groups.set(key, group);
          }
          for (const group of groups.values())
            await callAction(bulkUpdateJobsAction({ jobIds: group.ids, ...group.change }), "Couldn't undo");
          await refresh();
        },
      });
    },
    [refresh],
  );

  return { setStatus, remove, archive, duplicate, bulk, busy, refresh } as const;
}

/** The statuses a job may move to from where it is (the server enforces the same list). */
export const STATUS_MOVES: Readonly<Record<JobStatusValue, readonly JobStatusValue[]>> = {
  planned: ['active', 'on_hold', 'completed', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled', 'planned'],
  on_hold: ['active', 'completed', 'cancelled', 'planned'],
  completed: ['active'],
  cancelled: ['planned', 'active'],
};

/** The words on a status move, as an action: "Mark complete", "Put on hold". */
export function statusMoveLabel(from: JobStatusValue, to: JobStatusValue): string {
  if (to === 'active')
    return from === 'planned' ? 'Start the job' : from === 'on_hold' ? 'Resume the job' : 'Reopen the job';
  if (to === 'on_hold') return 'Put on hold';
  if (to === 'completed') return 'Mark complete';
  if (to === 'cancelled') return 'Cancel the job';
  return 'Move back to planned';
}
