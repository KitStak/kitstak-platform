/** Organization-level tools (portal/core): who this server reads, modules, team members. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readShared, type Org, type Sql, type Tenant } from './db.js';
import { json, READ_ONLY } from './util.js';

export interface OrgContext {
  readonly sql: Sql;
  readonly org: Org;
  readonly tenant: Tenant | null;
  readonly modules: readonly string[];
  readonly canReadUsers: boolean;
  readonly canReadEntitlements: boolean;
  readonly includePrivate: boolean;
}

export function registerOrgTools(server: McpServer, ctx: OrgContext): void {
  server.registerTool(
    'whoami',
    {
      title: 'Connection info',
      description:
        'Which KitStak organization this server reads, which apps it can see, and any WMS client narrowing. Read only.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      json({
        organization: ctx.org.name,
        slug: ctx.org.slug,
        apps: ctx.modules,
        wms_clients: ctx.tenant ? (ctx.tenant.clientIds === 'all' ? 'all' : ctx.tenant.clientCodes) : null,
        private_boards_and_projects: ctx.includePrivate ? 'included' : 'hidden',
        access: 'read only',
      }),
  );

  if (!ctx.canReadUsers && !ctx.canReadEntitlements) return;

  server.registerTool(
    'org_overview',
    {
      title: 'Organization overview',
      description:
        'The organization: which KitStak modules it is licensed for, and its team members with their role and title.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () =>
      json(
        await readShared(ctx.sql, async (tx) => ({
          organization: ctx.org.name,
          modules: ctx.canReadEntitlements
            ? await tx`
                SELECT module, status, source, seats, current_period_end FROM core.entitlements
                WHERE org_id = ${ctx.org.id}::uuid ORDER BY module`
            : null,
          members: ctx.canReadUsers
            ? await tx`
                SELECT u.name, u.title, m.role FROM core.member m JOIN core."user" u ON u.id = m.user_id
                WHERE m.organization_id = ${ctx.org.id}::uuid ORDER BY u.name`
            : null,
        })),
      ),
  );
}
