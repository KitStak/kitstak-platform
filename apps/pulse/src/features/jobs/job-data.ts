'use client';
/**
 * Reads and refreshes for the job page. Every tab asks for the rows it shows through these
 * hooks; React Query shares one request between tabs that ask for the same rows.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import {
  useCosts,
  useJobDays,
  useMaterialUsage,
  useProduction,
  useRevenue,
  useVasEntries,
} from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { projectJob, type Projection, type ProjectionInput } from '@/lib/profit';
import type { JobDetailDTO, LaborClassDTO, SettingsDTO } from '@/lib/types';
import type { ActionResult } from '@/server/actions/_action';
import { buildProjectionInput } from './job-math';

/** Enough for any real job; the API caps a page at 10,000 rows. */
const ALL = 5000;

export const useJobProduction = (jobId: string) => useProduction({ jobId, limit: ALL });
export const useJobServices = (jobId: string, enabled = true) =>
  useVasEntries({ jobId, limit: ALL }, { enabled });
export const useJobUsage = (jobId: string, enabled = true) =>
  useMaterialUsage({ jobId, limit: ALL }, { enabled });
export const useJobCosts = (jobId: string, enabled = true) =>
  useCosts({ jobId, scope: 'job', limit: ALL }, { enabled });
export const useJobRevenue = (jobId: string, enabled = true) =>
  useRevenue({ jobId, limit: ALL }, { enabled });
export const useJobDaily = (ref: string, enabled = true) => useJobDays(ref, 'day', { enabled });

/** After any write on a job: refresh its rows, its numbers, the lists and the badges. */
export function useRefreshJob(): () => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.streams() }),
      queryClient.invalidateQueries({ queryKey: qk.jobsRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.profitRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.summaryRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.badges() }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]);
    router.refresh();
  }, [queryClient, router]);
}

/**
 * Delete one row with an undo toast. The row disappears at once (`hide`), comes back if the
 * server says no, and comes back again when the person presses Undo.
 */
export function useDeleteWithUndo(refresh: () => Promise<void>) {
  return useCallback(
    async (options: {
      readonly label: string;
      readonly hide: () => void;
      readonly show: () => void;
      readonly remove: () => Promise<ActionResult<unknown>>;
      readonly restore: () => Promise<ActionResult<unknown>>;
    }) => {
      options.hide();
      let result: ActionResult<unknown>;
      try {
        result = await options.remove();
      } catch {
        options.show();
        toast.error("Couldn't delete that", 'Check your connection and try again.');
        return;
      }
      if (!result.ok) {
        options.show();
        toast.error("Couldn't delete that", result.error.message);
        return;
      }
      await refresh();
      options.show();
      toast.undo(`Deleted ${options.label}`, {
        onUndo: async () => {
          const back = await options.restore();
          if (!back.ok) {
            toast.error("Couldn't bring it back", back.error.message);
            return;
          }
          await refresh();
          toast.success(`Brought back ${options.label}`);
        },
      });
    },
    [refresh],
  );
}

export interface JobProjection {
  readonly input: ProjectionInput | null;
  readonly projection: Projection | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly retry: () => void;
}

/**
 * The job's projection, rebuilt in the browser from the same rows the server used, so the plan
 * table can show a full "Projected at finish" column and the what if sliders have a base to move.
 */
export function useJobProjection(
  job: JobDetailDTO,
  today: string,
  settings: SettingsDTO,
  laborClasses: readonly LaborClassDTO[],
): JobProjection {
  const seesMoney = !job.stats.moneyHidden;
  const production = useJobProduction(job.id);
  const services = useJobServices(job.id, seesMoney);
  const usage = useJobUsage(job.id, seesMoney && job.materialMethod === 'actual');
  const days = useJobDaily(job.number, seesMoney && job.kind === 'ongoing');
  const input = useMemo(() => {
    if (!seesMoney || !production.data || !services.data) return null;
    const fallback =
      laborClasses.find((item) => item.id === job.defaultLaborClassId)?.currentLoadedRateCents ??
      settings.defaultLoadedRateCents;
    return buildProjectionInput({
      job,
      production: production.data,
      services: services.data,
      usage: usage.data ?? [],
      days: days.data?.rows ?? [],
      today,
      workingDays: settings.workingDays,
      fallbackRateCents: fallback,
    });
  }, [seesMoney, job, production.data, services.data, usage.data, days.data, today, settings, laborClasses]);
  const projection = useMemo(() => (input ? projectJob(input) : null), [input]);
  return {
    input,
    projection,
    loading: seesMoney && (production.isPending || services.isPending),
    error: production.isError || services.isError,
    retry: () => {
      void production.refetch();
      void services.refetch();
    },
  };
}
