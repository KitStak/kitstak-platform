import { apiRoute, corsPreflight } from '@/server/http/api';
import { countLinkedWork, findLinkedWork } from '@/server/domain';
import { INTEGRATION_TARGET_TYPES, type IntegrationTargetType } from '@/lib/constants';
import { invalid } from '@/server/errors';

export const OPTIONS = corsPreflight();

/**
 * Cross-app lookup (CRM item panel, WMS order page):
 *   GET /api/v1/links?type=crm_item&id=<uuid>      → { target, projects, tasks }
 *   GET /api/v1/links?type=wms_order&ids=a,b,c     → { counts: { [id]: { tasks, projects } } }
 * Uses the caller's session cookie; only the active org's data is returned.
 */
export const GET = apiRoute(
  async ({ ctx, searchParams }) => {
    const type = searchParams.get('type') as IntegrationTargetType | null;
    if (!type || !INTEGRATION_TARGET_TYPES.includes(type)) throw invalid(`type must be one of ${INTEGRATION_TARGET_TYPES.join(', ')}.`);
    const ids = searchParams.get('ids');
    if (ids) return { counts: await countLinkedWork(ctx, type, ids.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200)) };
    const id = searchParams.get('id');
    if (!id) throw invalid('Pass id=<record id> or ids=<comma list>.');
    return findLinkedWork(ctx, type, id);
  },
  { cors: true },
);
