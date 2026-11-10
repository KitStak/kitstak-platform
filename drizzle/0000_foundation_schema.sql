CREATE TABLE `apps` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`settings` text,
	`activated_at` text,
	`activated_by` text
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail` text,
	`at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`outcome` text DEFAULT 'success' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `company_settings` (
	`id` text PRIMARY KEY DEFAULT 'company' NOT NULL,
	`display_name` text NOT NULL,
	`full_name` text NOT NULL,
	`logo_file_id` text,
	`defaults` text,
	`password_policy` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`href` text,
	`severity` text DEFAULT 'info' NOT NULL,
	`read_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_token_idx` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'Operation' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`restrictions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_idx` ON `roles` (`key`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`grid_key` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`is_shared` integer DEFAULT false NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`pinned_fields` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_views_grid_idx` ON `saved_views` (`grid_key`,`user_id`);--> statement-breakpoint
CREATE TABLE `user_clients` (
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `client_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_grid_prefs` (
	`user_id` text NOT NULL,
	`grid_key` text NOT NULL,
	`prefs` text NOT NULL,
	PRIMARY KEY(`user_id`, `grid_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_printers` (
	`user_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`barcode_printer` text,
	`laser_printer` text,
	PRIMARY KEY(`user_id`, `warehouse_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_version` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_sessions_user_idx` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_warehouses` (
	`user_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `warehouse_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`first_name` text,
	`last_name` text,
	`user_type` text DEFAULT 'Operation' NOT NULL,
	`is_api_user` integer DEFAULT false NOT NULL,
	`all_clients` integer DEFAULT true NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`last_login_at` text,
	`password_changed_at` text,
	`preferences` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text,
	`usage_type` text DEFAULT 'Shipping' NOT NULL,
	`first_name` text,
	`last_name` text,
	`company_name` text,
	`line1` text NOT NULL,
	`line2` text,
	`city` text NOT NULL,
	`state` text,
	`postal_code` text NOT NULL,
	`country` text NOT NULL,
	`phone` text,
	`email` text,
	`address_type` text,
	`is_default` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `addresses_owner_idx` ON `addresses` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`phone` text NOT NULL,
	`billing_plan` text NOT NULL,
	`status` text NOT NULL,
	`official_name` text,
	`tax_id` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_code_idx` ON `clients` (`code`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customers_client_idx` ON `customers` (`client_id`);--> statement-breakpoint
CREATE TABLE `retailers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`business_name` text,
	`logo_file_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`create_case_labels` integer DEFAULT false NOT NULL,
	`case_label_print_qty` integer DEFAULT 1 NOT NULL,
	`lp_label_print_qty` integer DEFAULT 1 NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retailers_name_idx` ON `retailers` (`name`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`display_name` text NOT NULL,
	`vendor_name` text NOT NULL,
	`use_ship_as_billing` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_client_name_idx` ON `vendors` (`client_id`,`display_name`);--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address_line` text NOT NULL,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`address_line2` text,
	`postal_code` text,
	`country` text DEFAULT 'United States' NOT NULL,
	`contact_name` text,
	`contact_phone` text,
	`email` text,
	`type` text DEFAULT 'Internal' NOT NULL,
	`timezone` text DEFAULT 'America/Chicago' NOT NULL,
	`day_shift_start` text DEFAULT '08:00' NOT NULL,
	`day_shift_end` text DEFAULT '17:00' NOT NULL,
	`default_dimension_unit` text DEFAULT 'Inch' NOT NULL,
	`default_weight_unit` text DEFAULT 'Pound' NOT NULL,
	`use_lp_dims_for_putaway` integer DEFAULT false NOT NULL,
	`default_receiving_location_id` text,
	`default_ship_location_id` text,
	`default_return_location_id` text,
	`mandatory_adjustment_reason` integer DEFAULT true NOT NULL,
	`mandatory_count_reason` integer DEFAULT false NOT NULL,
	`mobile_auto_logout_minutes` integer DEFAULT 30,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_idx` ON `warehouses` (`code`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`document_type` text NOT NULL,
	`file_id` text NOT NULL,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_entity_idx` ON `attachments` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `background_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`grid_key` text,
	`query` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`row_count` integer,
	`error_message` text,
	`file_id` text,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bg_tasks_user_idx` ON `background_tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_code` text,
	`parent_entity_type` text,
	`parent_entity_id` text,
	`type` text NOT NULL,
	`field` text,
	`field_label` text,
	`from_value` text,
	`to_value` text,
	`message` text NOT NULL,
	`user_id` text,
	`source` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_log_entity_idx` ON `change_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `change_log_at_idx` ON `change_log` (`at`);--> statement-breakpoint
CREATE INDEX `change_log_parent_idx` ON `change_log` (`parent_entity_type`,`parent_entity_id`);--> statement-breakpoint
CREATE TABLE `code_sequences` (
	`key` text NOT NULL,
	`warehouse_id` text DEFAULT '*' NOT NULL,
	`prefix` text NOT NULL,
	`next_value` integer DEFAULT 1 NOT NULL,
	`padding` integer DEFAULT 6 NOT NULL,
	`auto_generate` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`key`, `warehouse_id`)
);
--> statement-breakpoint
CREATE TABLE `custom_field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`slot` text NOT NULL,
	`name` text NOT NULL,
	`options` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cfd_slot_idx` ON `custom_field_defs` (`entity_type`,`slot`);--> statement-breakpoint
CREATE TABLE `entity_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`body` text NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entity_notes_entity_idx` ON `entity_notes` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `entity_tags` (
	`tag_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`tag_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_tags_entity_idx` ON `entity_tags` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`owner_entity_type` text,
	`owner_entity_id` text,
	`uploaded_by` text,
	`created_at` text NOT NULL,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `files_owner_idx` ON `files` (`owner_entity_type`,`owner_entity_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`import_key` text NOT NULL,
	`status` text NOT NULL,
	`master_row_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`file_id` text NOT NULL,
	`error_file_id` text,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_batches_key_idx` ON `import_batches` (`import_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`success` integer NOT NULL,
	`data` text NOT NULL,
	`message` text,
	`entity_id` text,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_rows_batch_idx` ON `import_rows` (`batch_id`);--> statement-breakpoint
CREATE TABLE `lookup_values` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`client_id` text,
	`warehouse_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`meta` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lookup_type_idx` ON `lookup_values` (`type`);--> statement-breakpoint
CREATE UNIQUE INDEX `lookup_unique_idx` ON `lookup_values` (`type`,`name`,(CASE WHEN "client_id" IS NULL THEN '' ELSE "client_id" END),(CASE WHEN "warehouse_id" IS NULL THEN '' ELSE "warehouse_id" END));--> statement-breakpoint
CREATE TABLE `printout_template_clients` (
	`template_id` text NOT NULL,
	`client_id` text NOT NULL,
	`has_access` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`template_id`, `client_id`),
	FOREIGN KEY (`template_id`) REFERENCES `printout_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `printout_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`type_key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`records_per_page` text NOT NULL,
	`print_mode` text NOT NULL,
	`printer_type` text NOT NULL,
	`base_template` text NOT NULL,
	`layout` text,
	`options` text,
	`all_clients` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `printout_type_idx` ON `printout_templates` (`type_key`);--> statement-breakpoint
CREATE TABLE `screen_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`name` text NOT NULL,
	`operation_type` text DEFAULT 'Receiving' NOT NULL,
	`screen_name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`conditions` text,
	`config` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `screen_configs_wh_idx` ON `screen_configs` (`warehouse_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`scope` text DEFAULT 'any' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_scope_idx` ON `tags` (`name`,`scope`);--> statement-breakpoint
CREATE TABLE `kit_components` (
	`id` text PRIMARY KEY NOT NULL,
	`kit_product_id` text NOT NULL,
	`component_product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`pack_type` text DEFAULT 'Each' NOT NULL,
	FOREIGN KEY (`kit_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kit_component_idx` ON `kit_components` (`kit_product_id`,`component_product_id`);--> statement-breakpoint
CREATE TABLE `product_barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`pack_type_id` text NOT NULL,
	`barcode` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pack_type_id`) REFERENCES `product_pack_types`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_barcodes_code_idx` ON `product_barcodes` (`barcode`);--> statement-breakpoint
CREATE TABLE `product_channel_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`channel_connection_id` text NOT NULL,
	`warehouse_id` text,
	`static_qty` integer,
	`reserve_qty` integer,
	`allocation_pct` real,
	`synced_qty` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pca_product_idx` ON `product_channel_allocations` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_listings` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_connection_id` text NOT NULL,
	`client_id` text NOT NULL,
	`product_id` text,
	`seller_sku` text NOT NULL,
	`channel_product_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`store_price` real,
	`image_url` text,
	`never_sync` integer DEFAULT false NOT NULL,
	`linked_at` text,
	`last_synced_qty` integer,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`channel_connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_unique_idx` ON `product_listings` (`channel_connection_id`,`channel_product_id`);--> statement-breakpoint
CREATE INDEX `listing_product_idx` ON `product_listings` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_pack_types` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`pack_type` text NOT NULL,
	`kind` text NOT NULL,
	`parent_pack_type_id` text,
	`child_qty` integer,
	`uom_qty` integer DEFAULT 1 NOT NULL,
	`dimension_unit` text DEFAULT 'Inch' NOT NULL,
	`length` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`volume_unit` text DEFAULT 'Cubic Inch' NOT NULL,
	`volume` real DEFAULT 0 NOT NULL,
	`weight_unit` text DEFAULT 'Pound' NOT NULL,
	`weight` real DEFAULT 0 NOT NULL,
	`use_ship_package_id` text,
	`use_own_box` integer DEFAULT false NOT NULL,
	`use_primary_barcodes` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ppt_product_pack_idx` ON `product_pack_types` (`product_id`,`pack_type`);--> statement-breakpoint
CREATE TABLE `product_replenishment_levels` (
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`min_level` integer NOT NULL,
	`max_level` integer NOT NULL,
	PRIMARY KEY(`product_id`, `warehouse_id`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`uom` text DEFAULT 'Each' NOT NULL,
	`weight_oz` real NOT NULL,
	`length_in` real NOT NULL,
	`width_in` real NOT NULL,
	`height_in` real NOT NULL,
	`price` real NOT NULL,
	`is_kit` integer DEFAULT false NOT NULL,
	`is_fragile` integer DEFAULT false NOT NULL,
	`is_hazmat` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`reorder_point` integer DEFAULT 0 NOT NULL,
	`product_category` text DEFAULT 'Product' NOT NULL,
	`kit_type` text,
	`description` text,
	`image_url` text,
	`product_type_id` text,
	`product_group_id` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`purchase_price` real DEFAULT 0 NOT NULL,
	`tax_rate` real DEFAULT 0 NOT NULL,
	`min_safety_stock` integer DEFAULT 0 NOT NULL,
	`fnsku` text,
	`is_digital` integer DEFAULT false NOT NULL,
	`is_foldable` integer DEFAULT false NOT NULL,
	`is_oversized` integer DEFAULT false NOT NULL,
	`is_insert` integer DEFAULT false NOT NULL,
	`is_stackable` integer DEFAULT false NOT NULL,
	`is_poster` integer DEFAULT false NOT NULL,
	`is_liquid` integer DEFAULT false NOT NULL,
	`is_non_returnable` integer DEFAULT false NOT NULL,
	`packing_instructions` text,
	`return_instructions` text,
	`use_ship_package_id` text,
	`customs` text,
	`hazmat` text,
	`track_expiry` integer DEFAULT false NOT NULL,
	`expiry_receiving_only` integer DEFAULT false NOT NULL,
	`expiry_format` text,
	`expiry_scan_method` text,
	`shelf_life_days` integer,
	`track_lot` integer DEFAULT false NOT NULL,
	`lot_receiving_only` integer DEFAULT false NOT NULL,
	`auto_create_lot` integer DEFAULT false NOT NULL,
	`lot_regex` text,
	`lot_scan_method` text,
	`track_production_date` integer DEFAULT false NOT NULL,
	`production_receiving_only` integer DEFAULT false NOT NULL,
	`production_format` text,
	`production_scan_method` text,
	`replenishment_strategy` text DEFAULT 'Global' NOT NULL,
	`replenishment_min` integer DEFAULT 0 NOT NULL,
	`replenishment_max` integer DEFAULT 0 NOT NULL,
	`track_serial` integer DEFAULT false NOT NULL,
	`track_secondary_serial` integer DEFAULT false NOT NULL,
	`serial_method` text,
	`skip_serial_scan` integer DEFAULT false NOT NULL,
	`serial_regex` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_sku_idx` ON `products` (`client_id`,`sku`);--> statement-breakpoint
CREATE INDEX `products_barcode_idx` ON `products` (`barcode`);--> statement-breakpoint
CREATE TABLE `serial_numbers` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`primary_serial` text NOT NULL,
	`secondary_serial` text,
	`status` text NOT NULL,
	`inventory_id` text,
	`receipt_id` text,
	`order_line_id` text,
	`shipment_id` text,
	`entry_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `serial_unique_idx` ON `serial_numbers` (`product_id`,`primary_serial`);--> statement-breakpoint
CREATE TABLE `serial_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`serial_id` text NOT NULL,
	`inventory_transaction_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`serial_id`) REFERENCES `serial_numbers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `serial_txn_serial_idx` ON `serial_transactions` (`serial_id`);--> statement-breakpoint
CREATE TABLE `license_plates` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`lp_type_id` text NOT NULL,
	`location_id` text,
	`parent_lp_id` text,
	`original_number` text,
	`alternate_barcode` text,
	`is_sscc18` integer DEFAULT false NOT NULL,
	`client_id` text,
	`length` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`weight` real DEFAULT 0 NOT NULL,
	`actual_volume` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Empty' NOT NULL,
	`label_printed_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lp_type_id`) REFERENCES `lp_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lp_number_idx` ON `license_plates` (`warehouse_id`,`number`);--> statement-breakpoint
CREATE INDEX `lp_location_idx` ON `license_plates` (`location_id`);--> statement-breakpoint
CREATE INDEX `lp_parent_idx` ON `license_plates` (`parent_lp_id`);--> statement-breakpoint
CREATE TABLE `location_lp_capacity` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`lp_type_id` text NOT NULL,
	`min_qty` integer DEFAULT 0 NOT NULL,
	`max_qty` integer DEFAULT 0 NOT NULL,
	`client_id` text,
	`product_id` text,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lp_type_id`) REFERENCES `lp_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `llc_location_idx` ON `location_lp_capacity` (`location_id`);--> statement-breakpoint
CREATE TABLE `location_product_capacity` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`client_id` text NOT NULL,
	`product_id` text NOT NULL,
	`pack_type` text NOT NULL,
	`min_qty` integer DEFAULT 0 NOT NULL,
	`max_qty` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lpc_idx` ON `location_product_capacity` (`location_id`,`product_id`,`pack_type`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`zone` text NOT NULL,
	`aisle` text NOT NULL,
	`bay` text NOT NULL,
	`level` text NOT NULL,
	`type` text NOT NULL,
	`capacity_units` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`barcode` text,
	`display_member` text,
	`location_group_id` text,
	`location_zone_id` text,
	`location_type` text,
	`area_type` text,
	`replenishment_type` text,
	`walking_path_priority` integer DEFAULT 0 NOT NULL,
	`capacity_type` text DEFAULT 'None' NOT NULL,
	`max_capacity_qty` integer DEFAULT 0 NOT NULL,
	`max_sku_qty` integer,
	`mezzanine` text,
	`rack` text,
	`column` integer DEFAULT 0 NOT NULL,
	`position` text,
	`dimension_unit` text DEFAULT 'Inch' NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`length` real DEFAULT 0 NOT NULL,
	`volume_unit` text DEFAULT 'Cubic Inch' NOT NULL,
	`volume` real DEFAULT 0 NOT NULL,
	`abc_code` text DEFAULT 'None' NOT NULL,
	`single_client` integer DEFAULT false NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`dedicated_client_id` text,
	`print_apply_on_packing` integer DEFAULT false NOT NULL,
	`color_code` text,
	`prevent_allocation` integer DEFAULT false NOT NULL,
	`prevent_inventory_sync` integer DEFAULT false NOT NULL,
	`only_one_lot` integer DEFAULT false NOT NULL,
	`only_damaged` integer DEFAULT false NOT NULL,
	`only_one_expiry` integer DEFAULT false NOT NULL,
	`only_one_sku` integer DEFAULT false NOT NULL,
	`only_one_lp` integer DEFAULT false NOT NULL,
	`only_one_production_date` integer DEFAULT false NOT NULL,
	`auto_remove_lp_after_replenishment` integer DEFAULT false NOT NULL,
	`auto_remove_lp_after_transfer` integer DEFAULT false NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dedicated_client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_code_idx` ON `locations` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE INDEX `locations_barcode_idx` ON `locations` (`barcode`);--> statement-breakpoint
CREATE INDEX `locations_area_idx` ON `locations` (`warehouse_id`,`area_type`);--> statement-breakpoint
CREATE TABLE `lp_types` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`number_prefix` text NOT NULL,
	`number_length` integer NOT NULL,
	`length` real DEFAULT 0 NOT NULL,
	`width` real DEFAULT 0 NOT NULL,
	`height` real DEFAULT 0 NOT NULL,
	`dimension_unit` text DEFAULT 'Inch' NOT NULL,
	`weight_unit` text DEFAULT 'Ounce' NOT NULL,
	`volume_unit` text DEFAULT 'Cubic Inch' NOT NULL,
	`empty_weight` real DEFAULT 0 NOT NULL,
	`max_weight` real DEFAULT 0 NOT NULL,
	`max_volume` real DEFAULT 0 NOT NULL,
	`only_one_expiry` integer DEFAULT false NOT NULL,
	`only_one_production_date` integer DEFAULT false NOT NULL,
	`only_one_lot` integer DEFAULT false NOT NULL,
	`only_one_sku` integer DEFAULT false NOT NULL,
	`only_one_client` integer DEFAULT false NOT NULL,
	`only_one_order` integer DEFAULT false NOT NULL,
	`only_one_job` integer DEFAULT false NOT NULL,
	`suitable_for_parent_lp` integer DEFAULT false NOT NULL,
	`use_for_ai_job` integer DEFAULT false NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lp_types_code_idx` ON `lp_types` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE TABLE `mobile_cart_cells` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`level` integer NOT NULL,
	`column` integer NOT NULL,
	`barcode` text NOT NULL,
	`order_id` text,
	FOREIGN KEY (`cart_id`) REFERENCES `mobile_carts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_cell_idx` ON `mobile_cart_cells` (`cart_id`,`level`,`column`);--> statement-breakpoint
CREATE TABLE `mobile_carts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`description` text,
	`cart_type_id` text NOT NULL,
	`levels` integer NOT NULL,
	`columns` integer NOT NULL,
	`operation_type` text DEFAULT 'Picking' NOT NULL,
	`allow_multiple_job` integer DEFAULT false NOT NULL,
	`is_dynamic` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'Available' NOT NULL,
	`current_job_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_cart_code_idx` ON `mobile_carts` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE TABLE `shipment_package_clients` (
	`package_id` text NOT NULL,
	`client_id` text NOT NULL,
	`has_access` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`package_id`, `client_id`),
	FOREIGN KEY (`package_id`) REFERENCES `shipment_packages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipment_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`weight_unit` text DEFAULT 'Pound' NOT NULL,
	`empty_weight` real DEFAULT 0 NOT NULL,
	`max_weight` real,
	`dimension_unit` text DEFAULT 'Inch' NOT NULL,
	`length` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`volume_unit` text DEFAULT 'Cubic Inch' NOT NULL,
	`max_volume` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`purchase_price` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`all_clients` integer DEFAULT true NOT NULL,
	`track_inventory` integer DEFAULT false NOT NULL,
	`inventory_client_id` text,
	`inventory_product_id` text,
	`reduction_rule` text,
	`reduction_location_id` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ship_pkg_code_idx` ON `shipment_packages` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lot_number` text,
	`on_hand` integer NOT NULL,
	`allocated` integer DEFAULT 0 NOT NULL,
	`damaged` integer DEFAULT 0 NOT NULL,
	`received_at` text NOT NULL,
	`bucket_key` text NOT NULL,
	`client_id` text,
	`lp_id` text,
	`status` text DEFAULT 'Stock' NOT NULL,
	`pack_type` text DEFAULT 'Each' NOT NULL,
	`expiry_date` text,
	`production_date` text,
	`damage_reason` text,
	`po_number` text,
	`mobile_cart_id` text,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lp_id`) REFERENCES `license_plates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_product_idx` ON `inventory` (`product_id`);--> statement-breakpoint
CREATE INDEX `inventory_location_idx` ON `inventory` (`location_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_bucket_idx` ON `inventory` (`bucket_key`);--> statement-breakpoint
CREATE INDEX `inventory_wh_client_product_idx` ON `inventory` (`warehouse_id`,`client_id`,`product_id`);--> statement-breakpoint
CREATE INDEX `inventory_status_idx` ON `inventory` (`status`);--> statement-breakpoint
CREATE INDEX `inventory_lp_idx` ON `inventory` (`lp_id`);--> statement-breakpoint
CREATE TABLE `inventory_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`inventory_id` text NOT NULL,
	`order_id` text,
	`order_line_id` text,
	`work_order_id` text,
	`work_order_component_id` text,
	`job_id` text,
	`task_id` text,
	`qty` integer NOT NULL,
	`status` text DEFAULT 'Allocated' NOT NULL,
	`algorithm_id` text,
	`rule_name` text,
	`wave_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`inventory_id`) REFERENCES `inventory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `alloc_order_idx` ON `inventory_allocations` (`order_id`);--> statement-breakpoint
CREATE INDEX `alloc_inv_idx` ON `inventory_allocations` (`inventory_id`);--> statement-breakpoint
CREATE INDEX `alloc_job_idx` ON `inventory_allocations` (`job_id`);--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_at` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lp_id` text,
	`parent_lp_id` text,
	`lot_number` text,
	`expiry_date` text,
	`production_date` text,
	`damage_reason` text,
	`status` text NOT NULL,
	`pack_type` text NOT NULL,
	`uom_qty` integer NOT NULL,
	`pack_qty` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snap_at_idx` ON `inventory_snapshots` (`snapshot_at`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `inventory_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`product_id` text NOT NULL,
	`from_inventory_id` text,
	`to_inventory_id` text,
	`from_location_id` text,
	`to_location_id` text,
	`from_lp_id` text,
	`to_lp_id` text,
	`from_parent_lp_id` text,
	`to_parent_lp_id` text,
	`from_status` text,
	`to_status` text,
	`from_pack_type` text,
	`to_pack_type` text,
	`from_lot` text,
	`to_lot` text,
	`from_expiry` text,
	`to_expiry` text,
	`from_production_date` text,
	`to_production_date` text,
	`from_damage_reason` text,
	`to_damage_reason` text,
	`uom_qty` integer NOT NULL,
	`pack_qty` integer NOT NULL,
	`adjustment_reason_id` text,
	`order_id` text,
	`order_line_id` text,
	`purchase_order_id` text,
	`receipt_id` text,
	`work_order_id` text,
	`count_plan_id` text,
	`return_order_id` text,
	`job_id` text,
	`task_id` text,
	`shipment_id` text,
	`algorithm_name` text,
	`algorithm_rule_name` text,
	`note` text,
	`user_id` text,
	`source` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `itx_product_idx` ON `inventory_transactions` (`product_id`,`at`);--> statement-breakpoint
CREATE INDEX `itx_type_idx` ON `inventory_transactions` (`type`,`at`);--> statement-breakpoint
CREATE INDEX `itx_order_idx` ON `inventory_transactions` (`order_id`);--> statement-breakpoint
CREATE INDEX `itx_wh_idx` ON `inventory_transactions` (`warehouse_id`,`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `itx_seq_idx` ON `inventory_transactions` (`seq`);--> statement-breakpoint
CREATE TABLE `missing_log` (
	`id` text PRIMARY KEY NOT NULL,
	`wave_no` text,
	`job_id` text,
	`task_id` text,
	`order_id` text,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lp_id` text,
	`pack_type` text NOT NULL,
	`missing_qty` integer NOT NULL,
	`inventory_qty` integer NOT NULL,
	`is_retain` integer DEFAULT false NOT NULL,
	`notes` text,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`entered_by` text NOT NULL,
	`entered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `missing_log_at_idx` ON `missing_log` (`warehouse_id`,`entered_at`);--> statement-breakpoint
CREATE TABLE `order_line_shortages` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`reason` text NOT NULL,
	`missing_triggered` integer DEFAULT false NOT NULL,
	`shortage_qty` integer NOT NULL,
	`free_qty` integer NOT NULL,
	`damaged_qty` integer NOT NULL,
	`on_hand_qty` integer NOT NULL,
	`last_trial_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ols_line_idx` ON `order_line_shortages` (`order_line_id`);--> statement-breakpoint
CREATE INDEX `ols_order_idx` ON `order_line_shortages` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`picked_quantity` integer DEFAULT 0 NOT NULL,
	`packed_quantity` integer DEFAULT 0 NOT NULL,
	`unit_price` real NOT NULL,
	`pack_type` text DEFAULT 'Each' NOT NULL,
	`uom_ratio` integer DEFAULT 1 NOT NULL,
	`allocated_quantity` integer DEFAULT 0 NOT NULL,
	`cancelled_quantity` integer DEFAULT 0 NOT NULL,
	`sorted_quantity` integer DEFAULT 0 NOT NULL,
	`shipped_quantity` integer DEFAULT 0 NOT NULL,
	`loaded_quantity` integer DEFAULT 0 NOT NULL,
	`lot_number` text,
	`expiry_date` text,
	`production_date` text,
	`damage_reason` text,
	`pinned_location_id` text,
	`pinned_lp_id` text,
	`line_note1` text,
	`line_note2` text,
	`line_note3` text,
	`kit_product_id` text,
	`original_order_code` text,
	`store_update_notes` text,
	`is_store_updated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `shipment_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_lines_product_idx` ON `order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `shipment_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`channel` text NOT NULL,
	`store_name` text,
	`store_order_number` text,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`ship_address` text NOT NULL,
	`ship_city` text NOT NULL,
	`ship_state` text NOT NULL,
	`ship_zip` text NOT NULL,
	`ship_country` text DEFAULT 'United States' NOT NULL,
	`status` text NOT NULL,
	`order_type` text DEFAULT 'D2C' NOT NULL,
	`priority` text DEFAULT 'None' NOT NULL,
	`carrier` text,
	`shipping_service` text,
	`tracking_number` text,
	`total_quantity` integer NOT NULL,
	`total_weight_oz` real NOT NULL,
	`sales_price` real NOT NULL,
	`job_id` text,
	`order_date` text NOT NULL,
	`expected_ship_date` text,
	`shipped_at` text,
	`delivered_at` text,
	`note` text,
	`order_type_id` text,
	`priority_rank` integer DEFAULT 0 NOT NULL,
	`customer_id` text,
	`customer_first_name` text,
	`customer_last_name` text,
	`customer_phone` text,
	`company_name` text,
	`ship_address2` text,
	`address_type` text,
	`skip_address_verification` integer DEFAULT false NOT NULL,
	`address_verification_status` text DEFAULT 'Unverified' NOT NULL,
	`address_verification_notes` text,
	`tax_type` text,
	`tax_id` text,
	`use_ship_as_billing` integer DEFAULT true NOT NULL,
	`billing_address` text,
	`expected_delivery_date` text,
	`carrier_expected_delivery_date` text,
	`scheduled_pickup_date` text,
	`scheduled_shipment_date` text,
	`actual_pickup_date` text,
	`cancelled_at` text,
	`cancel_reason_id` text,
	`carrier_connection_id` text,
	`carrier_service_id` text,
	`rate_shopping_preset_id` text,
	`shipping_charges_billing_type` text,
	`tax_duties_billing_type` text,
	`shipping_account_number` text,
	`tax_duties_account_number` text,
	`packing_instructions` text,
	`shipment_package_id` text,
	`total_shipping_cost` real DEFAULT 0 NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`reason_for_export` text,
	`return_address_id` text,
	`return_carrier_service_id` text,
	`return_shipping_cost` real,
	`return_tracking_numbers` text,
	`tracking_numbers` text,
	`extra_note1` text,
	`extra_note2` text,
	`extra_note3` text,
	`extra_note4` text,
	`extra_note5` text,
	`client_reference_code` text,
	`fraud` text,
	`packing_warning_type_id` text,
	`is_gift` integer DEFAULT false NOT NULL,
	`gift_note` text,
	`order_code_grouping_ref` text,
	`retailer_id` text,
	`bol` text,
	`pro` text,
	`retailer_po` text,
	`dept` text,
	`mark_for` text,
	`retailer_customer_account` text,
	`is_ucc_label_generated` integer DEFAULT false NOT NULL,
	`is_back_order` integer DEFAULT false NOT NULL,
	`master_order_id` text,
	`merged_into_order_id` text,
	`is_merged` integer DEFAULT false NOT NULL,
	`pick_short_status` text DEFAULT 'None' NOT NULL,
	`pack_short_status` text DEFAULT 'None' NOT NULL,
	`pick_list_printed` integer DEFAULT false NOT NULL,
	`is_auto_ship` integer DEFAULT false NOT NULL,
	`is_prime` integer DEFAULT false NOT NULL,
	`channel_connection_id` text,
	`channel_payment_status` text,
	`requested_shipping_option` text,
	`workflow_blocked` text DEFAULT 'None' NOT NULL,
	`deleted_at` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_code_idx` ON `shipment_orders` (`code`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `shipment_orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_client_idx` ON `shipment_orders` (`client_id`);--> statement-breakpoint
CREATE INDEX `orders_date_idx` ON `shipment_orders` (`order_date`);--> statement-breakpoint
CREATE INDEX `orders_wh_status_idx` ON `shipment_orders` (`warehouse_id`,`status`);--> statement-breakpoint
CREATE INDEX `orders_store_number_idx` ON `shipment_orders` (`store_order_number`);--> statement-breakpoint
CREATE INDEX `orders_job_idx` ON `shipment_orders` (`job_id`);--> statement-breakpoint
CREATE TABLE `end_of_day_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`warehouse_id` text NOT NULL,
	`carrier_connection_id` text NOT NULL,
	`carrier_prefix` text NOT NULL,
	`carrier_code` text NOT NULL,
	`ship_date` text NOT NULL,
	`close_date` text,
	`is_printed` integer DEFAULT false NOT NULL,
	`total_packages` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`report_file_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eod_unique_idx` ON `end_of_day_manifests` (`warehouse_id`,`carrier_connection_id`,`ship_date`);--> statement-breakpoint
CREATE TABLE `shipment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`pack_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`lot_number` text,
	`expiry_date` text,
	`serial_number_id` text,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shipment_items_shipment_idx` ON `shipment_items` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `shipment_plan_orders` (
	`plan_id` text NOT NULL,
	`order_id` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`plan_id`, `order_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `shipment_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `shipment_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `spo_order_idx` ON `shipment_plan_orders` (`order_id`);--> statement-breakpoint
CREATE TABLE `shipment_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text,
	`carrier_connection_id` text,
	`truck_plate_number` text,
	`loading_gate_location_id` text,
	`status` text DEFAULT 'Open' NOT NULL,
	`planned_shipment_at` text,
	`actual_shipment_at` text,
	`loading_started_at` text,
	`loading_completed_at` text,
	`truck_departed_at` text,
	`expected_total_volume` real DEFAULT 0 NOT NULL,
	`expected_total_weight` real DEFAULT 0 NOT NULL,
	`prevent_lpn_edit_during_loading` integer DEFAULT false NOT NULL,
	`note` text,
	`customer_id` text,
	`customer_address_id` text,
	`retailer_id` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipment_plan_code_idx` ON `shipment_plans` (`code`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`carrier_connection_id` text,
	`carrier_code` text NOT NULL,
	`carrier_service_id` text,
	`service_name` text NOT NULL,
	`rate_shopping_preset_id` text,
	`is_rate_shopped` integer DEFAULT false NOT NULL,
	`label_type` text DEFAULT 'Shipping Label' NOT NULL,
	`label_status` text DEFAULT 'Active' NOT NULL,
	`label_format` text DEFAULT 'PDF' NOT NULL,
	`label_file_id` text,
	`master_tracking_number` text,
	`tracking_number` text NOT NULL,
	`shipment_package_id` text,
	`package_seq` integer DEFAULT 1 NOT NULL,
	`weight` real NOT NULL,
	`weight_unit` text DEFAULT 'Ounce' NOT NULL,
	`length` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`dimension_unit` text DEFAULT 'Inch' NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`shipping_cost` real DEFAULT 0 NOT NULL,
	`other_cost` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`zone` text,
	`insurance_type` text,
	`insurance_value` real,
	`confirmation_type` text,
	`allow_saturday_delivery` integer DEFAULT false NOT NULL,
	`carrier_expected_delivery_at` text,
	`label_created_at` text NOT NULL,
	`actual_shipment_at` text,
	`delivered_at` text,
	`voided_at` text,
	`scheduled_pickup_at` text,
	`actual_pickup_at` text,
	`end_of_day_manifest_id` text,
	`packed_from_location_id` text,
	`parent_lp_id` text,
	`external_reference` text,
	`created_by` text,
	FOREIGN KEY (`order_id`) REFERENCES `shipment_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shipments_order_idx` ON `shipments` (`order_id`);--> statement-breakpoint
CREATE INDEX `shipments_label_at_idx` ON `shipments` (`label_created_at`);--> statement-breakpoint
CREATE INDEX `shipments_tracking_idx` ON `shipments` (`tracking_number`);--> statement-breakpoint
CREATE INDEX `shipments_eod_idx` ON `shipments` (`end_of_day_manifest_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`ordered_quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`unit_cost` real NOT NULL,
	`pack_type` text DEFAULT 'Each' NOT NULL,
	`uom_quantity` integer DEFAULT 1 NOT NULL,
	`receiving_location_id` text,
	`lot_number` text,
	`expiry_date` text,
	`production_date` text,
	`lp_type_id` text,
	`lp_number` text,
	`damaged_quantity` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `po_lines_po_idx` ON `purchase_order_lines` (`purchase_order_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`vendor_name` text NOT NULL,
	`reference_number` text,
	`status` text NOT NULL,
	`po_type` text DEFAULT 'Purchase Order' NOT NULL,
	`total_quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`purchase_price` real NOT NULL,
	`expected_date` text,
	`received_at` text,
	`vendor_id` text,
	`po_date` text,
	`planned_receiving_date` text,
	`planned_arrival_date` text,
	`actual_arrival_date` text,
	`note` text,
	`completed_at` text,
	`cancelled_at` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `po_code_idx` ON `purchase_orders` (`code`);--> statement-breakpoint
CREATE INDEX `po_status_idx` ON `purchase_orders` (`status`);--> statement-breakpoint
CREATE INDEX `po_client_idx` ON `purchase_orders` (`client_id`);--> statement-breakpoint
CREATE INDEX `po_vendor_idx` ON `purchase_orders` (`vendor_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`master_id` integer NOT NULL,
	`type` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`purchase_order_id` text,
	`purchase_order_line_id` text,
	`work_order_id` text,
	`shipment_order_id` text,
	`return_order_id` text,
	`return_order_line_id` text,
	`product_id` text NOT NULL,
	`pack_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`uom_quantity` integer NOT NULL,
	`lot_number` text,
	`expiry_date` text,
	`production_date` text,
	`location_id` text NOT NULL,
	`lp_id` text,
	`parent_lp_id` text,
	`damage_reason` text,
	`damage_image_file_id` text,
	`customer_return_reason` text,
	`actual_return_reason` text,
	`sku_details_updated` integer DEFAULT false NOT NULL,
	`note` text,
	`line_note` text,
	`inventory_transaction_id` text,
	`received_by` text NOT NULL,
	`received_at` text NOT NULL,
	`cancelled_at` text,
	`cancelled_by` text
);
--> statement-breakpoint
CREATE INDEX `receipts_po_idx` ON `receipts` (`purchase_order_id`);--> statement-breakpoint
CREATE INDEX `receipts_at_idx` ON `receipts` (`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_master_idx` ON `receipts` (`master_id`);--> statement-breakpoint
CREATE INDEX `receipts_return_idx` ON `receipts` (`return_order_id`);--> statement-breakpoint
CREATE TABLE `return_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`return_order_id` text NOT NULL,
	`order_line_id` text,
	`product_id` text NOT NULL,
	`pack_type` text NOT NULL,
	`requested_qty` integer NOT NULL,
	`returned_qty` integer DEFAULT 0 NOT NULL,
	`customer_return_reason_id` text,
	`actual_return_reason_id` text,
	`disposition` text,
	`line_status` text DEFAULT 'Pending' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`return_order_id`) REFERENCES `return_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `return_lines_return_idx` ON `return_order_lines` (`return_order_id`);--> statement-breakpoint
CREATE TABLE `return_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`rma_code` text NOT NULL,
	`shipment_order_id` text,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`source` text DEFAULT 'RMA' NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`return_address_id` text,
	`from_country` text,
	`customer_name` text,
	`carrier_code` text,
	`carrier_service_name` text,
	`tracking_number` text,
	`return_label_shipment_id` text,
	`expected_return_date` text,
	`actual_return_date` text,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`shipment_order_id`) REFERENCES `shipment_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rma_code_idx` ON `return_orders` (`rma_code`);--> statement-breakpoint
CREATE INDEX `return_orders_so_idx` ON `return_orders` (`shipment_order_id`);--> statement-breakpoint
CREATE TABLE `allocation_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`wave_id` text,
	`wave_no` text NOT NULL,
	`wave_rule_name` text,
	`algorithm_name` text,
	`algorithm_rule_name` text,
	`shortage_product_id` text,
	`inventory_uom_qty` integer,
	`order_line_qty` integer,
	`explanation` text NOT NULL,
	`is_rolled_back` integer DEFAULT false NOT NULL,
	`run_by` text NOT NULL,
	`run_at` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `alloc_exc_wave_idx` ON `allocation_exceptions` (`wave_no`);--> statement-breakpoint
CREATE INDEX `alloc_exc_order_idx` ON `allocation_exceptions` (`order_id`);--> statement-breakpoint
CREATE TABLE `job_orders` (
	`job_id` text NOT NULL,
	`order_id` text NOT NULL,
	`tote_or_cell` text,
	PRIMARY KEY(`job_id`, `order_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `shipment_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_orders_order_idx` ON `job_orders` (`order_id`);--> statement-breakpoint
CREATE TABLE `job_types` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`allocation_algorithm_id` text,
	`template` text,
	`settings` text NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`location_conditions` text,
	`sku_conditions` text,
	`source_location_conditions` text,
	`destination_location_conditions` text,
	`lp_conditions` text,
	`product_conditions` text,
	`order_by` text DEFAULT '[{"field":"walkingPathPriority","dir":"asc"}]' NOT NULL,
	`group_by` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_types_code_idx` ON `job_types` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`priority` text DEFAULT 'None' NOT NULL,
	`assigned_to_user_id` text,
	`order_count` integer DEFAULT 0 NOT NULL,
	`unit_count` integer DEFAULT 0 NOT NULL,
	`completed_units` integer DEFAULT 0 NOT NULL,
	`wave_number` text,
	`rule_name` text,
	`completed_at` text,
	`job_type_id` text,
	`operation_type` text DEFAULT 'Picking' NOT NULL,
	`wave_id` text,
	`wave_rule_id` text,
	`count_plan_id` text,
	`work_order_id` text,
	`planned_start_at` text,
	`planned_end_at` text,
	`started_at` text,
	`label_status` text DEFAULT 'No Label' NOT NULL,
	`pick_list_status` text DEFAULT 'Not Printed' NOT NULL,
	`mobile_cart_id` text,
	`picking_zone` text,
	`is_resolution_job` integer DEFAULT false NOT NULL,
	`is_precartonization` integer DEFAULT false NOT NULL,
	`task_count` integer DEFAULT 0 NOT NULL,
	`completed_task_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_type_id`) REFERENCES `job_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_code_idx` ON `jobs` (`code`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`warehouse_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_wave_idx` ON `jobs` (`wave_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_no` integer NOT NULL,
	`job_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text,
	`task_type` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`priority` text DEFAULT 'None' NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`order_id` text,
	`order_line_id` text,
	`allocation_id` text,
	`work_order_id` text,
	`count_plan_id` text,
	`count_line_id` text,
	`product_id` text,
	`pack_type` text,
	`to_pack_type` text,
	`planned_qty` integer DEFAULT 0 NOT NULL,
	`actual_qty` integer DEFAULT 0 NOT NULL,
	`source_location_id` text,
	`source_lp_id` text,
	`target_location_id` text,
	`target_lp_id` text,
	`target_cart_id` text,
	`lot_number` text,
	`expiry_date` text,
	`production_date` text,
	`damage_reason` text,
	`replenishment_phase` text,
	`lp_swap` integer DEFAULT false NOT NULL,
	`lp_auto_removed` integer DEFAULT false NOT NULL,
	`pack_type_conversion_applied` integer DEFAULT false NOT NULL,
	`pick_short_status` text DEFAULT 'None' NOT NULL,
	`pack_short_status` text DEFAULT 'None' NOT NULL,
	`assignee_user_id` text,
	`executed_by_user_id` text,
	`planned_start_at` text,
	`planned_finish_at` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_job_idx` ON `tasks` (`job_id`);--> statement-breakpoint
CREATE INDEX `tasks_order_idx` ON `tasks` (`order_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`task_type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_no_idx` ON `tasks` (`task_no`);--> statement-breakpoint
CREATE TABLE `wave_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_seq` integer NOT NULL,
	`name` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`operation_type` text NOT NULL,
	`priority` text DEFAULT 'None' NOT NULL,
	`delete_if_not_started` integer DEFAULT false NOT NULL,
	`delete_method` text DEFAULT 'None' NOT NULL,
	`delete_time` text,
	`job_type_ids` text DEFAULT '[]' NOT NULL,
	`filters` text DEFAULT '[]' NOT NULL,
	`order_by` text DEFAULT '[]' NOT NULL,
	`schedule_days` text DEFAULT '[]' NOT NULL,
	`schedule_times` text DEFAULT '[]' NOT NULL,
	`assign_mode` text DEFAULT 'Pool' NOT NULL,
	`assignee_role_ids` text,
	`assignee_user_ids` text,
	`count_type` text,
	`lock_locations` integer DEFAULT false NOT NULL,
	`soft_allocation` integer DEFAULT false NOT NULL,
	`merge_rule_ids` text,
	`is_active` integer DEFAULT true NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`last_run_by` text,
	`last_wave_no` text,
	`next_run_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wave_rules_wh_idx` ON `wave_rules` (`warehouse_id`,`operation_type`);--> statement-breakpoint
CREATE TABLE `waves` (
	`id` text PRIMARY KEY NOT NULL,
	`wave_no` text NOT NULL,
	`wave_rule_id` text,
	`warehouse_id` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`orders_met` integer DEFAULT 0 NOT NULL,
	`shortage_orders` integer DEFAULT 0 NOT NULL,
	`jobs_created` integer DEFAULT 0 NOT NULL,
	`allocated_orders` integer DEFAULT 0 NOT NULL,
	`merged_orders` integer DEFAULT 0 NOT NULL,
	`message` text,
	`run_by` text NOT NULL,
	`run_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`wave_rule_id`) REFERENCES `wave_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waves_no_idx` ON `waves` (`wave_no`);--> statement-breakpoint
CREATE INDEX `waves_rule_idx` ON `waves` (`wave_rule_id`);--> statement-breakpoint
CREATE TABLE `count_line_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`line_id` text NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text NOT NULL,
	`lp_id` text,
	`lot_number` text,
	`expiry_date` text,
	`damage_reason` text,
	`pack_type` text NOT NULL,
	`system_qty` integer NOT NULL,
	`counted_qty` integer NOT NULL,
	`counted_by` text,
	`counted_at` text NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `count_plan_lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `count_entries_line_idx` ON `count_line_entries` (`line_id`);--> statement-breakpoint
CREATE TABLE `count_plan_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`location_id` text,
	`product_id` text,
	`lp_id` text,
	`job_id` text,
	`status` text DEFAULT 'Pending' NOT NULL,
	`initial_stock_qty` integer DEFAULT 0 NOT NULL,
	`counted_qty` integer,
	`approved_stock_qty` integer,
	`approved_count_qty` integer,
	`is_recount_line` integer DEFAULT false NOT NULL,
	`recount_of_line_id` text,
	`recounted` integer DEFAULT false NOT NULL,
	`count_user_id` text,
	`note` text,
	`started_at` text,
	`completed_at` text,
	`inventory_updated_at` text,
	`inventory_updated_by` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `count_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `count_lines_plan_idx` ON `count_plan_lines` (`plan_id`);--> statement-breakpoint
CREATE INDEX `count_lines_location_idx` ON `count_plan_lines` (`location_id`);--> statement-breakpoint
CREATE TABLE `count_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`description` text,
	`scheduled_at` text NOT NULL,
	`lock_locations` integer DEFAULT false NOT NULL,
	`count_type` text NOT NULL,
	`operation_type` text DEFAULT 'Cycle Count' NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`is_ai` integer DEFAULT false NOT NULL,
	`wave_rule_id` text,
	`started_at` text,
	`completed_at` text,
	`inventory_updated_at` text,
	`inventory_updated_by` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `count_plan_code_idx` ON `count_plans` (`warehouse_id`,`code`);--> statement-breakpoint
CREATE TABLE `kit_inventory_stats` (
	`kit_product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`pending_order_qty` integer NOT NULL,
	`net_kitting_capacity` integer NOT NULL,
	`total_inventory_capacity` integer NOT NULL,
	`current_inventory_qty` integer NOT NULL,
	`required_kitting_qty` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`kit_product_id`, `warehouse_id`)
);
--> statement-breakpoint
CREATE TABLE `work_order_components` (
	`id` text PRIMARY KEY NOT NULL,
	`work_order_id` text NOT NULL,
	`component_product_id` text NOT NULL,
	`component_qty` integer NOT NULL,
	`total_qty` integer NOT NULL,
	`pack_type` text DEFAULT 'Each' NOT NULL,
	`location_id` text,
	`lp_id` text,
	`lot_number` text,
	`expiry_date` text,
	`production_date` text,
	`allocated_qty` integer DEFAULT 0 NOT NULL,
	`picked_qty` integer DEFAULT 0 NOT NULL,
	`consumed_qty` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`work_order_id`) REFERENCES `work_orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wo_components_wo_idx` ON `work_order_components` (`work_order_id`);--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`type` text NOT NULL,
	`operation_type` text DEFAULT 'Kitting' NOT NULL,
	`build_for` text DEFAULT 'Stock' NOT NULL,
	`shipment_order_id` text,
	`kit_product_id` text NOT NULL,
	`requested_qty` integer NOT NULL,
	`processed_qty` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`extra_note` text,
	`kitting_instructions` text,
	`planned_start_at` text,
	`planned_finish_at` text,
	`actual_start_at` text,
	`actual_finish_at` text,
	`cancelled_at` text,
	`job_id` text,
	`output_location_id` text,
	`output_lot` text,
	`output_expiry` text,
	`custom_fields` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kit_product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_order_code_idx` ON `work_orders` (`code`);--> statement-breakpoint
CREATE INDEX `work_orders_status_idx` ON `work_orders` (`warehouse_id`,`status`);--> statement-breakpoint
CREATE TABLE `algorithm_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`algorithm_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`conditions` text NOT NULL,
	`inventory_conditions` text,
	`actions` text,
	`order_by` text NOT NULL,
	FOREIGN KEY (`algorithm_id`) REFERENCES `algorithms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `algorithm_rules_algo_idx` ON `algorithm_rules` (`algorithm_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `algorithms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`is_dynamic_replenishment` integer DEFAULT false NOT NULL,
	`enforce_suggested_locations` integer DEFAULT false NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `algorithms_name_idx` ON `algorithms` (`warehouse_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `rate_shopping_preset_services` (
	`preset_id` text NOT NULL,
	`carrier_service_id` text NOT NULL,
	`is_selected` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`preset_id`, `carrier_service_id`),
	FOREIGN KEY (`preset_id`) REFERENCES `rate_shopping_presets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`carrier_service_id`) REFERENCES `carrier_services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rate_shopping_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`client_id` text NOT NULL,
	`method` text NOT NULL,
	`transit_days` integer,
	`show_errors` integer DEFAULT false NOT NULL,
	`use_all_services` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`matched` integer NOT NULL,
	`actions_applied` text,
	`block_type` text,
	`error` text,
	`at` text NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wf_runs_entity_idx` ON `workflow_runs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`trigger` text NOT NULL,
	`warehouse_id` text,
	`client_id` text,
	`match` text DEFAULT 'All' NOT NULL,
	`conditions` text DEFAULT '[]' NOT NULL,
	`actions` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`stop_processing` integer DEFAULT false NOT NULL,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflows_trigger_idx` ON `workflows` (`trigger`,`sequence`);--> statement-breakpoint
CREATE TABLE `carrier_call_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`step` text NOT NULL,
	`connection_id` text NOT NULL,
	`order_id` text,
	`shipment_id` text,
	`tracking_number` text,
	`destination_type` text,
	`status` text NOT NULL,
	`http_code` integer NOT NULL,
	`error` text,
	`response_ms` integer NOT NULL,
	`service_name` text,
	`warehouse_id` text NOT NULL,
	`client_id` text,
	`user_id` text,
	`source` text,
	`label_type` text,
	`rate_shopping_name` text,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `carrier_logs_step_idx` ON `carrier_call_logs` (`step`,`at`);--> statement-breakpoint
CREATE INDEX `carrier_logs_order_idx` ON `carrier_call_logs` (`order_id`);--> statement-breakpoint
CREATE TABLE `carrier_connection_clients` (
	`connection_id` text NOT NULL,
	`client_id` text NOT NULL,
	`markup_type` text,
	`markup_amount` real,
	`has_access` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`connection_id`, `client_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `carrier_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `carrier_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`setup_name` text NOT NULL,
	`account_prefix` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`environment` text DEFAULT 'Test' NOT NULL,
	`credentials_enc` text,
	`payor_account_number` text,
	`is_active` integer DEFAULT true NOT NULL,
	`all_clients` integer DEFAULT true NOT NULL,
	`all_services` integer DEFAULT true NOT NULL,
	`all_packages` integer DEFAULT true NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `carrier_conn_wh_idx` ON `carrier_connections` (`warehouse_id`);--> statement-breakpoint
CREATE TABLE `carrier_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `carrier_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carrier_package_idx` ON `carrier_packages` (`connection_id`,`code`);--> statement-breakpoint
CREATE TABLE `carrier_services` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`carrier_code` text NOT NULL,
	`service_code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`transit_days` integer NOT NULL,
	`is_international` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `carrier_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carrier_service_idx` ON `carrier_services` (`connection_id`,`service_code`);--> statement-breakpoint
CREATE TABLE `carrier_third_party_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`account_number` text NOT NULL,
	`billing_country` text NOT NULL,
	`billing_zip` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `carrier_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `carrier_3p_conn_idx` ON `carrier_third_party_accounts` (`connection_id`);--> statement-breakpoint
CREATE TABLE `channel_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`store_name` text NOT NULL,
	`client_id` text NOT NULL,
	`distribution` text DEFAULT 'Custom App' NOT NULL,
	`auth_method` text DEFAULT 'Access Token' NOT NULL,
	`credentials_enc` text,
	`api_version` text DEFAULT 'GraphQL' NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channel_conn_client_idx` ON `channel_connections` (`client_id`);--> statement-breakpoint
CREATE TABLE `channel_location_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`channel_location_id` text NOT NULL,
	`channel_location_name` text NOT NULL,
	`warehouse_id` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_loc_map_idx` ON `channel_location_mappings` (`connection_id`,`channel_location_id`);--> statement-breakpoint
CREATE TABLE `channel_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`interval_minutes` integer NOT NULL,
	`job_status` text DEFAULT 'Waiting For Next' NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`last_success_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_method_idx` ON `channel_methods` (`connection_id`,`method`);--> statement-breakpoint
CREATE TABLE `channel_missing_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`order_code` text NOT NULL,
	`channel_order_number` text NOT NULL,
	`order_date` text NOT NULL,
	`last_updated` text NOT NULL,
	`last_error_code` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'Error' NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `channel_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `channel_missing_conn_idx` ON `channel_missing_orders` (`connection_id`,`status`);--> statement-breakpoint
CREATE TABLE `channel_run_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`success` integer NOT NULL,
	`properties` text NOT NULL,
	`error_message` text,
	`store_order_number` text,
	`seller_sku` text,
	`qty` integer,
	`at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `channel_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_run_items_run_idx` ON `channel_run_items` (`run_id`);--> statement-breakpoint
CREATE TABLE `channel_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`method_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`method_id`) REFERENCES `channel_methods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `channel_runs_conn_idx` ON `channel_runs` (`connection_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `billing_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`client_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`calc_start_date` text NOT NULL,
	`frequency` text NOT NULL,
	`approval_status` text DEFAULT 'Draft' NOT NULL,
	`last_calculated_at` text,
	`next_period_start` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `billing_contracts_client_idx` ON `billing_contracts` (`client_id`,`warehouse_id`);--> statement-breakpoint
CREATE TABLE `billing_fee_tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_id` text NOT NULL,
	`from_qty` real,
	`to_qty` real,
	`rate` real NOT NULL,
	`percentage` real,
	FOREIGN KEY (`fee_id`) REFERENCES `billing_fees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_tiers_fee_idx` ON `billing_fee_tiers` (`fee_id`);--> statement-breakpoint
CREATE TABLE `billing_fees` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`name` text NOT NULL,
	`operation_type` text NOT NULL,
	`calculation_type` text,
	`fee_by` text NOT NULL,
	`charge_by` text NOT NULL,
	`vas_type_id` text,
	`use_min_price` integer DEFAULT false NOT NULL,
	`min_price` real,
	`use_max_price` integer DEFAULT false NOT NULL,
	`max_price` real,
	`split_day` integer,
	`standard_rate` real,
	`alternate_rate` real,
	`conditions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `billing_contracts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_fees_contract_idx` ON `billing_fees` (`contract_id`);--> statement-breakpoint
CREATE TABLE `billing_report_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`fee_id` text,
	`fee_name` text NOT NULL,
	`operation_type` text NOT NULL,
	`fee_by` text NOT NULL,
	`charge_by` text NOT NULL,
	`sku` text,
	`from_qty` real,
	`to_qty` real,
	`unit_price` real NOT NULL,
	`quantity` real NOT NULL,
	`total_price` real NOT NULL,
	`min_max_adjustment` real DEFAULT 0 NOT NULL,
	`adjusted_price` real NOT NULL,
	`activity_date` text,
	`reference_number` text,
	`lp_number` text,
	`integration_status` text DEFAULT 'Not Sent' NOT NULL,
	`note` text,
	`is_detail` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `billing_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_lines_report_idx` ON `billing_report_lines` (`report_id`);--> statement-breakpoint
CREATE TABLE `billing_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`bill_number` text NOT NULL,
	`calc_status` text NOT NULL,
	`client_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`calculated_at` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`bill_status` text DEFAULT 'Draft' NOT NULL,
	`total_price` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`exported_to_integration` integer DEFAULT false NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `billing_contracts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_number_idx` ON `billing_reports` (`bill_number`);--> statement-breakpoint
CREATE INDEX `billing_reports_contract_idx` ON `billing_reports` (`contract_id`);--> statement-breakpoint
CREATE TABLE `vas_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`vas_type_id` text NOT NULL,
	`operation_at` text NOT NULL,
	`calculation_type` text NOT NULL,
	`value` real NOT NULL,
	`note` text,
	`reference_order_type` text,
	`reference_number` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vas_ops_client_idx` ON `vas_operations` (`client_id`,`operation_at`);