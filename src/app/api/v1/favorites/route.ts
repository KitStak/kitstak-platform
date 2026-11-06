import { withApi } from '@/server/api';
import {
  addFavorite,
  entityRefSchema,
  listFavorites,
  removeFavorite,
  reorderFavorite,
  reorderFavoriteSchema,
} from '@/server/services/personal';
import { svc } from '../_lib/route-helpers';

export const GET = withApi({ permission: 'org:read' }, (ctx) => listFavorites(svc(ctx)));

export const POST = withApi({ permission: 'org:read', body: entityRefSchema }, (ctx) =>
  addFavorite(svc(ctx), ctx.body),
);

export const PATCH = withApi({ permission: 'org:read', body: reorderFavoriteSchema }, (ctx) =>
  reorderFavorite(svc(ctx), ctx.body),
);

export const DELETE = withApi({ permission: 'org:read', body: entityRefSchema }, (ctx) =>
  removeFavorite(svc(ctx), ctx.body),
);
