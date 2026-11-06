import { withApi } from '@/server/api';
import { apiTokenListQuerySchema, createApiTokenSchema } from '@/server/services/admin-contracts';
import { createApiToken, listApiTokens } from '@/server/services/admin-security';
import { created, svc } from '../../_lib/route-helpers';

export const GET = withApi({ permission: 'api_token:manage', query: apiTokenListQuerySchema }, (ctx) =>
  listApiTokens(svc(ctx), ctx.query.scope),
);

/** Returns the raw token exactly once; only its SHA-256 hash is stored. */
export const POST = withApi(
  {
    permission: 'api_token:manage',
    rateLimit: 'auth',
    body: createApiTokenSchema,
    audit: {
      action: 'api_token.created',
      target: (ctx) => ({ type: 'api_token', id: (ctx.data as { id: string }).id }),
      metadata: (ctx) => {
        const body = ctx.body as { name: string; scopes: string[]; expiresInDays: number | null };
        return { name: body.name, scopes: body.scopes, expiresInDays: body.expiresInDays };
      },
    },
  },
  async (ctx) => created(await createApiToken(svc(ctx), ctx.body)),
);
