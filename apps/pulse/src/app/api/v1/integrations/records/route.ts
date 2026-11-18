import { apiRoute } from '@/server/http/api';
import { str } from '@/server/http/params';
import { requirePulse } from '@/server/domain';
import { invalid } from '@/server/errors';
import { resolveRecords, type RecordTarget } from '@/server/integrations';
import { LINK_TARGET_TYPES, type LinkTargetType } from '@/lib/constants';

/**
 * Linked sibling records as they are right now: `?targets=crm_deal:<id>,wms_work_order:<id>`
 * (up to 50). An app that cannot be read answers `state: "offline"`, a deleted record `gone`.
 */
export const GET = apiRoute(async ({ ctx, searchParams }) => {
  await requirePulse(ctx, 'pulse:read');
  const raw = str(searchParams, 'targets');
  if (!raw) return [];
  const targets: RecordTarget[] = [];
  for (const part of raw.split(',').slice(0, 50)) {
    const cut = part.indexOf(':');
    const type = part.slice(0, cut) as LinkTargetType;
    const id = part.slice(cut + 1).trim();
    if (cut < 1 || !(LINK_TARGET_TYPES as readonly string[]).includes(type) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw invalid('Each target is a record type and an id, like crm_deal:1234.');
    targets.push({ type, id });
  }
  return resolveRecords(ctx, targets);
});
