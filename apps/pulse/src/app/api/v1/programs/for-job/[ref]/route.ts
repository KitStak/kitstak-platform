import { apiRoute } from '@/server/http/api';
import { programForJob } from '@/server/domain';

/** The program a job holds (`JobProgramRefDTO`), or `null`: for the job page redirect and banner. `ref` is a job number or id. */
export const GET = apiRoute<{ ref: string }>(async ({ ctx, params }) => programForJob(ctx, decodeURIComponent(params.ref)));
