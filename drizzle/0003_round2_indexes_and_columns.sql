ALTER TABLE `product_listings` ADD `dismissed_suggestion_sku` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `shipment_mail_sent_at` text;--> statement-breakpoint
ALTER TABLE `shipments` ADD `delivery_mail_sent_at` text;--> statement-breakpoint
ALTER TABLE `return_orders` ADD `return_shipping_cost` real;--> statement-breakpoint
ALTER TABLE `return_orders` ADD `return_tracking_numbers` text;--> statement-breakpoint
CREATE INDEX `return_orders_scope_idx` ON `return_orders` (`warehouse_id`,`client_id`,`status`);--> statement-breakpoint
CREATE INDEX `return_orders_created_idx` ON `return_orders` (`created_at`);--> statement-breakpoint
ALTER TABLE `billing_fees` ADD `pricing_mode` text DEFAULT 'graduated' NOT NULL;--> statement-breakpoint
CREATE INDEX `receipts_po_active_idx` ON `receipts` (`purchase_order_id`,`cancelled_at`);--> statement-breakpoint
CREATE INDEX `return_lines_order_line_idx` ON `return_order_lines` (`order_line_id`);--> statement-breakpoint
CREATE INDEX `jobs_count_plan_idx` ON `jobs` (`count_plan_id`);--> statement-breakpoint
CREATE INDEX `tasks_source_location_idx` ON `tasks` (`source_location_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_target_location_idx` ON `tasks` (`target_location_id`,`status`);--> statement-breakpoint
CREATE INDEX `count_lines_plan_status_idx` ON `count_plan_lines` (`plan_id`,`status`);--> statement-breakpoint
-- One Successful, non-Canceled bill per contract and day (organization-billing R2-16; same DDL as ensureBillGuards).
CREATE TRIGGER IF NOT EXISTS billing_reports_period_guard_ins BEFORE INSERT ON billing_reports FOR EACH ROW WHEN NEW.bill_status <> 'Canceled' AND NEW.calc_status = 'Successful' AND EXISTS (SELECT 1 FROM billing_reports b WHERE b.contract_id = NEW.contract_id AND b.id <> NEW.id AND b.bill_status <> 'Canceled' AND b.calc_status = 'Successful' AND substr(b.period_start, 1, 10) <= substr(NEW.period_end, 1, 10) AND substr(b.period_end, 1, 10) >= substr(NEW.period_start, 1, 10)) BEGIN SELECT RAISE(ABORT, 'KS_BILL_PERIOD_OVERLAP'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS billing_reports_period_guard_upd BEFORE UPDATE OF bill_status, calc_status, period_start, period_end, contract_id ON billing_reports FOR EACH ROW WHEN NEW.bill_status <> 'Canceled' AND NEW.calc_status = 'Successful' AND EXISTS (SELECT 1 FROM billing_reports b WHERE b.contract_id = NEW.contract_id AND b.id <> NEW.id AND b.bill_status <> 'Canceled' AND b.calc_status = 'Successful' AND substr(b.period_start, 1, 10) <= substr(NEW.period_end, 1, 10) AND substr(b.period_end, 1, 10) >= substr(NEW.period_start, 1, 10)) BEGIN SELECT RAISE(ABORT, 'KS_BILL_PERIOD_OVERLAP'); END;
