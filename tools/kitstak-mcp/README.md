# KitStak MCP server

Lets Claude look things up across KitStak: the WMS (customers, orders, inventory, kits,
work orders), the CRM (boards of leads, contacts, accounts, deals), Projects (projects and
tasks) and the organization itself (modules, team). **Read only.** One server instance reads
one organization.

It lives outside the pnpm workspace (`tools/`, its own `package-lock.json`) so it does not
change the root lockfile or trigger any app build or Vercel deploy.

Books, People and Pulse are not covered: Books and People are not in the repo yet, and
Pulse only exists on its own unmerged branch. They can be added once they land on main.

## Tools

The server offers a module's tools only when its database role can read that module.

| Tool                       | What it answers                                                                   |
| -------------------------- | --------------------------------------------------------------------------------- |
| `whoami`                   | Which organization and apps this server reads                                     |
| `org_overview`             | Licensed modules and team members (name, title, role)                             |
| `wms_list_customers`       | 3PL customers (WMS clients): contacts, billing plan, status                       |
| `wms_list_warehouses`      | Warehouse buildings                                                               |
| `wms_search_orders`        | Orders by status (or `open`), client, warehouse, dates, text; `late_only`         |
| `wms_get_order`            | One order (by code or store order #) with its lines                               |
| `wms_order_status_summary` | Order and unit counts by status, optionally per client, with late counts          |
| `wms_search_products`      | SKUs by SKU, name or barcode; `kits_only`                                         |
| `wms_get_inventory`        | On hand, allocated, available, damaged, open order qty; per warehouse or location |
| `wms_low_stock`            | Active SKUs at or below reorder point                                             |
| `wms_get_kit`              | Kit bill of materials, component availability, how many kits could be built       |
| `wms_list_work_orders`     | Kitting work orders                                                               |
| `crm_list_boards`          | CRM boards with kind, workspace and item count                                    |
| `crm_search_items`         | Records by text, board, kind or group, with readable field values                 |
| `crm_get_item`             | One record with fields, subitems, linked records and latest updates               |
| `projects_list`            | Projects with status, health, owner, dates and task counts                        |
| `projects_search_tasks`    | Tasks by project, status, assignee, due date, overdue or text                     |
| `projects_get_task`        | One task (e.g. `OPS-42`) with description, subtasks and comments                  |

Private and shareable CRM boards, closed CRM workspaces and private projects are hidden
unless `KITSTAK_MCP_INCLUDE_PRIVATE=1`.

## How it stays safe

- Every tool runs fixed, parameterized SQL in a `READ ONLY` transaction. Claude never sends SQL.
- The warehouse schema comes from `core.wms_tenants` and is validated with the same
  `^wms(_[0-9a-f]{32})?$` rule the platform uses; `search_path` is pinned per transaction
  (`SET LOCAL`), so it is safe on the Supabase transaction pooler.
- It connects as a dedicated role (`sql/readonly-role.sql`) with `SELECT` on that one WMS
  schema and on chosen CRM, Projects and core tables. It gets no sessions, accounts,
  password data, API tokens, webhooks or billing ids, and only user id, name and title.
  On startup it refuses any role that can insert, update or delete.
- CRM, Projects and core tables are shared by every org, so the database grant covers all
  orgs' rows there; the server filters every query to its one org (tested).
- `KITSTAK_MCP_CLIENTS` narrows every tool to some clients.
- No service role key, no Better Auth secret, nothing from the apps' env.

## Setup (once)

1. Create the read-only role in Supabase (SQL editor or psql on the direct connection), with
   the org's WMS schema from `core.wms_tenants` (the platform org is `wms`). Add
   `-v skip_crm=1` or `-v skip_projects=1` to leave an app out:

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
`test/server.test.ts`. It checks that a second organization's data, private boards and
projects, and other clients never show up, that search text cannot inject SQL, that only
granted apps get tools, and that a writable role is refused.

## Later

- Write tools (create orders, adjust inventory) behind explicit confirmation.
- A hosted version inside the WMS app (`/api/mcp`) with Better Auth OAuth, so each user gets
  their own warehouse and client scope instead of one shared read-only role.
- Books, People and Pulse once they are on main.
