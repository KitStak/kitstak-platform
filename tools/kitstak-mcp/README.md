# KitStak MCP server

Lets Claude look things up in KitStak WMS: customers, orders, inventory, kits and kitting
work orders. **Read only.** One server instance reads one organization's warehouse.

It lives outside the pnpm workspace (`tools/`, its own `package-lock.json`) so it does not
change the root lockfile or trigger any app build or Vercel deploy.

## Tools

| Tool                   | What it answers                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `whoami`               | Which organization and clients this server reads                                                      |
| `list_customers`       | 3PL customers (WMS clients): contacts, billing plan, status                                           |
| `list_warehouses`      | Warehouse buildings                                                                                   |
| `search_orders`        | Orders by status (or `open`), client, warehouse, dates, text; `late_only` for past expected ship date |
| `get_order`            | One order (by code or store order #) with its lines                                                   |
| `order_status_summary` | Order and unit counts by status, optionally per client, with late counts                              |
| `search_products`      | SKUs by SKU, name or barcode; `kits_only`                                                             |
| `get_inventory`        | On hand, allocated, available, damaged, open order qty; per warehouse or per location                 |
| `low_stock`            | Active SKUs at or below reorder point                                                                 |
| `get_kit`              | Kit bill of materials, component availability, how many kits could be built                           |
| `list_work_orders`     | Kitting work orders                                                                                   |

## How it stays safe

- Every tool runs fixed, parameterized SQL in a `READ ONLY` transaction. Claude never sends SQL.
- The warehouse schema comes from `core.wms_tenants` and is validated with the same
  `^wms(_[0-9a-f]{32})?$` rule the platform uses; `search_path` is pinned per transaction
  (`SET LOCAL`), so it is safe on the Supabase transaction pooler.
- It connects as a dedicated role (`sql/readonly-role.sql`) with `SELECT` on that one schema
  only. On startup it refuses any role that can insert, update or delete orders.
- `KITSTAK_MCP_CLIENTS` narrows every tool to some clients.
- No service role key, no Better Auth secret, nothing from the apps' env.

## Setup (once)

1. Create the read-only role in Supabase (SQL editor or psql on the direct connection), with
   the org's schema from `core.wms_tenants` (the platform org is `wms`):

   ```bash
   psql "$DIRECT_URL" -v tenant_schema=wms -v role_password='<strong password>' \
     -f tools/kitstak-mcp/sql/readonly-role.sql
   ```

2. Build:

   ```bash
   cd tools/kitstak-mcp && npm ci && npm run build
   ```

## Connect it to Claude

Claude Desktop (`claude_desktop_config.json`) or any stdio MCP client:

```json
{
  "mcpServers": {
    "kitstak": {
      "command": "node",
      "args": ["C:/path/to/kitstak-platform/tools/kitstak-mcp/dist/index.js"],
      "env": {
        "KITSTAK_MCP_DATABASE_URL": "postgres://kitstak_mcp_ro.<project-ref>:<password>@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
        "KITSTAK_MCP_ORG": "kitstak"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add kitstak \
  -e KITSTAK_MCP_DATABASE_URL='postgres://kitstak_mcp_ro.<project-ref>:<password>@aws-0-us-west-1.pooler.supabase.com:6543/postgres' \
  -e KITSTAK_MCP_ORG=kitstak \
  -- node /path/to/kitstak-platform/tools/kitstak-mcp/dist/index.js
```

## Tests

`npm test` starts the server over stdio and calls every tool. It needs a Postgres with the
WMS and core migrations, `test/fixture.sql`, and the role script applied; see the header of
`test/server.test.ts`. It checks that a second organization's data and other clients never
show up, that search text cannot inject SQL, and that a writable role is refused.

## Later

- Write tools (create orders, adjust inventory) behind explicit confirmation.
- A hosted version inside the WMS app (`/api/mcp`) with Better Auth OAuth, so each user gets
  their own warehouse and client scope instead of one shared read-only role.
- CRM data (accounts, deals).
