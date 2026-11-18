# Logiwa iO MCP server

Lets Claude answer questions from live Logiwa iO data: shipment orders and their status,
inventory by warehouse and location, clients, products, purchase orders, and what shipped
or was received. **Read only.** One server instance signs in as one Logiwa API user and sees
every client that user can see (or a narrower set you choose).

It lives outside the pnpm workspace (`tools/`, its own `package-lock.json`) so it does not
change the root lockfile or trigger any app build or Vercel deploy. It talks to Logiwa only;
it does not touch KitStak's database. Feeding KitStak from it can come later.

## Tools

| Tool                          | What it answers                                                            |
| ----------------------------- | -------------------------------------------------------------------------- |
| `logiwa_whoami`               | Which Logiwa host it reads, how it signs in, client narrowing (no secrets) |
| `logiwa_list_clients`         | 3PL clients and their identifiers                                          |
| `logiwa_list_warehouses`      | Warehouses and their identifiers and codes                                 |
| `logiwa_search_orders`        | Shipment orders by client, warehouse, status (or `open`), code, SKU, dates |
| `logiwa_get_order`            | One order (by identifier, order code or store order #) with its lines      |
| `logiwa_order_status_summary` | Order and unit counts by status and client, across pages                   |
| `logiwa_list_inventory`       | On-hand inventory rows by client, warehouse, SKU or location               |
| `logiwa_inventory_totals`     | Total Inventory report per SKU                                             |
| `logiwa_available_to_promise` | Available to Promise report per SKU                                        |
| `logiwa_list_products`        | Products by client, SKU or name                                            |
| `logiwa_get_product`          | One product in full                                                        |
| `logiwa_list_purchase_orders` | Inbound purchase orders by client, warehouse, status, code, dates          |
| `logiwa_get_purchase_order`   | One purchase order with its lines                                          |
| `logiwa_shipment_history`     | Shipment History report (what shipped, carrier, tracking)                  |
| `logiwa_receiving_history`    | Receiving History report                                                   |

Lists are paged (`page` is 1-based, `page_size` up to 200) and report Logiwa's total when it
sends one. Order lists return a short summary per order; pass `full: true` for every field.

## How it stays safe

- The HTTP client can do exactly two things: `POST /v3.1/Authorize/token` to sign in, and
  `GET` a path from the fixed table in `src/endpoints.ts`. Any other method or path throws
  before a request is sent (tested). Record identifiers that look like actions (`create`,
  `cancel`, `ship`...) or contain `/` are refused.
- It refuses to start without credentials, and checks them at startup.
- Credentials come only from `LOGIWA_MCP_*` environment variables, so it never picks up
  another script's Logiwa cookie or token. The token stays in memory; nothing is written to
  disk or logged. Plain `http` is refused (except `localhost` for tests).
- Any field that looks like a secret (`password`, `token`, `apiKey`...) is replaced with
  `[redacted]` before Claude sees it.
- Filters are sent to Logiwa and then applied again to the returned rows, so a filter Logiwa
  ignores cannot mix in other clients' orders. If Logiwa rejects the filter syntax, the server
  retries the plain page and filters locally, and says so.
- `LOGIWA_MCP_CLIENTS` narrows every tool to some clients, enforced on every row.
- Best practice on Logiwa's side: give the API user a read-only role.

## What you need from Logiwa

Logiwa iO's public API signs in with an **API user's email and password** (it returns a
token), not a key with scopes. Ask your Logiwa contact for:

1. An API user for Team 1 (separate from anyone's own login), with a **read-only** role if
   Logiwa offers one, and access to every client and the Bentonville warehouse.
2. Which host to use: production `https://myapi.logiwa.com` or sandbox
   `https://myapisandbox.logiwa.com`.
3. Access to the developer docs at https://mydeveloper.logiwa.com, to confirm the points
   under "API notes".

If Logiwa gives you a long-lived token instead, put it in `LOGIWA_MCP_TOKEN`.

## Setup

```bash
cd tools/logiwa-mcp && npm ci && npm run build
```

## Connect it to Claude

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "logiwa": {
      "command": "node",
      "args": ["C:/path/to/kitstak-platform/tools/logiwa-mcp/dist/index.js"],
      "env": {
        "LOGIWA_MCP_EMAIL": "<api user email>",
        "LOGIWA_MCP_PASSWORD": "<api user password>"
      }
    }
  }
}
```

Claude Code:

```bash
claude mcp add logiwa \
  -e LOGIWA_MCP_EMAIL='<api user email>' \
  -e LOGIWA_MCP_PASSWORD='<api user password>' \
  -- node /path/to/kitstak-platform/tools/logiwa-mcp/dist/index.js
```

Optional variables are in `.env.example` (host, client narrowing, page size, timeout).
Then ask Claude something like "how many open Explore Scientific orders are there?".

## API notes (check once you have access)

Built from Logiwa's help center, its public Swagger host and other public integrations; the
interactive docs need a login, so these are not yet confirmed against a live account:

- **Confirmed by Logiwa's help center:** `GET /v3.1/ShipmentOrder/list/i/{index}/s/{size}`
  and `GET /v3.1/ShipmentOrder/{identifier}`.
- **Same pattern, from other integrations:** `Inventory/list`, `Product/list`,
  `Product/{id}`, `PurchaseOrder/list`, `PurchaseOrder/{id}`, `Client/list`,
  `Warehouse/list`, and `Report/TotalInventory`, `AvailableToPromise`, `ShipmentHistory`,
  `ReceivingHistory`. Fix any that differ in `src/endpoints.ts`.
- **Sign in:** `POST /v3.1/Authorize/token` with `{ "email", "password" }`, returning
  `{ "token" }` (a JWT). Token lifetime is read from the JWT; on a 401 it signs in again.
- **Page index:** treated as 0-based (`page: 1` sends `/i/0`).
- **Filters:** sent as `Field.op=value` query parameters (`ClientIdentifier.eq`,
  `WarehouseIdentifier.eq`, `Status.eq`, `Code.eq`, `Sku.eq`, `ShipmentOrderDate.gte` /
  `.lte`). The exact syntax is not public. Because rows are always filtered locally too,
  answers stay correct either way, but if Logiwa ignores the filters a page may hold fewer
  matches. Set `LOGIWA_MCP_SERVER_FILTERS=0` to stop sending them.
- **Response envelope:** the server accepts a plain array or `data` / `items` / `results`,
  with `totalCount` / `recordCount` / `total` for the total.
- **Field names:** order fields follow Logiwa's documented names (`shipmentOrderStatusName`,
  `clientIdentifier`, `products[].productSKU`...). Inventory and report fields are shown as
  Logiwa sends them.

## Tests

`npm test` runs unit tests and an end-to-end test that starts the real server over stdio
against a local mock of the Logiwa API (`test/mock-logiwa.ts`) and calls every tool. No
network or Logiwa account needed. It checks the read-only path guard, that only sign-in and
GET requests are ever made, local filtering when Logiwa ignores or rejects filters, client
narrowing, redaction, token refresh, and that startup fails without (or with wrong)
credentials.

## Later

- Feed KitStak (orders, inventory) from this client on a schedule.
- Webhook subscription for near real time updates (Logiwa has webhooks).
