import { apiRoute } from '@/server/http/api';
import { listOrgPeople } from '@/server/domain';

export const GET = apiRoute(async ({ ctx }) => listOrgPeople(ctx));
