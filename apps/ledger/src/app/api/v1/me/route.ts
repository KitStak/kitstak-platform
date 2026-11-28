import { apiRoute } from '@/server/http/api';

/** `GET /api/v1/me`: who is signed in, the active org and their Ledger role and rights. */
export const GET = apiRoute(async ({ context, access }) => ({
  user: { id: context.user.id, name: context.user.name, email: context.user.email },
  org: { id: context.org.id, name: context.org.name, slug: context.org.slug },
  role: access.role,
  rights: access.rights,
  seesBalances: access.seesBalances,
}));
