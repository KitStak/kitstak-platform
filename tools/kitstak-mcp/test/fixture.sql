-- Test fixture: two organizations with their own warehouses, applied on top of the real
-- WMS + core migrations. The platform org ("kitstak") keeps schema `wms`; the tenant org
-- ("acme-3pl") gets `wms_<org hex>`. The tests assert the server only ever sees ACME.

-- The core migrations already seed the platform org "kitstak" and its `wms` tenant row.
INSERT INTO core.organization (id, name, slug, created_at) VALUES
  ('11111111-2222-4333-8444-555555555555', 'Acme 3PL', 'acme-3pl', now());

CREATE SCHEMA wms_11111111222243338444555555555555;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','warehouses','locations','products','kit_components','inventory',
                           'shipment_orders','order_lines','work_orders'] LOOP
    EXECUTE format('CREATE TABLE wms_11111111222243338444555555555555.%I (LIKE wms.%I INCLUDING ALL)', t, t);
  END LOOP;
END $$;

INSERT INTO core.wms_tenants (org_id, schema_name, status) VALUES
  ('11111111-2222-4333-8444-555555555555', 'wms_11111111222243338444555555555555', 'active');

-- Platform org data (must never be visible to the ACME server).
INSERT INTO wms.clients (id, code, name, contact_name, contact_email, phone, billing_plan, status, created_at, updated_at)
VALUES ('pc1', 'SECRET', 'Platform Only Client', 'x', 'x@x', '0', 'Standard', 'Active', '2026-01-01', '2026-01-01');

-- ACME data.
SET search_path TO wms_11111111222243338444555555555555;
INSERT INTO clients (id, code, name, contact_name, contact_email, phone, billing_plan, status, created_at, updated_at) VALUES
  ('c1', 'FRIDA', 'Frida Baby', 'Ashley', 'a@frida.test', '1', 'Standard', 'Active', '2026-01-01', '2026-01-01'),
  ('c2', 'ONYX', 'Onyx Coffee', 'Jon', 'j@onyx.test', '2', 'Standard', 'Active', '2026-01-01', '2026-01-01');
INSERT INTO warehouses (id, code, name, address_line, city, state, created_at, updated_at) VALUES
  ('w1', 'BTV', 'Bentonville', '1 Main', 'Bentonville', 'AR', '2026-01-01', '2026-01-01');
INSERT INTO locations (id, warehouse_id, code, zone, aisle, bay, level, type, capacity_units, created_at, updated_at) VALUES
  ('l1', 'w1', 'A-01-01', 'A', '01', '01', '1', 'Storage', 100, '2026-01-01', '2026-01-01'),
  ('l2', 'w1', 'A-01-02', 'A', '01', '02', '1', 'Storage', 100, '2026-01-01', '2026-01-01');
INSERT INTO products (id, client_id, sku, barcode, name, category, weight_oz, length_in, width_in, height_in, price, status,
                      is_kit, reorder_point, created_at, updated_at) VALUES
  ('p1', 'c1', 'FR-TRAY', '111', 'Trend Pod Tray', 'Display', 1, 1, 1, 1, 10, 'Active', true, 0, '2026-01-01', '2026-01-01'),
  ('p2', 'c1', 'FR-NOSE', '222', 'NoseFrida', 'Baby', 1, 1, 1, 1, 5, 'Active', false, 50, '2026-01-01', '2026-01-01'),
  ('p3', 'c1', 'FR-BOX', '333', 'Shipper Box', 'Packaging', 1, 1, 1, 1, 1, 'Active', false, 0, '2026-01-01', '2026-01-01'),
  ('p4', 'c2', 'ONYX-ADV', '444', 'Advent Calendar', 'Coffee', 1, 1, 1, 1, 60, 'Active', false, 0, '2026-01-01', '2026-01-01');
INSERT INTO kit_components (id, kit_product_id, component_product_id, quantity) VALUES
  ('k1', 'p1', 'p2', 12), ('k2', 'p1', 'p3', 1);
INSERT INTO inventory (id, warehouse_id, product_id, location_id, client_id, on_hand, allocated, received_at, bucket_key, updated_at) VALUES
  ('i1', 'w1', 'p2', 'l1', 'c1', 40, 4, '2026-01-01', 'b1', '2026-01-01'),
  ('i2', 'w1', 'p2', 'l2', 'c1', 10, 0, '2026-01-01', 'b2', '2026-01-01'),
  ('i3', 'w1', 'p3', 'l1', 'c1', 3, 0, '2026-01-01', 'b3', '2026-01-01'),
  ('i4', 'w1', 'p4', 'l2', 'c2', 500, 20, '2026-01-01', 'b4', '2026-01-01');
