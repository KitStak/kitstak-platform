import { withApi } from '@/server/api';
import { resolveCrmBoards } from '@/server/services/crm-boards';
import { svc } from '../../_lib/route-helpers';

/** CRM boards the caller can see: one primary per object kind + every deals board. */
export const GET = withApi({ permission: 'board:read' }, (ctx) => resolveCrmBoards(svc(ctx)));
