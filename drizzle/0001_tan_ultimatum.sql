CREATE TABLE `purchase_order_serials` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_line_id` text NOT NULL,
	`serial` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	FOREIGN KEY (`purchase_order_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_serials_line_serial_idx` ON `purchase_order_serials` (`purchase_order_line_id`,`serial`);--> statement-breakpoint
DROP INDEX `eod_unique_idx`;--> statement-breakpoint
ALTER TABLE `end_of_day_manifests` ADD `sequence` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `eod_unique_idx` ON `end_of_day_manifests` (`warehouse_id`,`carrier_connection_id`,`ship_date`,`sequence`);