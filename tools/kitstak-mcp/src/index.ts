#!/usr/bin/env node
/**
 * KitStak MCP server (stdio). Read-only access to one organization's WMS warehouse.
 * Logs go to stderr only: stdout carries the MCP protocol.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { assertReadOnlyRole, connect, resolveTenant } from './db.js';
import { registerTools } from './tools.js';

export const VERSION = '0.1.0';

async function main(): Promise<void> {
  const config = loadConfig();
  const sql = connect(config);
  const tenant = await resolveTenant(sql, config);
  const role = await assertReadOnlyRole(sql, tenant, config.allowWriteRole);

  const server = new McpServer(
    { name: 'kitstak', version: VERSION },
    {
      instructions:
        `Read-only access to the KitStak WMS for ${tenant.orgName}. ` +
        'Tools look up customers (3PL clients), orders, inventory, kits and kitting work orders. ' +
        'Nothing here can create or change data.',
    },
  );
  registerTools(server, { sql, tenant, defaultLimit: config.defaultLimit });

  const shutdown = async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(new StdioServerTransport());
  console.error(
    `kitstak-mcp ${VERSION}: ${tenant.orgName} (${tenant.orgSlug}), role ${role}, clients ${
      tenant.clientIds === 'all' ? 'all' : tenant.clientCodes.join(',')
    }, read only`,
  );
}

main().catch((error: unknown) => {
  console.error(`kitstak-mcp failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
