import { apiRoute } from '@/server/http/api';
import { listMemberRoles } from '@/server/domain';

/** People and their Pulse roles (admins and up). */
export const GET = apiRoute(async ({ ctx }) => listMemberRoles(ctx));
