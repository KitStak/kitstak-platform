import { apiRoute } from '@/server/http/api';
import { oneOf } from '@/server/http/params';
import { listDeviceLinks } from '@/server/domain';

/** Device links for shared screens. `?kind=kiosk|wall`. Never returns a secret. */
export const GET = apiRoute(async ({ ctx, searchParams }) =>
  listDeviceLinks(ctx, { kind: oneOf(searchParams, 'kind', ['kiosk', 'wall'] as const) }),
);
