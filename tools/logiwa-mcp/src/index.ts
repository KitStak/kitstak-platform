#!/usr/bin/env node
/**
 * Logiwa iO MCP server (stdio). Read-only access to Logiwa iO: clients, warehouses, shipment
 * orders, inventory, products, purchase orders and shipping/receiving history.
 * Logs go to stderr only: stdout carries the MCP protocol.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LogiwaClient } from './client.js';
import { loadConfig } from './config.js';
import { registerTools } from './tools.js';

export const VERSION = '0.1.0';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new LogiwaClient(config);
  await client.verify();

  const server = new McpServer(
    { name: 'logiwa', version: VERSION },
    {
      instructions:
        'Read-only access to Logiwa iO, the warehouse system. Use logiwa_list_clients to find a client identifier, then ' +
        'filter orders (logiwa_search_orders, logiwa_get_order, logiwa_order_status_summary), stock (logiwa_list_inventory, ' +
        'logiwa_inventory_totals, logiwa_available_to_promise), products, purchase orders and shipping or receiving history. ' +
        'Lists are paged; say so when an answer is based on one page. Nothing here can create or change data.',
    },
  );
  registerTools(server, client, config);

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  await server.connect(new StdioServerTransport());
  console.error(
    `logiwa-mcp ${VERSION}: ${new URL(config.baseUrl).host}, ${config.auth.kind === 'password' ? 'API user' : 'token'}` +
      (config.clients.length ? `, clients ${config.clients.join(',')}` : '') +
      ', read only',
  );
}

main().catch((error: unknown) => {
  console.error(`logiwa-mcp failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
