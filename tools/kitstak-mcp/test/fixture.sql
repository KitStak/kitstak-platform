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
