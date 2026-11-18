/**
 * KitStak Pulse job profit for a project (Overview "Job profit" strip): the Pulse jobs linked
 * to this project, with health, progress, revenue, cost, profit and margin.
 *
 * Read through @kitstak/pulse-bridge over this app's own database handle (one shared Postgres,
 * no browser call to Pulse). Fails soft: when the organization is not licensed for Pulse, the
 * pulse schema is not installed, or this person has no Pulse role, the answer is
 * `available: false` and the strip is not shown. Money is hidden on the server for people who
 * may not see it in Pulse.
 */
import 'server-only';
import {
  emitBridgeEvent,
  getJobsForRecord,
  pulseAvailability,
  pulseUrls,
  type BridgeExecutor,
  type PulseJobSummary,
  type PulseJobTotals,
} from '@kitstak/pulse-bridge';
import { db, type Executor } from '@/server/db';
import { appUrls } from '@/server/env';
import { orgModuleFlags } from '@/server/entitlements';
import type { DomainContext } from '@/server/domain/_shared';

export interface PulseProfitJob extends PulseJobSummary {
  /** Absolute link to the job in Pulse. */
  readonly url: string;
  readonly logUrl: string;
}

export interface PulseProfit {
  readonly available: boolean;
  readonly reason: 'not_licensed' | 'not_installed' | 'no_access' | null;
  readonly pulseUrl: string;
  readonly moneyHidden: boolean;
  readonly canLog: boolean;
  readonly canManageJobs: boolean;
  readonly jobs: readonly PulseProfitJob[];
  readonly totals: PulseJobTotals | null;
  /** "Track profit for this project" deep link. Null when this person cannot add Pulse jobs. */
  readonly createJobUrl: string | null;
}

const bridgeDb = (executor: Executor = db) => executor as unknown as BridgeExecutor;

function off(reason: PulseProfit['reason']): PulseProfit {
  return { available: false, reason, pulseUrl: appUrls().pulse, moneyHidden: true, canLog: false, canManageJobs: false, jobs: [], totals: null, createJobUrl: null };
}

export async function pulseProfit(ctx: DomainContext, project: { readonly id: string; readonly name: string }): Promise<PulseProfit> {
  try {
    const flags = await orgModuleFlags(ctx.orgId);
    if (!flags.pulse) return off('not_licensed');
    if (!(await pulseAvailability(bridgeDb())).installed) return off('not_installed');
    const result = await getJobsForRecord(bridgeDb(), { orgId: ctx.orgId, userId: ctx.userId }, { type: 'pm_project', id: project.id }, { limit: 12 });
    if (!result.available) return off(result.reason);
    const urls = pulseUrls(appUrls().pulse);
    return {
      available: true,
      reason: null,
      pulseUrl: appUrls().pulse,
      moneyHidden: result.moneyHidden,
      canLog: result.access.canLog,
      canManageJobs: result.access.canManageJobs,
      jobs: result.jobs.map((job) => ({ ...job, url: urls.path(job.path), logUrl: urls.log(job.number) })),
      totals: result.totals,
      createJobUrl: result.access.canManageJobs ? urls.newJobFromProject(project.id, project.name) : null,
    };
  } catch {
    return off('not_installed');
  }
}

/**
 * Tells Pulse that time was logged on a project, so a job that counts this project's time as
 * labor hours refreshes on its next page load. Fire and forget: never throws, and does nothing
 * when Pulse is not installed. Safe inside a caller's transaction (it uses a savepoint).
 */
export async function notifyPulseOfTime(executor: Executor, orgId: string, projectId: string): Promise<void> {
  try {
    await emitBridgeEvent(bridgeDb(executor), { orgId }, { kind: 'pm_time_logged', targetId: projectId });
  } catch {
    // Pulse is away: nothing to tell.
  }
}
