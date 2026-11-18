#!/usr/bin/env node
/**
 * KitStak MCP server (stdio). Read-only access to one organization's KitStak data: WMS,
 * CRM, Projects and org info, each only when the database role was granted it.
 * Logs go to stderr only: stdout carries the MCP protocol.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { assertReadOnlyRole, canRead, canReadUserNames, connect, resolveOrg, resolveTenant } from './db.js';
import { registerCrmTools } from './tools-crm.js';
import { registerOrgTools } from './tools-org.js';
import { registerProjectsTools } from './tools-projects.js';
import { registerWmsTools } from './tools-wms.js';

export const VERSION = '0.2.0';

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = connect(config);
  const org = await resolveOrg(sql, config);
  const tenant = await resolveTenant(sql, org, config);
  const [crm, projects, canReadUsers, canReadEntitlements] = await Promise.all([
    Promise.all(
      ['crm.boards', 'crm.workspaces', 'crm.groups', 'crm.columns', 'crm.items'].map((t) => canRead(sql, t)),
    ).then((r) => r.every(Boolean)),
    Promise.all(['pm.projects', 'pm.tasks', 'pm.statuses'].map((t) => canRead(sql, t))).then((r) =>
      r.every(Boolean),
    ),
    canReadUserNames(sql),
    canRead(sql, 'core.entitlements'),
  ]);
  const modules = [tenant && 'wms', crm && 'crm', projects && 'projects'].filter((m): m is string => !!m);
  if (modules.length === 0) {
    throw new Error(`This role cannot read any KitStak app for "${org.slug}". Run sql/readonly-role.sql.`);
  }
  const role = await assertReadOnlyRole(
    sql,
    [
      'core.organization',
      'core.entitlements',
      ...(tenant ? [`${tenant.schema}.shipment_orders`, `${tenant.schema}.inventory`] : []),
      'crm.items',
      'crm.boards',
      'pm.tasks',
      'pm.projects',
    ],
    config.allowWriteRole,
  );

  const server = new McpServer(
    { name: 'kitstak', version: VERSION },
    {
      instructions:
        `Read-only access to KitStak for ${org.name}: ${modules.join(', ')}. ` +
        'WMS tools (wms_*) cover the warehouse: 3PL customers, orders, inventory, kits and work orders. ' +
        'CRM tools (crm_*) cover boards of leads, contacts, accounts and deals. ' +
        'Projects tools (projects_*) cover projects and tasks. Nothing here can create or change data.',
    },
  );
  const base = {
    sql,
    org,
    defaultLimit: config.defaultLimit,
    includePrivate: config.includePrivate,
    canReadUsers,
  };
  registerOrgTools(server, { ...base, tenant, modules, canReadEntitlements });
  if (tenant) registerWmsTools(server, { sql, tenant, defaultLimit: config.defaultLimit });
  if (crm) registerCrmTools(server, base);
  if (projects) registerProjectsTools(server, base);

  const shutdown = async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  console.error(
    `kitstak-mcp ${VERSION}: ${org.name} (${org.slug}), role ${role}, apps ${modules.join(',')}` +
      (tenant && tenant.clientIds !== 'all' ? `, WMS clients ${tenant.clientCodes.join(',')}` : '') +
      ', read only',
  );
}

main().catch((error: unknown) => {
  console.error(`kitstak-mcp failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
