/**
 * The program a job holds, for the job page (docs/programs/PULSE_PROGRAMS_SPEC.md 5.3): the
 * redirect to the program page, the banner, and the price from the card in force. Fail soft:
 * when Projects cannot be read the job page shows as a normal job.
 */
import 'server-only';
import { scoped } from '@/server/db/scope';
import { programForJob, type DomainContext } from '@/server/domain';
import { programCardFacts, programVariants } from '@/server/integrations/programs';
import { logSoftFail } from '@/server/integrations/log';
import type { JobProgramRefDTO } from '@/lib/program-types';
import type { JobDetailDTO } from '@/lib/types';
import { programJobPrice, type JobProgramPageDTO } from '../program-job';

/**
 * The program a job holds. Null for a job that holds no program (a normal job, or one only fed
 * by builds billed one by one) and when programs are not shown here. Fail soft.
 */
export const jobProgramRef = scoped(async function jobProgramRef(ctx: DomainContext, job: Pick<JobDetailDTO, 'number' | 'program'>): Promise<JobProgramRefDTO | null> {
  // Only a `pm_program` link makes a program job.
  if (job.program?.kind !== 'program') return null;
  try {
    return await programForJob(ctx, job.number);
  } catch (error) {
    logSoftFail(ctx.orgId, 'jobs.jobProgramRef', error);
    return null;
  }
});

/** The program of a program job with today's card price ("Varies by variant" or one price). The price is null without money rights. */
export const jobProgramPage = scoped(async function jobProgramPage(ctx: DomainContext, program: JobProgramRefDTO, options: { readonly seesMoney: boolean; readonly today: string }): Promise<JobProgramPageDTO> {
  if (!options.seesMoney || program.deleted) return { program, price: null };
  try {
    const [card, variants] = await Promise.all([programCardFacts(ctx, program.programId), programVariants(ctx, [program.programId])]);
    if (!card) return { program, price: null };
    const live = [...variants.values()].filter((variant) => variant.programId === program.programId && !variant.deleted && !variant.retired).map((variant) => variant.id);
    return { program, price: programJobPrice(card.versions, live, options.today) };
  } catch (error) {
    logSoftFail(ctx.orgId, 'jobs.jobProgramPrice', error);
    return { program, price: null };
  }
});