INSERT INTO shipment_orders (id, code, warehouse_id, client_id, channel, customer_name, customer_email, ship_address, ship_city,
                             ship_state, ship_zip, status, total_quantity, total_weight_oz, sales_price, order_date,
                             expected_ship_date, store_order_number, created_at, updated_at) VALUES
  ('o1', 'SO-1001', 'w1', 'c1', 'Manual', 'Jane Doe', 'j@d.test', '1 A St', 'Rogers', 'AR', '72756', 'Open', 4, 4, 20,
   '2026-11-10', '2000-01-01', 'SHOP-77', '2026-11-10', '2026-11-10'),
  ('o2', 'SO-1002', 'w1', 'c2', 'Manual', 'Bob Roe', 'b@r.test', '2 B St', 'Tulsa', 'OK', '74103', 'Shipped', 1, 1, 60,
   '2026-11-12', NULL, NULL, '2026-11-12', '2026-11-12');
INSERT INTO order_lines (id, order_id, product_id, quantity, allocated_quantity, unit_price, created_at, updated_at) VALUES
  ('ol1', 'o1', 'p2', 4, 4, 5, '2026-11-10', '2026-11-10'),
  ('ol2', 'o2', 'p4', 1, 0, 60, '2026-11-12', '2026-11-12');
INSERT INTO work_orders (id, code, warehouse_id, client_id, type, kit_product_id, requested_qty, created_at, updated_at) VALUES
  ('wo1', 'WO-1', 'w1', 'c1', 'Work Order with Picking', 'p1', 100, '2026-11-15', '2026-11-15');
RESET search_path;

-- Mirror production: RLS on, no policies.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'wms_11111111222243338444555555555555' LOOP
    EXECUTE format('ALTER TABLE wms_11111111222243338444555555555555.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ── Core: users, members, entitlements ───────────────────────────────────────────────
INSERT INTO core."user" (id, name, email, title) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Sydney Baker', 's@acme.test', 'Orders'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Josh Hooper', 'j@acme.test', 'Receiving'),
  ('aaaaaaaa-0000-4000-8000-000000000009', 'Platform Person', 'p@kitstak.test', NULL);
INSERT INTO core.member (organization_id, user_id, role, created_at) VALUES
  ('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner', now()),
  ('11111111-2222-4333-8444-555555555555', 'aaaaaaaa-0000-4000-8000-000000000002', 'member', now()),
  ((SELECT id FROM core.organization WHERE slug = 'kitstak'), 'aaaaaaaa-0000-4000-8000-000000000009', 'owner', now());
INSERT INTO core.entitlements (org_id, module, status, source) VALUES
  ('11111111-2222-4333-8444-555555555555', 'wms', 'active', 'manual'),
  ('11111111-2222-4333-8444-555555555555', 'crm', 'active', 'manual');

