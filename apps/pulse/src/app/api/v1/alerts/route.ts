import { apiRoute } from '@/server/http/api';
import { intParam, oneOf, str, uuidParam } from '@/server/http/params';
import { listAlerts } from '@/server/domain';
import { ALERT_ENTITY_TYPES, ALERT_STATUSES } from '@/lib/constants';

/** The alert inbox, worst first. `?status=open|snoozed|resolved|dismissed|all&entityType=&entityId=&assignedTo=&limit=`. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listAlerts(ctx, {
    status: oneOf(searchParams, 'status', [...ALERT_STATUSES, 'all'] as const) ?? 'open',
    entityType: oneOf(searchParams, 'entityType', ALERT_ENTITY_TYPES),
    entityId: str(searchParams, 'entityId'),
    assignedTo: uuidParam(searchParams, 'assignedTo'),
    limit: intParam(searchParams, 'limit', 200, 1000),
  }),
);
