import { apiRoute } from '@/server/http/api';
import { flag, intParam, listOf, oneOf, str, uuidParam } from '@/server/http/params';
import { listJobs } from '@/server/domain';
import { JOB_STATUS_VALUES, JOB_TABS, PULSE_STATUSES } from '@/lib/constants';

/**
 * Jobs with their cached numbers and status reasons (worded for the reader).
 * `?tab=open|all|completed|planned&q=&client=&jobType=&site=&owner=&status=a,b&risk=losing,at_risk&program=1&limit=`. `program=1` keeps jobs a KitStak program feeds.
 * `deleted=1` adds deleted jobs and needs the right to manage jobs (403 without it), like `/api/v1/jobs/deleted`.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listJobs(ctx, {
    tab: oneOf(searchParams, 'tab', JOB_TABS) ?? 'all',
    q: str(searchParams, 'q'),
    clientId: uuidParam(searchParams, 'client'),
    jobTypeId: uuidParam(searchParams, 'jobType'),
    siteId: uuidParam(searchParams, 'site'),
    ownerId: uuidParam(searchParams, 'owner'),
    status: listOf(searchParams, 'status', JOB_STATUS_VALUES),
    risk: listOf(searchParams, 'risk', PULSE_STATUSES),
    includeArchived: flag(searchParams, 'archived'),
    includeDeleted: flag(searchParams, 'deleted'),
    fedByProgram: flag(searchParams, 'program'),
    limit: intParam(searchParams, 'limit', 1000, 5000),
  }),
);