-- ── CRM (shared schema; ACME rows plus hidden ones) ───────────────────────────────────
INSERT INTO crm.workspaces (id, org_id, name, kind, position) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'Sales', 'open', 'a0'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'Leadership', 'closed', 'a1'),
  ('bbbbbbbb-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'Platform', 'open', 'a0');
INSERT INTO crm.boards (id, org_id, workspace_id, name, kind, privacy, position) VALUES
  ('cccccccc-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'bbbbbbbb-0000-4000-8000-000000000001', 'Deals', 'deals', 'main', 'a0'),
  ('cccccccc-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'bbbbbbbb-0000-4000-8000-000000000001', 'Accounts', 'accounts', 'main', 'a1'),
  ('cccccccc-0000-4000-8000-000000000003', '11111111-2222-4333-8444-555555555555', 'bbbbbbbb-0000-4000-8000-000000000002', 'Comp Plans', 'custom', 'main', 'a0'),
  ('cccccccc-0000-4000-8000-000000000004', '11111111-2222-4333-8444-555555555555', 'bbbbbbbb-0000-4000-8000-000000000001', 'Private Deals', 'deals', 'private', 'a2'),
  ('cccccccc-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'bbbbbbbb-0000-4000-8000-000000000009', 'Platform Deals', 'deals', 'main', 'a0');
INSERT INTO crm.columns (org_id, board_id, key, title, type, settings, position) VALUES
  ('11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'stage', 'Stage', 'status',
   '{"labels":[{"id":"l1","name":"Won","color":"green","position":0},{"id":"l2","name":"Lost","color":"red","position":1}]}', 'a0'),
  ('11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'owner', 'Owner', 'people', '{}', 'a1'),
  ('11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'value', 'Deal value', 'currency', '{}', 'a2'),
  ('11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'account', 'Account', 'connect_boards', '{}', 'a3');
INSERT INTO crm.groups (id, org_id, board_id, title, position) VALUES
  ('dddddddd-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'Negotiation', 'a0'),
  ('dddddddd-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000002', 'All', 'a0'),
  ('dddddddd-0000-4000-8000-000000000003', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000003', 'All', 'a0'),
  ('dddddddd-0000-4000-8000-000000000004', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000004', 'All', 'a0'),
  ('dddddddd-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'cccccccc-0000-4000-8000-000000000009', 'All', 'a0');
INSERT INTO crm.items (id, org_id, board_id, group_id, parent_item_id, name, values, position) VALUES
  ('eeeeeeee-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000002', NULL, 'Frida Baby', '{}', 'a0'),
  ('eeeeeeee-0000-4000-8000-000000000003', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000003', NULL, 'Secret comp', '{}', 'a0'),
  ('eeeeeeee-0000-4000-8000-000000000004', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000004', NULL, 'Hidden deal', '{}', 'a0'),
  ('eeeeeeee-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'cccccccc-0000-4000-8000-000000000009', 'dddddddd-0000-4000-8000-000000000009', NULL, 'Platform secret deal', '{}', 'a0');
INSERT INTO crm.items (id, org_id, board_id, group_id, parent_item_id, name, values, position) VALUES
  ('eeeeeeee-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', NULL, 'Frida Q4 trays',
   '{"stage":{"labelId":"l1"},"owner":{"ids":["aaaaaaaa-0000-4000-8000-000000000001","aaaaaaaa-0000-4000-8000-000000000009"]},"value":{"amount":12000,"currency":"USD"},"account":{"itemIds":["eeeeeeee-0000-4000-8000-000000000002","eeeeeeee-0000-4000-8000-000000000004"]}}', 'a0');
INSERT INTO crm.items (id, org_id, board_id, group_id, parent_item_id, name, values, position) VALUES
  ('eeeeeeee-0000-4000-8000-000000000005', '11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001', 'Send quote', '{}', 'a0');
INSERT INTO crm.item_links (org_id, from_item_id, to_item_id, column_key) VALUES
  ('11111111-2222-4333-8444-555555555555', 'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000002', 'account'),
  ('11111111-2222-4333-8444-555555555555', 'eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000004', 'account');
INSERT INTO crm.updates (org_id, board_id, item_id, author_id, body, body_text) VALUES
  ('11111111-2222-4333-8444-555555555555', 'cccccccc-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', '{}', 'Called Ashley, trays confirmed');

-- ── Projects (shared pm schema) ───────────────────────────────────────────────────────
INSERT INTO pm.projects (id, org_id, key, name, visibility, owner_id, due_date, position) VALUES
  ('ffffffff-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'OPS', 'Logiwa go-live', 'org', 'aaaaaaaa-0000-4000-8000-000000000001', '2026-12-01', 'a0'),
  ('ffffffff-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'HR', 'Raises', 'private', NULL, NULL, 'a1'),
  ('ffffffff-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'PLT', 'Platform secret', 'org', NULL, NULL, 'a0');
INSERT INTO pm.statuses (id, org_id, project_id, name, category, position, is_default) VALUES
  ('99999999-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', 'To do', 'todo', 'a0', true),
  ('99999999-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', 'Done', 'done', 'a1', false),
  ('99999999-0000-4000-8000-000000000003', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000002', 'To do', 'todo', 'a0', true),
  ('99999999-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'ffffffff-0000-4000-8000-000000000009', 'To do', 'todo', 'a0', true);
INSERT INTO pm.milestones (id, org_id, project_id, name, position) VALUES
  ('88888888-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', 'UAT', 'a0');
INSERT INTO pm.tasks (id, org_id, project_id, number, title, description, status_id, assignee_id, due_date, milestone_id, parent_task_id, position) VALUES
  ('77777777-0000-4000-8000-000000000001', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', 1, 'Finish setup checklist',
   '<p>All <b>three</b> clients</p>', '99999999-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', '2000-01-01', '88888888-0000-4000-8000-000000000001', NULL, 'a0'),
  ('77777777-0000-4000-8000-000000000002', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', 2, 'Kickoff', NULL,
   '99999999-0000-4000-8000-000000000002', NULL, NULL, NULL, NULL, 'a1'),
  ('77777777-0000-4000-8000-000000000004', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000002', 1, 'Secret raise task', NULL,
   '99999999-0000-4000-8000-000000000003', NULL, NULL, NULL, NULL, 'a0'),
  ('77777777-0000-4000-8000-000000000009', (SELECT id FROM core.organization WHERE slug = 'kitstak'), 'ffffffff-0000-4000-8000-000000000009', 1, 'Platform secret task', NULL,
   '99999999-0000-4000-8000-000000000009', NULL, NULL, NULL, NULL, 'a0');
INSERT INTO pm.tasks (id, org_id, project_id, number, title, status_id, parent_task_id, position) VALUES
  ('77777777-0000-4000-8000-000000000003', '11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', 3, 'Map NetSuite',
   '99999999-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001', 'a0');
INSERT INTO pm.comments (org_id, project_id, task_id, author_id, body) VALUES
  ('11111111-2222-4333-8444-555555555555', 'ffffffff-0000-4000-8000-000000000001', '77777777-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000002', 'Chris sent the checklist');
