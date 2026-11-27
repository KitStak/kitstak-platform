/**
 * Links from a Pulse client to its CRM account and its WMS client. Fail soft: when the sibling
 * app is not installed, not licensed, or the record is gone, the link is simply left out.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { scoped } from '@/server/db/scope';
import { rows, type DomainContext } from '@/server/domain';
import { siblingDb, tableExists, type IntegrationAvailability } from '@/server/integrations';
import type { ClientDTO } from '@/lib/types';

export interface SiblingLink {
  readonly app: 'crm' | 'wms';
  readonly label: string;
  /** Path inside the sibling app. The page adds the app's host. */
  readonly path: string;
}

export const clientSiblingLinks = scoped(async function clientSiblingLinks(ctx: DomainContext, client: Pick<ClientDTO, 'crmAccountItemId' | 'coreCustomerId'>, available: IntegrationAvailability): Promise<SiblingLink[]> {
  const links: SiblingLink[] = [];
  if (available.crm && client.crmAccountItemId) {
    try {
      if (await tableExists('crm.items')) {
        const [item] = await rows<{ board_id: string }>(siblingDb, sql`SELECT board_id FROM crm.items WHERE id = ${client.crmAccountItemId} AND org_id = ${ctx.orgId} AND deleted_at IS NULL`);
        if (item?.board_id) links.push({ app: 'crm', label: 'Open the CRM account', path: `/${ctx.orgSlug}/boards/${item.board_id}?item=${client.crmAccountItemId}` });
      }
    } catch {
      // CRM is away: no link.
    }
  }
  if (available.wms && client.coreCustomerId) links.push({ app: 'wms', label: 'Open the WMS client', path: `/clients/${client.coreCustomerId}` });
  return links;
});
