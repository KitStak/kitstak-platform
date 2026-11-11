CREATE TABLE "apps" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"settings" jsonb,
	"activated_at" text,
	"activated_by" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"detail" text,
	"at" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"outcome" text DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" text PRIMARY KEY DEFAULT 'company' NOT NULL,
	"display_name" text NOT NULL,
	"full_name" text NOT NULL,
	"logo_file_id" text,
	"defaults" jsonb,
	"password_policy" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"read_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'Operation' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"restrictions" jsonb DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"grid_key" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"pinned_fields" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_clients" (
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	CONSTRAINT "user_clients_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "user_grid_prefs" (
	"user_id" text NOT NULL,
	"grid_key" text NOT NULL,
	"prefs" jsonb NOT NULL,
	CONSTRAINT "user_grid_prefs_user_id_grid_key_pk" PRIMARY KEY("user_id","grid_key")
);
--> statement-breakpoint
CREATE TABLE "user_printers" (
	"user_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"barcode_printer" text,
	"laser_printer" text,
	CONSTRAINT "user_printers_user_id_warehouse_id_pk" PRIMARY KEY("user_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_version" integer NOT NULL,
	"created_at" text NOT NULL,
	"last_seen_at" text,
	"expires_at" text NOT NULL,
	"revoked_at" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_warehouses" (
	"user_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	CONSTRAINT "user_warehouses_user_id_warehouse_id_pk" PRIMARY KEY("user_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_name" text,
	"last_name" text,
	"user_type" text DEFAULT 'Operation' NOT NULL,
	"is_api_user" boolean DEFAULT false NOT NULL,
	"all_clients" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" text,
	"last_login_at" text,
	"password_changed_at" text,
	"preferences" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text,
	"usage_type" text DEFAULT 'Shipping' NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"state" text,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"phone" text,
	"email" text,
	"address_type" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"phone" text NOT NULL,
	"billing_plan" text NOT NULL,
	"status" text NOT NULL,
	"official_name" text,
	"tax_id" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retailers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"business_name" text,
	"logo_file_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"create_case_labels" boolean DEFAULT false NOT NULL,
	"case_label_print_qty" integer DEFAULT 1 NOT NULL,
	"lp_label_print_qty" integer DEFAULT 1 NOT NULL,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"display_name" text NOT NULL,
	"vendor_name" text NOT NULL,
	"use_ship_as_billing" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"address_line2" text,
	"postal_code" text,
	"country" text DEFAULT 'United States' NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"email" text,
	"type" text DEFAULT 'Internal' NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"day_shift_start" text DEFAULT '08:00' NOT NULL,
	"day_shift_end" text DEFAULT '17:00' NOT NULL,
	"default_dimension_unit" text DEFAULT 'Inch' NOT NULL,
	"default_weight_unit" text DEFAULT 'Pound' NOT NULL,
	"use_lp_dims_for_putaway" boolean DEFAULT false NOT NULL,
	"default_receiving_location_id" text,
	"default_ship_location_id" text,
	"default_return_location_id" text,
	"mandatory_adjustment_reason" boolean DEFAULT true NOT NULL,
	"mandatory_count_reason" boolean DEFAULT false NOT NULL,
	"mobile_auto_logout_minutes" integer DEFAULT 30,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"document_type" text NOT NULL,
	"file_id" text NOT NULL,
	"uploaded_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"grid_key" text,
	"query" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"row_count" integer,
	"error_message" text,
	"file_id" text,
	"user_id" text NOT NULL,
	"created_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_code" text,
	"parent_entity_type" text,
	"parent_entity_id" text,
	"type" text NOT NULL,
	"field" text,
	"field_label" text,
	"from_value" text,
	"to_value" text,
	"message" text NOT NULL,
	"user_id" text,
	"source" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_sequences" (
	"key" text NOT NULL,
	"warehouse_id" text DEFAULT '*' NOT NULL,
	"prefix" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"auto_generate" boolean DEFAULT true NOT NULL,
	CONSTRAINT "code_sequences_key_warehouse_id_pk" PRIMARY KEY("key","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"slot" text NOT NULL,
	"name" text NOT NULL,
	"options" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"body" text NOT NULL,
	"user_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"tag_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	CONSTRAINT "entity_tags_tag_id_entity_type_entity_id_pk" PRIMARY KEY("tag_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"owner_entity_type" text,
	"owner_entity_id" text,
	"uploaded_by" text,
	"created_at" text NOT NULL,
	"expires_at" text
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"import_key" text NOT NULL,
	"status" text NOT NULL,
	"master_row_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"file_id" text NOT NULL,
	"error_file_id" text,
	"uploaded_by" text NOT NULL,
	"created_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"success" boolean NOT NULL,
	"data" text NOT NULL,
	"message" text,
	"entity_id" text
);
--> statement-breakpoint
CREATE TABLE "lookup_values" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"client_id" text,
	"warehouse_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"meta" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printout_template_clients" (
	"template_id" text NOT NULL,
	"client_id" text NOT NULL,
	"has_access" boolean DEFAULT true NOT NULL,
	CONSTRAINT "printout_template_clients_template_id_client_id_pk" PRIMARY KEY("template_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "printout_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"type_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"records_per_page" text NOT NULL,
	"print_mode" text NOT NULL,
	"printer_type" text NOT NULL,
	"base_template" text NOT NULL,
	"layout" jsonb,
	"options" jsonb,
	"all_clients" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screen_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"name" text NOT NULL,
	"operation_type" text DEFAULT 'Receiving' NOT NULL,
	"screen_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"conditions" jsonb,
	"config" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"scope" text DEFAULT 'any' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kit_components" (
	"id" text PRIMARY KEY NOT NULL,
	"kit_product_id" text NOT NULL,
	"component_product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"pack_type" text DEFAULT 'Each' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_barcodes" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"pack_type_id" text NOT NULL,
	"barcode" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_channel_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"channel_connection_id" text NOT NULL,
	"warehouse_id" text,
	"static_qty" integer,
	"reserve_qty" integer,
	"allocation_pct" double precision,
	"synced_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_connection_id" text NOT NULL,
	"client_id" text NOT NULL,
	"product_id" text,
	"seller_sku" text NOT NULL,
	"channel_product_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"store_price" double precision,
	"image_url" text,
	"never_sync" boolean DEFAULT false NOT NULL,
	"linked_at" text,
	"last_synced_qty" integer,
	"dismissed_suggestion_sku" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_pack_types" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"pack_type" text NOT NULL,
	"kind" text NOT NULL,
	"parent_pack_type_id" text,
	"child_qty" integer,
	"uom_qty" integer DEFAULT 1 NOT NULL,
	"dimension_unit" text DEFAULT 'Inch' NOT NULL,
	"length" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 0 NOT NULL,
	"height" double precision DEFAULT 0 NOT NULL,
	"volume_unit" text DEFAULT 'Cubic Inch' NOT NULL,
	"volume" double precision DEFAULT 0 NOT NULL,
	"weight_unit" text DEFAULT 'Pound' NOT NULL,
	"weight" double precision DEFAULT 0 NOT NULL,
	"use_ship_package_id" text,
	"use_own_box" boolean DEFAULT false NOT NULL,
	"use_primary_barcodes" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_replenishment_levels" (
	"product_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"min_level" integer NOT NULL,
	"max_level" integer NOT NULL,
	CONSTRAINT "product_replenishment_levels_product_id_warehouse_id_pk" PRIMARY KEY("product_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"sku" text NOT NULL,
	"barcode" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"uom" text DEFAULT 'Each' NOT NULL,
	"weight_oz" double precision NOT NULL,
	"length_in" double precision NOT NULL,
	"width_in" double precision NOT NULL,
	"height_in" double precision NOT NULL,
	"price" double precision NOT NULL,
	"is_kit" boolean DEFAULT false NOT NULL,
	"is_fragile" boolean DEFAULT false NOT NULL,
	"is_hazmat" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"reorder_point" integer DEFAULT 0 NOT NULL,
	"product_category" text DEFAULT 'Product' NOT NULL,
	"kit_type" text,
	"description" text,
	"image_url" text,
	"product_type_id" text,
	"product_group_id" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"purchase_price" double precision DEFAULT 0 NOT NULL,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"min_safety_stock" integer DEFAULT 0 NOT NULL,
	"fnsku" text,
	"is_digital" boolean DEFAULT false NOT NULL,
	"is_foldable" boolean DEFAULT false NOT NULL,
	"is_oversized" boolean DEFAULT false NOT NULL,
	"is_insert" boolean DEFAULT false NOT NULL,
	"is_stackable" boolean DEFAULT false NOT NULL,
	"is_poster" boolean DEFAULT false NOT NULL,
	"is_liquid" boolean DEFAULT false NOT NULL,
	"is_non_returnable" boolean DEFAULT false NOT NULL,
	"packing_instructions" text,
	"return_instructions" text,
	"use_ship_package_id" text,
	"customs" jsonb,
	"hazmat" jsonb,
	"track_expiry" boolean DEFAULT false NOT NULL,
	"expiry_receiving_only" boolean DEFAULT false NOT NULL,
	"expiry_format" text,
	"expiry_scan_method" text,
	"shelf_life_days" integer,
	"track_lot" boolean DEFAULT false NOT NULL,
	"lot_receiving_only" boolean DEFAULT false NOT NULL,
	"auto_create_lot" boolean DEFAULT false NOT NULL,
	"lot_regex" text,
	"lot_scan_method" text,
	"track_production_date" boolean DEFAULT false NOT NULL,
	"production_receiving_only" boolean DEFAULT false NOT NULL,
	"production_format" text,
	"production_scan_method" text,
	"replenishment_strategy" text DEFAULT 'Global' NOT NULL,
	"replenishment_min" integer DEFAULT 0 NOT NULL,
	"replenishment_max" integer DEFAULT 0 NOT NULL,
	"track_serial" boolean DEFAULT false NOT NULL,
	"track_secondary_serial" boolean DEFAULT false NOT NULL,
	"serial_method" text,
	"skip_serial_scan" boolean DEFAULT false NOT NULL,
	"serial_regex" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"primary_serial" text NOT NULL,
	"secondary_serial" text,
	"status" text NOT NULL,
	"inventory_id" text,
	"receipt_id" text,
	"order_line_id" text,
	"shipment_id" text,
	"entry_at" text NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serial_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"serial_id" text NOT NULL,
	"inventory_transaction_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_plates" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"lp_type_id" text NOT NULL,
	"location_id" text,
	"parent_lp_id" text,
	"original_number" text,
	"alternate_barcode" text,
	"is_sscc18" boolean DEFAULT false NOT NULL,
	"client_id" text,
	"length" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 0 NOT NULL,
	"height" double precision DEFAULT 0 NOT NULL,
	"weight" double precision DEFAULT 0 NOT NULL,
	"actual_volume" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Empty' NOT NULL,
	"label_printed_at" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_lp_capacity" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"lp_type_id" text NOT NULL,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"max_qty" integer DEFAULT 0 NOT NULL,
	"client_id" text,
	"product_id" text
);
--> statement-breakpoint
CREATE TABLE "location_product_capacity" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"client_id" text NOT NULL,
	"product_id" text NOT NULL,
	"pack_type" text NOT NULL,
	"min_qty" integer DEFAULT 0 NOT NULL,
	"max_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"code" text NOT NULL,
	"zone" text NOT NULL,
	"aisle" text NOT NULL,
	"bay" text NOT NULL,
	"level" text NOT NULL,
	"type" text NOT NULL,
	"capacity_units" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"barcode" text,
	"display_member" text,
	"location_group_id" text,
	"location_zone_id" text,
	"location_type" text,
	"area_type" text,
	"replenishment_type" text,
	"walking_path_priority" integer DEFAULT 0 NOT NULL,
	"capacity_type" text DEFAULT 'None' NOT NULL,
	"max_capacity_qty" integer DEFAULT 0 NOT NULL,
	"max_sku_qty" integer,
	"mezzanine" text,
	"rack" text,
	"column" integer DEFAULT 0 NOT NULL,
	"position" text,
	"dimension_unit" text DEFAULT 'Inch' NOT NULL,
	"height" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 0 NOT NULL,
	"length" double precision DEFAULT 0 NOT NULL,
	"volume_unit" text DEFAULT 'Cubic Inch' NOT NULL,
	"volume" double precision DEFAULT 0 NOT NULL,
	"abc_code" text DEFAULT 'None' NOT NULL,
	"single_client" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"dedicated_client_id" text,
	"print_apply_on_packing" boolean DEFAULT false NOT NULL,
	"color_code" text,
	"prevent_allocation" boolean DEFAULT false NOT NULL,
	"prevent_inventory_sync" boolean DEFAULT false NOT NULL,
	"only_one_lot" boolean DEFAULT false NOT NULL,
	"only_damaged" boolean DEFAULT false NOT NULL,
	"only_one_expiry" boolean DEFAULT false NOT NULL,
	"only_one_sku" boolean DEFAULT false NOT NULL,
	"only_one_lp" boolean DEFAULT false NOT NULL,
	"only_one_production_date" boolean DEFAULT false NOT NULL,
	"auto_remove_lp_after_replenishment" boolean DEFAULT false NOT NULL,
	"auto_remove_lp_after_transfer" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lp_types" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"number_prefix" text NOT NULL,
	"number_length" integer NOT NULL,
	"length" double precision DEFAULT 0 NOT NULL,
	"width" double precision DEFAULT 0 NOT NULL,
	"height" double precision DEFAULT 0 NOT NULL,
	"dimension_unit" text DEFAULT 'Inch' NOT NULL,
	"weight_unit" text DEFAULT 'Ounce' NOT NULL,
	"volume_unit" text DEFAULT 'Cubic Inch' NOT NULL,
	"empty_weight" double precision DEFAULT 0 NOT NULL,
	"max_weight" double precision DEFAULT 0 NOT NULL,
	"max_volume" double precision DEFAULT 0 NOT NULL,
	"only_one_expiry" boolean DEFAULT false NOT NULL,
	"only_one_production_date" boolean DEFAULT false NOT NULL,
	"only_one_lot" boolean DEFAULT false NOT NULL,
	"only_one_sku" boolean DEFAULT false NOT NULL,
	"only_one_client" boolean DEFAULT false NOT NULL,
	"only_one_order" boolean DEFAULT false NOT NULL,
	"only_one_job" boolean DEFAULT false NOT NULL,
	"suitable_for_parent_lp" boolean DEFAULT false NOT NULL,
	"use_for_ai_job" boolean DEFAULT false NOT NULL,
	"next_sequence" integer DEFAULT 1 NOT NULL,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_cart_cells" (
	"id" text PRIMARY KEY NOT NULL,
	"cart_id" text NOT NULL,
	"level" integer NOT NULL,
	"column" integer NOT NULL,
	"barcode" text NOT NULL,
	"order_id" text
);
--> statement-breakpoint
CREATE TABLE "mobile_carts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"description" text,
	"cart_type_id" text NOT NULL,
	"levels" integer NOT NULL,
	"columns" integer NOT NULL,
	"operation_type" text DEFAULT 'Picking' NOT NULL,
	"allow_multiple_job" boolean DEFAULT false NOT NULL,
	"is_dynamic" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'Available' NOT NULL,
	"current_job_id" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_package_clients" (
	"package_id" text NOT NULL,
	"client_id" text NOT NULL,
	"has_access" boolean DEFAULT true NOT NULL,
	CONSTRAINT "shipment_package_clients_package_id_client_id_pk" PRIMARY KEY("package_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"weight_unit" text DEFAULT 'Pound' NOT NULL,
	"empty_weight" double precision DEFAULT 0 NOT NULL,
	"max_weight" double precision,
	"dimension_unit" text DEFAULT 'Inch' NOT NULL,
	"length" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"volume_unit" text DEFAULT 'Cubic Inch' NOT NULL,
	"max_volume" double precision,
	"currency" text DEFAULT 'USD' NOT NULL,
	"purchase_price" double precision DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"all_clients" boolean DEFAULT true NOT NULL,
	"track_inventory" boolean DEFAULT false NOT NULL,
	"inventory_client_id" text,
	"inventory_product_id" text,
	"reduction_rule" text,
	"reduction_location_id" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lot_number" text,
	"on_hand" integer NOT NULL,
	"allocated" integer DEFAULT 0 NOT NULL,
	"damaged" integer DEFAULT 0 NOT NULL,
	"received_at" text NOT NULL,
	"bucket_key" text NOT NULL,
	"client_id" text,
	"lp_id" text,
	"status" text DEFAULT 'Stock' NOT NULL,
	"pack_type" text DEFAULT 'Each' NOT NULL,
	"expiry_date" text,
	"production_date" text,
	"damage_reason" text,
	"po_number" text,
	"mobile_cart_id" text,
	"updated_at" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"inventory_id" text NOT NULL,
	"order_id" text,
	"order_line_id" text,
	"work_order_id" text,
	"work_order_component_id" text,
	"job_id" text,
	"task_id" text,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'Allocated' NOT NULL,
	"algorithm_id" text,
	"rule_name" text,
	"wave_id" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_at" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lp_id" text,
	"parent_lp_id" text,
	"lot_number" text,
	"expiry_date" text,
	"production_date" text,
	"damage_reason" text,
	"status" text NOT NULL,
	"pack_type" text NOT NULL,
	"uom_qty" integer NOT NULL,
	"pack_qty" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"product_id" text NOT NULL,
	"from_inventory_id" text,
	"to_inventory_id" text,
	"from_location_id" text,
	"to_location_id" text,
	"from_lp_id" text,
	"to_lp_id" text,
	"from_parent_lp_id" text,
	"to_parent_lp_id" text,
	"from_status" text,
	"to_status" text,
	"from_pack_type" text,
	"to_pack_type" text,
	"from_lot" text,
	"to_lot" text,
	"from_expiry" text,
	"to_expiry" text,
	"from_production_date" text,
	"to_production_date" text,
	"from_damage_reason" text,
	"to_damage_reason" text,
	"uom_qty" integer NOT NULL,
	"pack_qty" integer NOT NULL,
	"adjustment_reason_id" text,
	"order_id" text,
	"order_line_id" text,
	"purchase_order_id" text,
	"receipt_id" text,
	"work_order_id" text,
	"count_plan_id" text,
	"return_order_id" text,
	"job_id" text,
	"task_id" text,
	"shipment_id" text,
	"algorithm_name" text,
	"algorithm_rule_name" text,
	"note" text,
	"user_id" text,
	"source" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missing_log" (
	"id" text PRIMARY KEY NOT NULL,
	"wave_no" text,
	"job_id" text,
	"task_id" text,
	"order_id" text,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lp_id" text,
	"pack_type" text NOT NULL,
	"missing_qty" integer NOT NULL,
	"inventory_qty" integer NOT NULL,
	"is_retain" boolean DEFAULT false NOT NULL,
	"notes" text,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"entered_by" text NOT NULL,
	"entered_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line_shortages" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"reason" text NOT NULL,
	"missing_triggered" boolean DEFAULT false NOT NULL,
	"shortage_qty" integer NOT NULL,
	"free_qty" integer NOT NULL,
	"damaged_qty" integer NOT NULL,
	"on_hand_qty" integer NOT NULL,
	"last_trial_at" text NOT NULL,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"picked_quantity" integer DEFAULT 0 NOT NULL,
	"packed_quantity" integer DEFAULT 0 NOT NULL,
	"unit_price" double precision NOT NULL,
	"pack_type" text DEFAULT 'Each' NOT NULL,
	"uom_ratio" integer DEFAULT 1 NOT NULL,
	"allocated_quantity" integer DEFAULT 0 NOT NULL,
	"cancelled_quantity" integer DEFAULT 0 NOT NULL,
	"sorted_quantity" integer DEFAULT 0 NOT NULL,
	"shipped_quantity" integer DEFAULT 0 NOT NULL,
	"loaded_quantity" integer DEFAULT 0 NOT NULL,
	"lot_number" text,
	"expiry_date" text,
	"production_date" text,
	"damage_reason" text,
	"pinned_location_id" text,
	"pinned_lp_id" text,
	"line_note1" text,
	"line_note2" text,
	"line_note3" text,
	"kit_product_id" text,
	"original_order_code" text,
	"store_update_notes" text,
	"is_store_updated" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"channel" text NOT NULL,
	"store_name" text,
	"store_order_number" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"ship_address" text NOT NULL,
	"ship_city" text NOT NULL,
	"ship_state" text NOT NULL,
	"ship_zip" text NOT NULL,
	"ship_country" text DEFAULT 'United States' NOT NULL,
	"status" text NOT NULL,
	"order_type" text DEFAULT 'D2C' NOT NULL,
	"priority" text DEFAULT 'None' NOT NULL,
	"carrier" text,
	"shipping_service" text,
	"tracking_number" text,
	"total_quantity" integer NOT NULL,
	"total_weight_oz" double precision NOT NULL,
	"sales_price" double precision NOT NULL,
	"job_id" text,
	"order_date" text NOT NULL,
	"expected_ship_date" text,
	"shipped_at" text,
	"delivered_at" text,
	"note" text,
	"order_type_id" text,
	"priority_rank" integer DEFAULT 0 NOT NULL,
	"customer_id" text,
	"customer_first_name" text,
	"customer_last_name" text,
	"customer_phone" text,
	"company_name" text,
	"ship_address2" text,
	"address_type" text,
	"skip_address_verification" boolean DEFAULT false NOT NULL,
	"address_verification_status" text DEFAULT 'Unverified' NOT NULL,
	"address_verification_notes" jsonb,
	"tax_type" text,
	"tax_id" text,
	"use_ship_as_billing" boolean DEFAULT true NOT NULL,
	"billing_address" jsonb,
	"expected_delivery_date" text,
	"carrier_expected_delivery_date" text,
	"scheduled_pickup_date" text,
	"scheduled_shipment_date" text,
	"actual_pickup_date" text,
	"cancelled_at" text,
	"cancel_reason_id" text,
	"carrier_connection_id" text,
	"carrier_service_id" text,
	"rate_shopping_preset_id" text,
	"shipping_charges_billing_type" text,
	"tax_duties_billing_type" text,
	"shipping_account_number" text,
	"tax_duties_account_number" text,
	"packing_instructions" text,
	"shipment_package_id" text,
	"total_shipping_cost" double precision DEFAULT 0 NOT NULL,
	"rate" double precision DEFAULT 0 NOT NULL,
	"discount" double precision DEFAULT 0 NOT NULL,
	"reason_for_export" text,
	"return_address_id" text,
	"return_carrier_service_id" text,
	"return_shipping_cost" double precision,
	"return_tracking_numbers" jsonb,
	"tracking_numbers" jsonb,
	"extra_note1" text,
	"extra_note2" text,
	"extra_note3" text,
	"extra_note4" text,
	"extra_note5" text,
	"client_reference_code" text,
	"fraud" text,
	"packing_warning_type_id" text,
	"is_gift" boolean DEFAULT false NOT NULL,
	"gift_note" text,
	"order_code_grouping_ref" text,
	"retailer_id" text,
	"bol" text,
	"pro" text,
	"retailer_po" text,
	"dept" text,
	"mark_for" text,
	"retailer_customer_account" text,
	"is_ucc_label_generated" boolean DEFAULT false NOT NULL,
	"is_back_order" boolean DEFAULT false NOT NULL,
	"master_order_id" text,
	"merged_into_order_id" text,
	"is_merged" boolean DEFAULT false NOT NULL,
	"pick_short_status" text DEFAULT 'None' NOT NULL,
	"pack_short_status" text DEFAULT 'None' NOT NULL,
	"pick_list_printed" boolean DEFAULT false NOT NULL,
	"is_auto_ship" boolean DEFAULT false NOT NULL,
	"is_prime" boolean DEFAULT false NOT NULL,
	"channel_connection_id" text,
	"channel_payment_status" text,
	"requested_shipping_option" text,
	"workflow_blocked" text DEFAULT 'None' NOT NULL,
	"deleted_at" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "end_of_day_manifests" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouse_id" text NOT NULL,
	"carrier_connection_id" text NOT NULL,
	"carrier_prefix" text NOT NULL,
	"carrier_code" text NOT NULL,
	"ship_date" text NOT NULL,
	"close_date" text,
	"is_printed" boolean DEFAULT false NOT NULL,
	"total_packages" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"report_file_id" text,
	"sequence" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"product_id" text NOT NULL,
	"pack_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"lot_number" text,
	"expiry_date" text,
	"serial_number_id" text
);
--> statement-breakpoint
CREATE TABLE "shipment_plan_orders" (
	"plan_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"added_at" text NOT NULL,
	CONSTRAINT "shipment_plan_orders_plan_id_order_id_pk" PRIMARY KEY("plan_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "shipment_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text,
	"carrier_connection_id" text,
	"truck_plate_number" text,
	"loading_gate_location_id" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"planned_shipment_at" text,
	"actual_shipment_at" text,
	"loading_started_at" text,
	"loading_completed_at" text,
	"truck_departed_at" text,
	"expected_total_volume" double precision DEFAULT 0 NOT NULL,
	"expected_total_weight" double precision DEFAULT 0 NOT NULL,
	"prevent_lpn_edit_during_loading" boolean DEFAULT false NOT NULL,
	"note" text,
	"customer_id" text,
	"customer_address_id" text,
	"retailer_id" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"carrier_connection_id" text,
	"carrier_code" text NOT NULL,
	"carrier_service_id" text,
	"service_name" text NOT NULL,
	"rate_shopping_preset_id" text,
	"is_rate_shopped" boolean DEFAULT false NOT NULL,
	"label_type" text DEFAULT 'Shipping Label' NOT NULL,
	"label_status" text DEFAULT 'Active' NOT NULL,
	"label_format" text DEFAULT 'PDF' NOT NULL,
	"label_file_id" text,
	"master_tracking_number" text,
	"tracking_number" text NOT NULL,
	"shipment_package_id" text,
	"package_seq" integer DEFAULT 1 NOT NULL,
	"weight" double precision NOT NULL,
	"weight_unit" text DEFAULT 'Ounce' NOT NULL,
	"length" double precision NOT NULL,
	"width" double precision NOT NULL,
	"height" double precision NOT NULL,
	"dimension_unit" text DEFAULT 'Inch' NOT NULL,
	"rate" double precision DEFAULT 0 NOT NULL,
	"shipping_cost" double precision DEFAULT 0 NOT NULL,
	"other_cost" double precision DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"zone" text,
	"insurance_type" text,
	"insurance_value" double precision,
	"confirmation_type" text,
	"allow_saturday_delivery" boolean DEFAULT false NOT NULL,
	"carrier_expected_delivery_at" text,
	"label_created_at" text NOT NULL,
	"actual_shipment_at" text,
	"shipment_mail_sent_at" text,
	"delivery_mail_sent_at" text,
	"delivered_at" text,
	"voided_at" text,
	"scheduled_pickup_at" text,
	"actual_pickup_at" text,
	"end_of_day_manifest_id" text,
	"packed_from_location_id" text,
	"parent_lp_id" text,
	"external_reference" text,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"ordered_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" double precision NOT NULL,
	"pack_type" text DEFAULT 'Each' NOT NULL,
	"uom_quantity" integer DEFAULT 1 NOT NULL,
	"receiving_location_id" text,
	"lot_number" text,
	"expiry_date" text,
	"production_date" text,
	"lp_type_id" text,
	"lp_number" text,
	"damaged_quantity" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_serials" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_line_id" text NOT NULL,
	"serial" text NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"vendor_name" text NOT NULL,
	"reference_number" text,
	"status" text NOT NULL,
	"po_type" text DEFAULT 'Purchase Order' NOT NULL,
	"total_quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"purchase_price" double precision NOT NULL,
	"expected_date" text,
	"received_at" text,
	"vendor_id" text,
	"po_date" text,
	"planned_receiving_date" text,
	"planned_arrival_date" text,
	"actual_arrival_date" text,
	"note" text,
	"completed_at" text,
	"cancelled_at" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"master_id" integer NOT NULL,
	"type" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"purchase_order_id" text,
	"purchase_order_line_id" text,
	"work_order_id" text,
	"shipment_order_id" text,
	"return_order_id" text,
	"return_order_line_id" text,
	"product_id" text NOT NULL,
	"pack_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"uom_quantity" integer NOT NULL,
	"lot_number" text,
	"expiry_date" text,
	"production_date" text,
	"location_id" text NOT NULL,
	"lp_id" text,
	"parent_lp_id" text,
	"damage_reason" text,
	"damage_image_file_id" text,
	"customer_return_reason" text,
	"actual_return_reason" text,
	"sku_details_updated" boolean DEFAULT false NOT NULL,
	"note" text,
	"line_note" text,
	"inventory_transaction_id" text,
	"received_by" text NOT NULL,
	"received_at" text NOT NULL,
	"cancelled_at" text,
	"cancelled_by" text
);
--> statement-breakpoint
CREATE TABLE "return_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"return_order_id" text NOT NULL,
	"order_line_id" text,
	"product_id" text NOT NULL,
	"pack_type" text NOT NULL,
	"requested_qty" integer NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL,
	"customer_return_reason_id" text,
	"actual_return_reason_id" text,
	"disposition" text,
	"line_status" text DEFAULT 'Pending' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"rma_code" text NOT NULL,
	"shipment_order_id" text,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"source" text DEFAULT 'RMA' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"return_address_id" text,
	"from_country" text,
	"customer_name" text,
	"carrier_code" text,
	"carrier_service_name" text,
	"tracking_number" text,
	"return_label_shipment_id" text,
	"expected_return_date" text,
	"actual_return_date" text,
	"note" text,
	"return_shipping_cost" double precision,
	"return_tracking_numbers" jsonb,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocation_exceptions" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"wave_id" text,
	"wave_no" text NOT NULL,
	"wave_rule_name" text,
	"algorithm_name" text,
	"algorithm_rule_name" text,
	"shortage_product_id" text,
	"inventory_uom_qty" integer,
	"order_line_qty" integer,
	"explanation" text NOT NULL,
	"is_rolled_back" boolean DEFAULT false NOT NULL,
	"run_by" text NOT NULL,
	"run_at" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_orders" (
	"job_id" text NOT NULL,
	"order_id" text NOT NULL,
	"tote_or_cell" text,
	CONSTRAINT "job_orders_job_id_order_id_pk" PRIMARY KEY("job_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "job_types" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"operation_type" text NOT NULL,
	"allocation_algorithm_id" text,
	"template" text,
	"settings" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]' NOT NULL,
	"location_conditions" jsonb,
	"sku_conditions" jsonb,
	"source_location_conditions" jsonb,
	"destination_location_conditions" jsonb,
	"lp_conditions" jsonb,
	"product_conditions" jsonb,
	"order_by" jsonb DEFAULT '[{"field":"walkingPathPriority","dir":"asc"}]' NOT NULL,
	"group_by" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text,
	"job_type" text NOT NULL,
	"status" text NOT NULL,
	"priority" text DEFAULT 'None' NOT NULL,
	"assigned_to_user_id" text,
	"order_count" integer DEFAULT 0 NOT NULL,
	"unit_count" integer DEFAULT 0 NOT NULL,
	"completed_units" integer DEFAULT 0 NOT NULL,
	"wave_number" text,
	"rule_name" text,
	"completed_at" text,
	"job_type_id" text,
	"operation_type" text DEFAULT 'Picking' NOT NULL,
	"wave_id" text,
	"wave_rule_id" text,
	"count_plan_id" text,
	"work_order_id" text,
	"planned_start_at" text,
	"planned_end_at" text,
	"started_at" text,
	"label_status" text DEFAULT 'No Label' NOT NULL,
	"pick_list_status" text DEFAULT 'Not Printed' NOT NULL,
	"mobile_cart_id" text,
	"picking_zone" text,
	"is_resolution_job" boolean DEFAULT false NOT NULL,
	"is_precartonization" boolean DEFAULT false NOT NULL,
	"task_count" integer DEFAULT 0 NOT NULL,
	"completed_task_count" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_no" integer NOT NULL,
	"job_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text,
	"task_type" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"priority" text DEFAULT 'None' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"order_id" text,
	"order_line_id" text,
	"allocation_id" text,
	"work_order_id" text,
	"count_plan_id" text,
	"count_line_id" text,
	"product_id" text,
	"pack_type" text,
	"to_pack_type" text,
	"planned_qty" integer DEFAULT 0 NOT NULL,
	"actual_qty" integer DEFAULT 0 NOT NULL,
	"source_location_id" text,
	"source_lp_id" text,
	"target_location_id" text,
	"target_lp_id" text,
	"target_cart_id" text,
	"lot_number" text,
	"expiry_date" text,
	"production_date" text,
	"damage_reason" text,
	"replenishment_phase" text,
	"lp_swap" boolean DEFAULT false NOT NULL,
	"lp_auto_removed" boolean DEFAULT false NOT NULL,
	"pack_type_conversion_applied" boolean DEFAULT false NOT NULL,
	"pick_short_status" text DEFAULT 'None' NOT NULL,
	"pack_short_status" text DEFAULT 'None' NOT NULL,
	"assignee_user_id" text,
	"executed_by_user_id" text,
	"planned_start_at" text,
	"planned_finish_at" text,
	"started_at" text,
	"finished_at" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wave_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_seq" integer NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"operation_type" text NOT NULL,
	"priority" text DEFAULT 'None' NOT NULL,
	"delete_if_not_started" boolean DEFAULT false NOT NULL,
	"delete_method" text DEFAULT 'None' NOT NULL,
	"delete_time" text,
	"job_type_ids" jsonb DEFAULT '[]' NOT NULL,
	"filters" jsonb DEFAULT '[]' NOT NULL,
	"order_by" jsonb DEFAULT '[]' NOT NULL,
	"schedule_days" jsonb DEFAULT '[]' NOT NULL,
	"schedule_times" jsonb DEFAULT '[]' NOT NULL,
	"assign_mode" text DEFAULT 'Pool' NOT NULL,
	"assignee_role_ids" jsonb,
	"assignee_user_ids" jsonb,
	"count_type" text,
	"lock_locations" boolean DEFAULT false NOT NULL,
	"soft_allocation" boolean DEFAULT false NOT NULL,
	"merge_rule_ids" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" text,
	"last_run_by" text,
	"last_wave_no" text,
	"next_run_at" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waves" (
	"id" text PRIMARY KEY NOT NULL,
	"wave_no" text NOT NULL,
	"wave_rule_id" text,
	"warehouse_id" text NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"orders_met" integer DEFAULT 0 NOT NULL,
	"shortage_orders" integer DEFAULT 0 NOT NULL,
	"jobs_created" integer DEFAULT 0 NOT NULL,
	"allocated_orders" integer DEFAULT 0 NOT NULL,
	"merged_orders" integer DEFAULT 0 NOT NULL,
	"message" text,
	"run_by" text NOT NULL,
	"run_at" text NOT NULL,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "count_line_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"line_id" text NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lp_id" text,
	"lot_number" text,
	"expiry_date" text,
	"damage_reason" text,
	"pack_type" text NOT NULL,
	"system_qty" integer NOT NULL,
	"counted_qty" integer NOT NULL,
	"counted_by" text,
	"counted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "count_plan_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"location_id" text,
	"product_id" text,
	"lp_id" text,
	"job_id" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"initial_stock_qty" integer DEFAULT 0 NOT NULL,
	"counted_qty" integer,
	"approved_stock_qty" integer,
	"approved_count_qty" integer,
	"is_recount_line" boolean DEFAULT false NOT NULL,
	"recount_of_line_id" text,
	"recounted" boolean DEFAULT false NOT NULL,
	"count_user_id" text,
	"note" text,
	"started_at" text,
	"completed_at" text,
	"inventory_updated_at" text,
	"inventory_updated_by" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "count_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"description" text,
	"scheduled_at" text NOT NULL,
	"lock_locations" boolean DEFAULT false NOT NULL,
	"count_type" text NOT NULL,
	"operation_type" text DEFAULT 'Cycle Count' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"wave_rule_id" text,
	"started_at" text,
	"completed_at" text,
	"inventory_updated_at" text,
	"inventory_updated_by" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kit_inventory_stats" (
	"kit_product_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"pending_order_qty" integer NOT NULL,
	"net_kitting_capacity" integer NOT NULL,
	"total_inventory_capacity" integer NOT NULL,
	"current_inventory_qty" integer NOT NULL,
	"required_kitting_qty" integer NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "kit_inventory_stats_kit_product_id_warehouse_id_pk" PRIMARY KEY("kit_product_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE "work_order_components" (
	"id" text PRIMARY KEY NOT NULL,
	"work_order_id" text NOT NULL,
	"component_product_id" text NOT NULL,
	"component_qty" integer NOT NULL,
	"total_qty" integer NOT NULL,
	"pack_type" text DEFAULT 'Each' NOT NULL,
	"location_id" text,
	"lp_id" text,
	"lot_number" text,
	"expiry_date" text,
	"production_date" text,
	"allocated_qty" integer DEFAULT 0 NOT NULL,
	"picked_qty" integer DEFAULT 0 NOT NULL,
	"consumed_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"type" text NOT NULL,
	"operation_type" text DEFAULT 'Kitting' NOT NULL,
	"build_for" text DEFAULT 'Stock' NOT NULL,
	"shipment_order_id" text,
	"kit_product_id" text NOT NULL,
	"requested_qty" integer NOT NULL,
	"processed_qty" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"extra_note" text,
	"kitting_instructions" text,
	"planned_start_at" text,
	"planned_finish_at" text,
	"actual_start_at" text,
	"actual_finish_at" text,
	"cancelled_at" text,
	"job_id" text,
	"output_location_id" text,
	"output_lot" text,
	"output_expiry" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algorithm_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"algorithm_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"inventory_conditions" jsonb,
	"actions" jsonb,
	"order_by" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "algorithms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"is_dynamic_replenishment" boolean DEFAULT false NOT NULL,
	"enforce_suggested_locations" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_shopping_preset_services" (
	"preset_id" text NOT NULL,
	"carrier_service_id" text NOT NULL,
	"is_selected" boolean DEFAULT true NOT NULL,
	CONSTRAINT "rate_shopping_preset_services_preset_id_carrier_service_id_pk" PRIMARY KEY("preset_id","carrier_service_id")
);
--> statement-breakpoint
CREATE TABLE "rate_shopping_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"client_id" text NOT NULL,
	"method" text NOT NULL,
	"transit_days" integer,
	"show_errors" boolean DEFAULT false NOT NULL,
	"use_all_services" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"matched" boolean NOT NULL,
	"actions_applied" jsonb,
	"block_type" text,
	"error" text,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"warehouse_id" text,
	"client_id" text,
	"match" text DEFAULT 'All' NOT NULL,
	"conditions" jsonb DEFAULT '[]' NOT NULL,
	"actions" jsonb NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"stop_processing" boolean DEFAULT false NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_call_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"step" text NOT NULL,
	"connection_id" text NOT NULL,
	"order_id" text,
	"shipment_id" text,
	"tracking_number" text,
	"destination_type" text,
	"status" text NOT NULL,
	"http_code" integer NOT NULL,
	"error" text,
	"response_ms" integer NOT NULL,
	"service_name" text,
	"warehouse_id" text NOT NULL,
	"client_id" text,
	"user_id" text,
	"source" text,
	"label_type" text,
	"rate_shopping_name" text,
	"request_json" text NOT NULL,
	"response_json" text NOT NULL,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_connection_clients" (
	"connection_id" text NOT NULL,
	"client_id" text NOT NULL,
	"markup_type" text,
	"markup_amount" double precision,
	"has_access" boolean DEFAULT true NOT NULL,
	CONSTRAINT "carrier_connection_clients_connection_id_client_id_pk" PRIMARY KEY("connection_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "carrier_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"setup_name" text NOT NULL,
	"account_prefix" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"environment" text DEFAULT 'Test' NOT NULL,
	"credentials_enc" text,
	"payor_account_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"all_clients" boolean DEFAULT true NOT NULL,
	"all_services" boolean DEFAULT true NOT NULL,
	"all_packages" boolean DEFAULT true NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_services" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"carrier_code" text NOT NULL,
	"service_code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"transit_days" integer NOT NULL,
	"is_international" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carrier_third_party_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"account_number" text NOT NULL,
	"billing_country" text NOT NULL,
	"billing_zip" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"store_name" text NOT NULL,
	"client_id" text NOT NULL,
	"distribution" text DEFAULT 'Custom App' NOT NULL,
	"auth_method" text DEFAULT 'Access Token' NOT NULL,
	"credentials_enc" text,
	"api_version" text DEFAULT 'GraphQL' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_location_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"channel_location_id" text NOT NULL,
	"channel_location_name" text NOT NULL,
	"warehouse_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"interval_minutes" integer NOT NULL,
	"job_status" text DEFAULT 'Waiting For Next' NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"last_success_at" text
);
--> statement-breakpoint
CREATE TABLE "channel_missing_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"order_code" text NOT NULL,
	"channel_order_number" text NOT NULL,
	"order_date" text NOT NULL,
	"last_updated" text NOT NULL,
	"last_error_code" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'Error' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_run_items" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"success" boolean NOT NULL,
	"properties" text NOT NULL,
	"error_message" text,
	"store_order_number" text,
	"seller_sku" text,
	"qty" integer,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"method_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"method" text NOT NULL,
	"status" text NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"ended_at" text
);
--> statement-breakpoint
CREATE TABLE "billing_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"calc_start_date" text NOT NULL,
	"frequency" text NOT NULL,
	"approval_status" text DEFAULT 'Draft' NOT NULL,
	"last_calculated_at" text,
	"next_period_start" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_fee_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"fee_id" text NOT NULL,
	"from_qty" double precision,
	"to_qty" double precision,
	"rate" double precision NOT NULL,
	"percentage" double precision
);
--> statement-breakpoint
CREATE TABLE "billing_fees" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"name" text NOT NULL,
	"operation_type" text NOT NULL,
	"calculation_type" text,
	"fee_by" text NOT NULL,
	"charge_by" text NOT NULL,
	"vas_type_id" text,
	"use_min_price" boolean DEFAULT false NOT NULL,
	"min_price" double precision,
	"use_max_price" boolean DEFAULT false NOT NULL,
	"max_price" double precision,
	"split_day" integer,
	"standard_rate" double precision,
	"alternate_rate" double precision,
	"charge_one_time" boolean DEFAULT false NOT NULL,
	"pricing_mode" text DEFAULT 'graduated' NOT NULL,
	"conditions" jsonb DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_report_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"fee_id" text,
	"fee_name" text NOT NULL,
	"operation_type" text NOT NULL,
	"fee_by" text NOT NULL,
	"charge_by" text NOT NULL,
	"sku" text,
	"from_qty" double precision,
	"to_qty" double precision,
	"unit_price" double precision NOT NULL,
	"quantity" double precision NOT NULL,
	"total_price" double precision NOT NULL,
	"min_max_adjustment" double precision DEFAULT 0 NOT NULL,
	"adjusted_price" double precision NOT NULL,
	"activity_date" text,
	"reference_number" text,
	"lp_number" text,
	"integration_status" text DEFAULT 'Not Sent' NOT NULL,
	"note" text,
	"is_detail" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"bill_number" text NOT NULL,
	"calc_status" text NOT NULL,
	"client_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"calculated_at" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"bill_status" text DEFAULT 'Draft' NOT NULL,
	"total_price" double precision NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"exported_to_integration" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vas_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"vas_type_id" text NOT NULL,
	"operation_at" text NOT NULL,
	"calculation_type" text NOT NULL,
	"value" double precision NOT NULL,
	"note" text,
	"reference_order_type" text,
	"reference_number" text,
	"created_at" text NOT NULL,
	"created_by" text,
	"updated_at" text NOT NULL,
	"updated_by" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_clients" ADD CONSTRAINT "user_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_grid_prefs" ADD CONSTRAINT "user_grid_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_printers" ADD CONSTRAINT "user_printers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_printers" ADD CONSTRAINT "user_printers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warehouses" ADD CONSTRAINT "user_warehouses_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_tasks" ADD CONSTRAINT "background_tasks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_tasks" ADD CONSTRAINT "background_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_notes" ADD CONSTRAINT "entity_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_values" ADD CONSTRAINT "lookup_values_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_values" ADD CONSTRAINT "lookup_values_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printout_template_clients" ADD CONSTRAINT "printout_template_clients_template_id_printout_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."printout_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printout_template_clients" ADD CONSTRAINT "printout_template_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_configs" ADD CONSTRAINT "screen_configs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_kit_product_id_products_id_fk" FOREIGN KEY ("kit_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kit_components" ADD CONSTRAINT "kit_components_component_product_id_products_id_fk" FOREIGN KEY ("component_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_pack_type_id_product_pack_types_id_fk" FOREIGN KEY ("pack_type_id") REFERENCES "public"."product_pack_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_channel_allocations" ADD CONSTRAINT "product_channel_allocations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_channel_allocations" ADD CONSTRAINT "product_channel_allocations_channel_connection_id_channel_connections_id_fk" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_channel_allocations" ADD CONSTRAINT "product_channel_allocations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_channel_connection_id_channel_connections_id_fk" FOREIGN KEY ("channel_connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_pack_types" ADD CONSTRAINT "product_pack_types_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_replenishment_levels" ADD CONSTRAINT "product_replenishment_levels_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_replenishment_levels" ADD CONSTRAINT "product_replenishment_levels_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serial_transactions" ADD CONSTRAINT "serial_transactions_serial_id_serial_numbers_id_fk" FOREIGN KEY ("serial_id") REFERENCES "public"."serial_numbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_plates" ADD CONSTRAINT "license_plates_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_plates" ADD CONSTRAINT "license_plates_lp_type_id_lp_types_id_fk" FOREIGN KEY ("lp_type_id") REFERENCES "public"."lp_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_plates" ADD CONSTRAINT "license_plates_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_plates" ADD CONSTRAINT "license_plates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_lp_capacity" ADD CONSTRAINT "location_lp_capacity_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_lp_capacity" ADD CONSTRAINT "location_lp_capacity_lp_type_id_lp_types_id_fk" FOREIGN KEY ("lp_type_id") REFERENCES "public"."lp_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_product_capacity" ADD CONSTRAINT "location_product_capacity_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_product_capacity" ADD CONSTRAINT "location_product_capacity_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_product_capacity" ADD CONSTRAINT "location_product_capacity_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_dedicated_client_id_clients_id_fk" FOREIGN KEY ("dedicated_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lp_types" ADD CONSTRAINT "lp_types_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_cart_cells" ADD CONSTRAINT "mobile_cart_cells_cart_id_mobile_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."mobile_carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_carts" ADD CONSTRAINT "mobile_carts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_package_clients" ADD CONSTRAINT "shipment_package_clients_package_id_shipment_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."shipment_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_package_clients" ADD CONSTRAINT "shipment_package_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_packages" ADD CONSTRAINT "shipment_packages_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_lp_id_license_plates_id_fk" FOREIGN KEY ("lp_id") REFERENCES "public"."license_plates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_allocations" ADD CONSTRAINT "inventory_allocations_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_shipment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shipment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_plan_orders" ADD CONSTRAINT "shipment_plan_orders_plan_id_shipment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."shipment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_plan_orders" ADD CONSTRAINT "shipment_plan_orders_order_id_shipment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shipment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_plans" ADD CONSTRAINT "shipment_plans_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_shipment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shipment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_serials" ADD CONSTRAINT "purchase_order_serials_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_order_lines" ADD CONSTRAINT "return_order_lines_return_order_id_return_orders_id_fk" FOREIGN KEY ("return_order_id") REFERENCES "public"."return_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_orders" ADD CONSTRAINT "return_orders_shipment_order_id_shipment_orders_id_fk" FOREIGN KEY ("shipment_order_id") REFERENCES "public"."shipment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_order_id_shipment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shipment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_types" ADD CONSTRAINT "job_types_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_job_type_id_job_types_id_fk" FOREIGN KEY ("job_type_id") REFERENCES "public"."job_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wave_rules" ADD CONSTRAINT "wave_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waves" ADD CONSTRAINT "waves_wave_rule_id_wave_rules_id_fk" FOREIGN KEY ("wave_rule_id") REFERENCES "public"."wave_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_line_entries" ADD CONSTRAINT "count_line_entries_line_id_count_plan_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."count_plan_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_plan_lines" ADD CONSTRAINT "count_plan_lines_plan_id_count_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."count_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "count_plans" ADD CONSTRAINT "count_plans_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_components" ADD CONSTRAINT "work_order_components_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_kit_product_id_products_id_fk" FOREIGN KEY ("kit_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algorithm_rules" ADD CONSTRAINT "algorithm_rules_algorithm_id_algorithms_id_fk" FOREIGN KEY ("algorithm_id") REFERENCES "public"."algorithms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "algorithms" ADD CONSTRAINT "algorithms_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_shopping_preset_services" ADD CONSTRAINT "rate_shopping_preset_services_preset_id_rate_shopping_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."rate_shopping_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_shopping_preset_services" ADD CONSTRAINT "rate_shopping_preset_services_carrier_service_id_carrier_services_id_fk" FOREIGN KEY ("carrier_service_id") REFERENCES "public"."carrier_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_connection_clients" ADD CONSTRAINT "carrier_connection_clients_connection_id_carrier_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."carrier_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_connection_clients" ADD CONSTRAINT "carrier_connection_clients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_connections" ADD CONSTRAINT "carrier_connections_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_packages" ADD CONSTRAINT "carrier_packages_connection_id_carrier_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."carrier_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_services" ADD CONSTRAINT "carrier_services_connection_id_carrier_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."carrier_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_third_party_accounts" ADD CONSTRAINT "carrier_third_party_accounts_connection_id_carrier_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."carrier_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_location_mappings" ADD CONSTRAINT "channel_location_mappings_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_location_mappings" ADD CONSTRAINT "channel_location_mappings_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_methods" ADD CONSTRAINT "channel_methods_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_missing_orders" ADD CONSTRAINT "channel_missing_orders_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_run_items" ADD CONSTRAINT "channel_run_items_run_id_channel_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."channel_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_runs" ADD CONSTRAINT "channel_runs_method_id_channel_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."channel_methods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_contracts" ADD CONSTRAINT "billing_contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_contracts" ADD CONSTRAINT "billing_contracts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_fee_tiers" ADD CONSTRAINT "billing_fee_tiers_fee_id_billing_fees_id_fk" FOREIGN KEY ("fee_id") REFERENCES "public"."billing_fees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_fees" ADD CONSTRAINT "billing_fees_contract_id_billing_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."billing_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_report_lines" ADD CONSTRAINT "billing_report_lines_report_id_billing_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."billing_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reports" ADD CONSTRAINT "billing_reports_contract_id_billing_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."billing_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_idx" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE INDEX "saved_views_grid_idx" ON "saved_views" USING btree ("grid_key","user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_user_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "addresses_owner_idx" ON "addresses" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_idx" ON "clients" USING btree ("code");--> statement-breakpoint
CREATE INDEX "customers_client_idx" ON "customers" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retailers_name_idx" ON "retailers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_client_name_idx" ON "vendors" USING btree ("client_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_code_idx" ON "warehouses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "bg_tasks_user_idx" ON "background_tasks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "change_log_entity_idx" ON "change_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "change_log_at_idx" ON "change_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "change_log_parent_idx" ON "change_log" USING btree ("parent_entity_type","parent_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cfd_slot_idx" ON "custom_field_defs" USING btree ("entity_type","slot");--> statement-breakpoint
CREATE INDEX "entity_notes_entity_idx" ON "entity_notes" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "entity_tags_entity_idx" ON "entity_tags" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_entity_type","owner_entity_id");--> statement-breakpoint
CREATE INDEX "import_batches_key_idx" ON "import_batches" USING btree ("import_key","created_at");--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "lookup_type_idx" ON "lookup_values" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "lookup_unique_idx" ON "lookup_values" USING btree ("type","name",(CASE WHEN "client_id" IS NULL THEN '' ELSE "client_id" END),(CASE WHEN "warehouse_id" IS NULL THEN '' ELSE "warehouse_id" END));--> statement-breakpoint
CREATE INDEX "printout_type_idx" ON "printout_templates" USING btree ("type_key");--> statement-breakpoint
CREATE INDEX "screen_configs_wh_idx" ON "screen_configs" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_scope_idx" ON "tags" USING btree ("name","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "kit_component_idx" ON "kit_components" USING btree ("kit_product_id","component_product_id");--> statement-breakpoint
CREATE INDEX "product_barcodes_code_idx" ON "product_barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "pca_product_idx" ON "product_channel_allocations" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_unique_idx" ON "product_listings" USING btree ("channel_connection_id","channel_product_id");--> statement-breakpoint
CREATE INDEX "listing_product_idx" ON "product_listings" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ppt_product_pack_idx" ON "product_pack_types" USING btree ("product_id","pack_type");--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_idx" ON "products" USING btree ("client_id","sku");--> statement-breakpoint
CREATE INDEX "products_barcode_idx" ON "products" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "serial_unique_idx" ON "serial_numbers" USING btree ("product_id","primary_serial");--> statement-breakpoint
CREATE INDEX "serial_txn_serial_idx" ON "serial_transactions" USING btree ("serial_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lp_number_idx" ON "license_plates" USING btree ("warehouse_id","number");--> statement-breakpoint
CREATE INDEX "lp_location_idx" ON "license_plates" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "lp_parent_idx" ON "license_plates" USING btree ("parent_lp_id");--> statement-breakpoint
CREATE INDEX "llc_location_idx" ON "location_lp_capacity" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lpc_idx" ON "location_product_capacity" USING btree ("location_id","product_id","pack_type");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_code_idx" ON "locations" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "locations_barcode_idx" ON "locations" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "locations_area_idx" ON "locations" USING btree ("warehouse_id","area_type");--> statement-breakpoint
CREATE UNIQUE INDEX "lp_types_code_idx" ON "lp_types" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_cell_idx" ON "mobile_cart_cells" USING btree ("cart_id","level","column");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_cart_code_idx" ON "mobile_carts" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ship_pkg_code_idx" ON "shipment_packages" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "inventory_product_idx" ON "inventory" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_location_idx" ON "inventory" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_bucket_idx" ON "inventory" USING btree ("bucket_key");--> statement-breakpoint
CREATE INDEX "inventory_wh_client_product_idx" ON "inventory" USING btree ("warehouse_id","client_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_status_idx" ON "inventory" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inventory_lp_idx" ON "inventory" USING btree ("lp_id");--> statement-breakpoint
CREATE INDEX "alloc_order_idx" ON "inventory_allocations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "alloc_inv_idx" ON "inventory_allocations" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "alloc_job_idx" ON "inventory_allocations" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "snap_at_idx" ON "inventory_snapshots" USING btree ("snapshot_at","warehouse_id");--> statement-breakpoint
CREATE INDEX "itx_product_idx" ON "inventory_transactions" USING btree ("product_id","at");--> statement-breakpoint
CREATE INDEX "itx_type_idx" ON "inventory_transactions" USING btree ("type","at");--> statement-breakpoint
CREATE INDEX "itx_order_idx" ON "inventory_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "itx_wh_idx" ON "inventory_transactions" USING btree ("warehouse_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "itx_seq_idx" ON "inventory_transactions" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "missing_log_at_idx" ON "missing_log" USING btree ("warehouse_id","entered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ols_line_idx" ON "order_line_shortages" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "ols_order_idx" ON "order_line_shortages" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_product_idx" ON "order_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_code_idx" ON "shipment_orders" USING btree ("code");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "shipment_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_client_idx" ON "shipment_orders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "orders_date_idx" ON "shipment_orders" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX "orders_wh_status_idx" ON "shipment_orders" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "orders_store_number_idx" ON "shipment_orders" USING btree ("store_order_number");--> statement-breakpoint
CREATE INDEX "orders_job_idx" ON "shipment_orders" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eod_unique_idx" ON "end_of_day_manifests" USING btree ("warehouse_id","carrier_connection_id","ship_date","sequence");--> statement-breakpoint
CREATE INDEX "shipment_items_shipment_idx" ON "shipment_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "spo_order_idx" ON "shipment_plan_orders" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_plan_code_idx" ON "shipment_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_label_at_idx" ON "shipments" USING btree ("label_created_at");--> statement-breakpoint
CREATE INDEX "shipments_tracking_idx" ON "shipments" USING btree ("tracking_number");--> statement-breakpoint
CREATE INDEX "shipments_eod_idx" ON "shipments" USING btree ("end_of_day_manifest_id");--> statement-breakpoint
CREATE INDEX "po_lines_po_idx" ON "purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "po_serials_line_serial_idx" ON "purchase_order_serials" USING btree ("purchase_order_line_id","serial");--> statement-breakpoint
CREATE UNIQUE INDEX "po_code_idx" ON "purchase_orders" USING btree ("code");--> statement-breakpoint
CREATE INDEX "po_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "po_client_idx" ON "purchase_orders" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "po_vendor_idx" ON "purchase_orders" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "receipts_po_idx" ON "receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "receipts_po_active_idx" ON "receipts" USING btree ("purchase_order_id","cancelled_at");--> statement-breakpoint
CREATE INDEX "receipts_at_idx" ON "receipts" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_master_idx" ON "receipts" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "receipts_return_idx" ON "receipts" USING btree ("return_order_id");--> statement-breakpoint
CREATE INDEX "return_lines_return_idx" ON "return_order_lines" USING btree ("return_order_id");--> statement-breakpoint
CREATE INDEX "return_lines_order_line_idx" ON "return_order_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rma_code_idx" ON "return_orders" USING btree ("rma_code");--> statement-breakpoint
CREATE INDEX "return_orders_so_idx" ON "return_orders" USING btree ("shipment_order_id");--> statement-breakpoint
CREATE INDEX "return_orders_scope_idx" ON "return_orders" USING btree ("warehouse_id","client_id","status");--> statement-breakpoint
CREATE INDEX "return_orders_created_idx" ON "return_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alloc_exc_wave_idx" ON "allocation_exceptions" USING btree ("wave_no");--> statement-breakpoint
CREATE INDEX "alloc_exc_order_idx" ON "allocation_exceptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "job_orders_order_idx" ON "job_orders" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_types_code_idx" ON "job_types" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_code_idx" ON "jobs" USING btree ("code");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "jobs_wave_idx" ON "jobs" USING btree ("wave_id");--> statement-breakpoint
CREATE INDEX "jobs_count_plan_idx" ON "jobs" USING btree ("count_plan_id");--> statement-breakpoint
CREATE INDEX "tasks_job_idx" ON "tasks" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "tasks_order_idx" ON "tasks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("task_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_no_idx" ON "tasks" USING btree ("task_no");--> statement-breakpoint
CREATE INDEX "tasks_source_location_idx" ON "tasks" USING btree ("source_location_id","status");--> statement-breakpoint
CREATE INDEX "tasks_target_location_idx" ON "tasks" USING btree ("target_location_id","status");--> statement-breakpoint
CREATE INDEX "wave_rules_wh_idx" ON "wave_rules" USING btree ("warehouse_id","operation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "waves_no_idx" ON "waves" USING btree ("wave_no");--> statement-breakpoint
CREATE INDEX "waves_rule_idx" ON "waves" USING btree ("wave_rule_id");--> statement-breakpoint
CREATE INDEX "count_entries_line_idx" ON "count_line_entries" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "count_lines_plan_idx" ON "count_plan_lines" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "count_lines_plan_status_idx" ON "count_plan_lines" USING btree ("plan_id","status");--> statement-breakpoint
CREATE INDEX "count_lines_location_idx" ON "count_plan_lines" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "count_plan_code_idx" ON "count_plans" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "wo_components_wo_idx" ON "work_order_components" USING btree ("work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_code_idx" ON "work_orders" USING btree ("code");--> statement-breakpoint
CREATE INDEX "work_orders_status_idx" ON "work_orders" USING btree ("warehouse_id","status");--> statement-breakpoint
CREATE INDEX "algorithm_rules_algo_idx" ON "algorithm_rules" USING btree ("algorithm_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "algorithms_name_idx" ON "algorithms" USING btree ("warehouse_id","kind","name");--> statement-breakpoint
CREATE INDEX "wf_runs_entity_idx" ON "workflow_runs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "workflows_trigger_idx" ON "workflows" USING btree ("trigger","sequence");--> statement-breakpoint
CREATE INDEX "carrier_logs_step_idx" ON "carrier_call_logs" USING btree ("step","at");--> statement-breakpoint
CREATE INDEX "carrier_logs_order_idx" ON "carrier_call_logs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "carrier_conn_wh_idx" ON "carrier_connections" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_package_idx" ON "carrier_packages" USING btree ("connection_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_service_idx" ON "carrier_services" USING btree ("connection_id","service_code");--> statement-breakpoint
CREATE INDEX "carrier_3p_conn_idx" ON "carrier_third_party_accounts" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "channel_conn_client_idx" ON "channel_connections" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_loc_map_idx" ON "channel_location_mappings" USING btree ("connection_id","channel_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_method_idx" ON "channel_methods" USING btree ("connection_id","method");--> statement-breakpoint
CREATE INDEX "channel_missing_conn_idx" ON "channel_missing_orders" USING btree ("connection_id","status");--> statement-breakpoint
CREATE INDEX "channel_run_items_run_idx" ON "channel_run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "channel_runs_conn_idx" ON "channel_runs" USING btree ("connection_id","started_at");--> statement-breakpoint
CREATE INDEX "billing_contracts_client_idx" ON "billing_contracts" USING btree ("client_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "billing_tiers_fee_idx" ON "billing_fee_tiers" USING btree ("fee_id");--> statement-breakpoint
CREATE INDEX "billing_fees_contract_idx" ON "billing_fees" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "billing_lines_report_idx" ON "billing_report_lines" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_number_idx" ON "billing_reports" USING btree ("bill_number");--> statement-breakpoint
CREATE INDEX "billing_reports_contract_idx" ON "billing_reports" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "vas_ops_client_idx" ON "vas_operations" USING btree ("client_id","operation_at");