-- KitStak Ledger: the `ledger` schema. Hand written (never drizzle-kit push); mirrored for types in
-- apps/ledger/src/server/db/schema/*.ts. See docs/ledger/SPEC.md section 5.
-- Conventions (Pulse 5): uuid PKs, timestamptz, org scoped rows (FK core.organization ON DELETE
-- CASCADE), enums as text + CHECK, money as bigint whole cents (domain ledger.cents), unit prices
-- numeric(14,4) (ledger.price), quantities numeric(14,3) (ledger.qty), hours numeric(10,2), tax
-- rates as integer millionths. Every table with an id has UNIQUE (org_id, id) and every ledger to
-- ledger FK is the composite (org_id, x_id), so a row can never point at another org's parent.
-- The shared columns (soft delete, version, source columns), the composite FKs, the triggers and
-- RLS are added at the end, from one list each.
-- Ledger migrates last. It does NOT touch the core.entitlements module CHECK before launch (D5).
CREATE SCHEMA IF NOT EXISTS "ledger";
--> statement-breakpoint
-- Value domains (4.2 bounds). NULL passes, so optional money columns use the same domain.
CREATE DOMAIN "ledger"."cents" AS bigint CHECK (VALUE BETWEEN -10000000000000 AND 10000000000000);
--> statement-breakpoint
CREATE DOMAIN "ledger"."qty" AS numeric(14,3) CHECK (VALUE >= -100000000 AND VALUE < 100000000);
--> statement-breakpoint
CREATE DOMAIN "ledger"."price" AS numeric(14,4) CHECK (VALUE >= 0 AND VALUE < 1000000);
--> statement-breakpoint
-- 5.2 Setup tables ---------------------------------------------------------------------------
CREATE TABLE "ledger"."settings" (
  "org_id"                       uuid PRIMARY KEY REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "currency"                     text NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$'),
  "timezone"                     text NOT NULL,
  "working_days"                 smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  "fiscal_year_start_month"      smallint NOT NULL DEFAULT 1 CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12),
  "company_name"                 text,
  "company_address"              jsonb,
  "logo_attachment_id"           uuid,
  "remit_text"                   text,
  "default_terms_id"             uuid,
  "default_member_role"          text NOT NULL DEFAULT 'none' CHECK ("default_member_role" IN ('none', 'submitter')),
  "separate_approval"            boolean NOT NULL DEFAULT true,
  "auto_approve_below_cents"     "ledger"."cents" CHECK ("auto_approve_below_cents" IS NULL OR "auto_approve_below_cents" > 0),
  "write_off_limit_cents"        "ledger"."cents" NOT NULL DEFAULT 50000 CHECK ("write_off_limit_cents" >= 0),
  "receipt_required_above_cents" "ledger"."cents" NOT NULL DEFAULT 2500 CHECK ("receipt_required_above_cents" >= 0),
  "price_tolerance_bp"           int NOT NULL DEFAULT 200 CHECK ("price_tolerance_bp" BETWEEN 0 AND 100000),
  "agency_hours_tolerance"       numeric(6,2) NOT NULL DEFAULT 0.50 CHECK ("agency_hours_tolerance" >= 0),
  "promise_grace_days"           smallint NOT NULL DEFAULT 2 CHECK ("promise_grace_days" BETWEEN 0 AND 60),
  "reminders_enabled"            boolean NOT NULL DEFAULT true,
  "reminder_from_name"           text,
  "wms_auto_draft"               boolean NOT NULL DEFAULT false,
  "wms_show_detail_page"         boolean NOT NULL DEFAULT true,
  "pdf_footer_enabled"           boolean NOT NULL DEFAULT true,
  "opening_date"                 date,
  "books_mode"                   text NOT NULL DEFAULT 'sync' CHECK ("books_mode" IN ('sync', 'books_of_record')),
  "onboarding"                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sample_loaded_at"             timestamptz,
  "version"                      int NOT NULL DEFAULT 1,
  "created_at"                   timestamptz NOT NULL DEFAULT now(),
  "updated_at"                   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."member_roles" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"           uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "role"              text NOT NULL CHECK ("role" IN ('owner', 'admin', 'bookkeeper', 'approver', 'viewer', 'submitter', 'none')),
  "can_approve_bills" boolean NOT NULL DEFAULT false,
  "sees_balances"     boolean NOT NULL DEFAULT false,
  "updated_by"        uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "member_roles_org_user_key" UNIQUE ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."accounts" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"              text NOT NULL CHECK (btrim("number") <> '' AND length("number") <= 20),
  "name"                text NOT NULL CHECK (btrim("name") <> ''),
  "type"                text NOT NULL CHECK ("type" IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  "subtype"             text NOT NULL CHECK ("subtype" IN ('bank', 'card', 'undeposited', 'receivable', 'unbilled', 'other_current', 'fixed', 'payable', 'sales_tax', 'payroll', 'equity', 'revenue', 'cost_of_service', 'expense', 'other')),
  "system_key"          text CHECK ("system_key" IN ('default_bank', 'undeposited', 'ar', 'unbilled', 'ap', 'default_card', 'sales_tax', 'payroll', 'reimbursements', 'customer_credit', 'retained_earnings', 'opening_equity', 'default_revenue', 'accrued_revenue', 'bank_fees', 'bad_debt')),
  "parent_id"           uuid,
  "description"         text,
  "is_contra"           boolean NOT NULL DEFAULT false,
  "pulse_cost_category" text CHECK ("pulse_cost_category" IN ('freight', 'packaging', 'equipment', 'outside_service', 'rework', 'supplies', 'storage', 'rent', 'utilities', 'salaried_staff', 'insurance', 'other')),
  "external_refs"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "archived_at"         timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."tax_rates" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"            text NOT NULL CHECK (btrim("name") <> ''),
  "rate_millionths" int NOT NULL CHECK ("rate_millionths" BETWEEN 0 AND 250000),
  "account_id"      uuid NOT NULL,
  "agency"          text,
  "active"          boolean NOT NULL DEFAULT true,
  "archived_at"     timestamptz,
  "external_refs"   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."items" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "code"          text NOT NULL CHECK (btrim("code") <> ''),
  "name"          text NOT NULL CHECK (btrim("name") <> ''),
  "description"   text,
  "unit_label"    text,
  "default_price" "ledger"."price",
  "account_id"    uuid NOT NULL,
  "tax_rate_id"   uuid,
  "active"        boolean NOT NULL DEFAULT true,
  "external_refs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "archived_at"   timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."source_mappings" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "source"     text NOT NULL CHECK ("source" IN ('wms_operation', 'pulse_service', 'program_fee_kind', 'pulse_job_type')),
  "key"        text NOT NULL CHECK (btrim("key") <> ''),
  "item_id"    uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "source_mappings_key" UNIQUE ("org_id", "source", "key")
);
--> statement-breakpoint
CREATE TABLE "ledger"."terms" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "name"          text NOT NULL CHECK (btrim("name") <> ''),
  "kind"          text NOT NULL CHECK ("kind" IN ('due_on_receipt', 'net_days', 'day_of_next_month')),
  "days"          smallint CHECK ("days" IS NULL OR "days" BETWEEN 0 AND 365),
  "day_of_month"  smallint CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 31),
  "is_default"    boolean NOT NULL DEFAULT false,
  "active"        boolean NOT NULL DEFAULT true,
  "external_refs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "terms_shape_check" CHECK (
    ("kind" = 'due_on_receipt')
    OR ("kind" = 'net_days' AND "days" IS NOT NULL)
    OR ("kind" = 'day_of_next_month' AND "day_of_month" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "ledger"."number_sequences" (
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "doc_type"   text NOT NULL CHECK ("doc_type" IN ('invoice', 'credit_note', 'journal', 'bill', 'payment', 'expense')),
  "prefix"     text NOT NULL DEFAULT '' CHECK (length("prefix") <= 12),
  "next_value" bigint NOT NULL CHECK ("next_value" >= 1),
  "pad"        smallint NOT NULL DEFAULT 0 CHECK ("pad" BETWEEN 0 AND 12),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("org_id", "doc_type")
);
--> statement-breakpoint
CREATE TABLE "ledger"."customer_profiles" (
  "org_id"               uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "customer_id"          uuid NOT NULL REFERENCES "core"."customers"("id"),
  "billing_contact_name" text,
  "billing_emails"       text[] NOT NULL DEFAULT '{}',
  "billing_address"      jsonb,
  "terms_id"             uuid,
  "default_tax_rate_id"  uuid,
  "tax_exempt"           boolean NOT NULL DEFAULT false,
  "exemption_note"       text,
  "reminders_enabled"    boolean NOT NULL DEFAULT true,
  "collections_owner_id" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "crm_account_item_id"  uuid,
  "external_refs"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes"                text,
  "version"              int NOT NULL DEFAULT 1,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("org_id", "customer_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."vendor_profiles" (
  "org_id"              uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "vendor_id"           uuid NOT NULL REFERENCES "core"."vendors"("id"),
  "terms_id"            uuid,
  "default_account_id"  uuid,
  "default_approver_id" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "auto_approve"        boolean NOT NULL DEFAULT false,
  "tracks_1099"         boolean NOT NULL DEFAULT false,
  "w9_on_file"          boolean NOT NULL DEFAULT false,
  "remit_address"       jsonb,
  "notes"               text,
  "version"             int NOT NULL DEFAULT 1,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "vendor_profiles_pkey" PRIMARY KEY ("org_id", "vendor_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."program_billing" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "program_id"        uuid NOT NULL,
  "customer_id"       uuid REFERENCES "core"."customers"("id"),
  "cadence"           text NOT NULL CHECK ("cadence" IN ('weekly', 'monthly')),
  "weekday"           smallint CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6),
  "next_period_start" date,
  "active"            boolean NOT NULL DEFAULT true,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "program_billing_program_key" UNIQUE ("org_id", "program_id")
);
--> statement-breakpoint
-- 5.3 Money owed to you ----------------------------------------------------------------------
CREATE TABLE "ledger"."invoices" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"                  text NOT NULL DEFAULT 'invoice' CHECK ("kind" IN ('invoice', 'credit_note')),
  "number"                text,
  "status"                text NOT NULL DEFAULT 'draft',
  "customer_id"           uuid NOT NULL REFERENCES "core"."customers"("id"),
  "issue_date"            date NOT NULL,
  "due_date"              date,
  "terms_id"              uuid,
  "po_number"             text,
  "memo"                  text,
  "internal_note"         text,
  "currency"              text NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$'),
  "subtotal_cents"        "ledger"."cents" NOT NULL DEFAULT 0,
  "tax_cents"             "ledger"."cents" NOT NULL DEFAULT 0,
  "total_cents"           "ledger"."cents" NOT NULL DEFAULT 0,
  "applied_cents"         "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("applied_cents" >= 0),
  "credited_cents"        "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("credited_cents" >= 0),
  "written_off_cents"     "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("written_off_cents" >= 0),
  "balance_cents"         "ledger"."cents" NOT NULL DEFAULT 0,
  "credit_for_invoice_id" uuid,
  "recurring_invoice_id"  uuid,
  "reminders_enabled"     boolean NOT NULL DEFAULT true,
  "sent_at"               timestamptz,
  "sent_by"               uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "send_count"            int NOT NULL DEFAULT 0 CHECK ("send_count" >= 0),
  "voided_at"             timestamptz,
  "voided_by"             uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "void_reason"           text,
  "posting_seq"           int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"         uuid,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoices_kind_status_check" CHECK (
    ("kind" = 'invoice' AND "status" IN ('draft', 'sent', 'partially_paid', 'paid', 'void'))
    OR ("kind" = 'credit_note' AND "status" IN ('draft', 'open', 'applied', 'void'))
  ),
  CONSTRAINT "invoices_number_check" CHECK ("number" IS NOT NULL OR "status" = 'draft'),
  CONSTRAINT "invoices_total_check" CHECK ("total_cents" = "subtotal_cents" + "tax_cents"),
  CONSTRAINT "invoices_balance_check" CHECK ("balance_cents" = "total_cents" - "applied_cents" - "credited_cents" - "written_off_cents"),
  CONSTRAINT "invoices_void_reason_check" CHECK ("status" <> 'void' OR "void_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger"."invoice_lines" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"             uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "invoice_id"         uuid NOT NULL,
  "position"           int NOT NULL DEFAULT 0,
  "item_id"            uuid,
  "description"        text NOT NULL DEFAULT '',
  "quantity"           "ledger"."qty" NOT NULL DEFAULT 1,
  "unit_price"         "ledger"."price" NOT NULL DEFAULT 0,
  "amount_cents"       "ledger"."cents" NOT NULL,
  "account_id"         uuid NOT NULL,
  "tax_rate_id"        uuid,
  "rate_millionths"    int CHECK ("rate_millionths" IS NULL OR "rate_millionths" BETWEEN 0 AND 250000),
  "tax_cents"          "ledger"."cents" NOT NULL DEFAULT 0,
  "pulse_job_id"       uuid,
  "service_date"       date,
  "amount_from_source" boolean NOT NULL DEFAULT false,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoice_lines_rate_check" CHECK (("tax_rate_id" IS NULL) = ("rate_millionths" IS NULL)),
  CONSTRAINT "invoice_lines_untaxed_check" CHECK ("tax_rate_id" IS NOT NULL OR "tax_cents" = 0)
);
--> statement-breakpoint
CREATE TABLE "ledger"."invoice_sources" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "invoice_id"      uuid NOT NULL,
  "invoice_line_id" uuid,
  "source_type"     text NOT NULL CHECK ("source_type" IN ('wms_bill', 'wms_bill_line', 'pulse_job', 'pulse_client', 'program_output', 'program_fee', 'recurring', 'import')),
  "source_ref"      text NOT NULL CHECK (btrim("source_ref") <> ''),
  "meta"            jsonb NOT NULL DEFAULT '{}'::jsonb,
  "active"          boolean NOT NULL DEFAULT true,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."recurring_invoices" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "customer_id"      uuid NOT NULL REFERENCES "core"."customers"("id"),
  "name"             text NOT NULL CHECK (btrim("name") <> ''),
  "cadence"          text NOT NULL CHECK ("cadence" IN ('weekly', 'monthly', 'quarterly')),
  "weekday"          smallint CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6),
  "day_of_month"     smallint CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 28),
  "last_day"         boolean NOT NULL DEFAULT false,
  "month_of_quarter" smallint CHECK ("month_of_quarter" IS NULL OR "month_of_quarter" BETWEEN 1 AND 3),
  "next_run_date"    date NOT NULL,
  "end_date"         date,
  "terms_id"         uuid,
  "memo"             text,
  "active"           boolean NOT NULL DEFAULT true,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "updated_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "is_sample"        boolean NOT NULL DEFAULT false,
  "version"          int NOT NULL DEFAULT 1,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recurring_invoices_shape_check" CHECK (
    ("cadence" = 'weekly' AND "weekday" IS NOT NULL)
    OR ("cadence" IN ('monthly', 'quarterly') AND ("day_of_month" IS NOT NULL OR "last_day"))
  )
);
--> statement-breakpoint
CREATE TABLE "ledger"."recurring_invoice_lines" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"               uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "recurring_invoice_id" uuid NOT NULL,
  "position"             int NOT NULL DEFAULT 0,
  "item_id"              uuid,
  "description"          text NOT NULL DEFAULT '',
  "quantity"             "ledger"."qty" NOT NULL DEFAULT 1,
  "unit_price"           "ledger"."price" NOT NULL DEFAULT 0,
  "amount_cents"         "ledger"."cents" NOT NULL,
  "account_id"           uuid NOT NULL,
  "tax_rate_id"          uuid,
  "rate_millionths"      int CHECK ("rate_millionths" IS NULL OR "rate_millionths" BETWEEN 0 AND 250000),
  "tax_cents"            "ledger"."cents" NOT NULL DEFAULT 0,
  "pulse_job_id"         uuid,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recurring_invoice_lines_rate_check" CHECK (("tax_rate_id" IS NULL) = ("rate_millionths" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ledger"."payments" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"                  text NOT NULL DEFAULT 'received' CHECK ("kind" IN ('received', 'refund')),
  "number"                text,
  "customer_id"           uuid NOT NULL REFERENCES "core"."customers"("id"),
  "received_on"           date NOT NULL,
  "method"                text NOT NULL DEFAULT 'check' CHECK ("method" IN ('check', 'ach', 'wire', 'card', 'cash', 'other')),
  "reference"             text,
  "amount_cents"          "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "deposit_to_account_id" uuid NOT NULL,
  "unapplied_cents"       "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("unapplied_cents" >= 0),
  "deposit_id"            uuid,
  "external_ref"          text,
  "memo"                  text,
  "posting_seq"           int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"         uuid,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payments_unapplied_check" CHECK ("unapplied_cents" <= "amount_cents")
);
--> statement-breakpoint
CREATE TABLE "ledger"."payment_applications" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "payment_id"     uuid,
  "credit_note_id" uuid,
  "invoice_id"     uuid NOT NULL,
  "amount_cents"   "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "applied_on"     date NOT NULL,
  "removed_at"     timestamptz,
  "removed_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payment_applications_one_source_check" CHECK (num_nonnulls("payment_id", "credit_note_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "ledger"."deposits" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL,
  "deposited_on"    date NOT NULL,
  "total_cents"     "ledger"."cents" NOT NULL CHECK ("total_cents" > 0),
  "fee_cents"       "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("fee_cents" >= 0),
  "fee_account_id"  uuid,
  "bank_line_id"    uuid,
  "memo"            text,
  "posting_seq"     int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"   uuid,
  "is_sample"       boolean NOT NULL DEFAULT false,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deposits_fee_check" CHECK ("fee_cents" = 0 OR "fee_account_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger"."write_offs" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "invoice_id"     uuid NOT NULL,
  "write_off_date" date NOT NULL,
  "amount_cents"   "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "account_id"     uuid NOT NULL,
  "reason"         text NOT NULL CHECK (btrim("reason") <> ''),
  "status"         text NOT NULL DEFAULT 'posted' CHECK ("status" IN ('waiting_approval', 'posted', 'reversed')),
  "approved_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reversed_at"    timestamptz,
  "reversed_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "posting_seq"    int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"  uuid,
  "is_sample"      boolean NOT NULL DEFAULT false,
  "created_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."disputes" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "invoice_id"      uuid NOT NULL,
  "invoice_line_id" uuid NOT NULL,
  "opened_on"       date NOT NULL,
  "amount_cents"    "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "reason"          text NOT NULL CHECK (btrim("reason") <> ''),
  "status"          text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'resolved_credited', 'resolved_dropped')),
  "resolved_on"     date,
  "resolved_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "credit_note_id"  uuid,
  "is_sample"       boolean NOT NULL DEFAULT false,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."promises" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "customer_id"   uuid NOT NULL REFERENCES "core"."customers"("id"),
  "invoice_ids"   uuid[] NOT NULL DEFAULT '{}',
  "promised_date" date NOT NULL,
  "amount_cents"  "ledger"."cents" CHECK ("amount_cents" IS NULL OR "amount_cents" > 0),
  "note"          text,
  "status"        text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'kept', 'missed', 'cancelled')),
  "resolved_at"   timestamptz,
  "is_sample"     boolean NOT NULL DEFAULT false,
  "created_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."reminder_rules" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "offset_days"       int NOT NULL CHECK ("offset_days" BETWEEN -60 AND 365),
  "repeat_every_days" int CHECK ("repeat_every_days" IS NULL OR "repeat_every_days" BETWEEN 1 AND 365),
  "max_count"         smallint CHECK ("max_count" IS NULL OR "max_count" BETWEEN 1 AND 20),
  "subject"           text NOT NULL CHECK (btrim("subject") <> ''),
  "body"              text NOT NULL CHECK (btrim("body") <> ''),
  "active"            boolean NOT NULL DEFAULT true,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reminder_rules_offset_key" UNIQUE ("org_id", "offset_days")
);
--> statement-breakpoint
CREATE TABLE "ledger"."emails" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"        text NOT NULL CHECK ("kind" IN ('invoice', 'reminder', 'statement', 'other')),
  "to"          text[] NOT NULL DEFAULT '{}',
  "subject"     text NOT NULL,
  "entity_type" text,
  "entity_id"   uuid,
  "dedupe_key"  text NOT NULL,
  "provider_id" text,
  "status"      text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'sent', 'failed')),
  "error"       text,
  "sent_at"     timestamptz,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "emails_dedupe_key" UNIQUE ("org_id", "dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "ledger"."reminder_sends" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "invoice_id"  uuid NOT NULL,
  "rule_offset" int NOT NULL,
  "sent_on"     date NOT NULL,
  "email_id"    uuid,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reminder_sends_key" UNIQUE ("invoice_id", "rule_offset", "sent_on")
);
--> statement-breakpoint
CREATE TABLE "ledger"."public_links" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "invoice_id"     uuid NOT NULL,
  "token_hash"     text NOT NULL UNIQUE CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  "token_prefix"   text NOT NULL,
  "expires_at"     timestamptz NOT NULL,
  "last_viewed_at" timestamptz,
  "revoked_at"     timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- 5.4 Money you owe --------------------------------------------------------------------------
CREATE TABLE "ledger"."bills" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"                  text NOT NULL DEFAULT 'bill' CHECK ("kind" IN ('bill', 'vendor_credit')),
  "number"                text,
  "vendor_id"             uuid NOT NULL REFERENCES "core"."vendors"("id"),
  "vendor_ref"            text,
  "bill_date"             date NOT NULL,
  "due_date"              date,
  "terms_id"              uuid,
  "status"                text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'approved', 'scheduled', 'paid', 'void')),
  "currency"              text NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$'),
  "total_cents"           "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("total_cents" >= 0),
  "paid_cents"            "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("paid_cents" >= 0),
  "credited_cents"        "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("credited_cents" >= 0),
  "balance_cents"         "ledger"."cents" NOT NULL DEFAULT 0,
  "approver_id"           uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "approval_requested_at" timestamptz,
  "approved_at"           timestamptz,
  "approved_by"           uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "sent_back_note"        text,
  "pay_on"                date,
  "memo"                  text,
  "agency_week_start"     date,
  "billed_hours"          numeric(10,2) CHECK ("billed_hours" IS NULL OR "billed_hours" >= 0),
  "checks"                jsonb NOT NULL DEFAULT '{}'::jsonb,
  "voided_at"             timestamptz,
  "void_reason"           text,
  "posting_seq"           int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"         uuid,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bills_number_check" CHECK ("number" IS NOT NULL OR "status" = 'draft'),
  CONSTRAINT "bills_balance_check" CHECK ("balance_cents" = "total_cents" - "paid_cents" - "credited_cents"),
  CONSTRAINT "bills_void_reason_check" CHECK ("status" <> 'void' OR "void_reason" IS NOT NULL),
  CONSTRAINT "bills_scheduled_check" CHECK ("status" <> 'scheduled' OR "pay_on" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger"."bill_lines" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bill_id"        uuid NOT NULL,
  "position"       int NOT NULL DEFAULT 0,
  "description"    text NOT NULL DEFAULT '',
  "account_id"     uuid NOT NULL,
  "quantity"       "ledger"."qty",
  "unit_price"     "ledger"."price",
  "unit_label"     text,
  "amount_cents"   "ledger"."cents" NOT NULL,
  "customer_id"    uuid REFERENCES "core"."customers"("id"),
  "pulse_job_id"   uuid,
  "wms_po_code"    text,
  "wms_po_line_id" uuid,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."bill_payments" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"        text,
  "vendor_id"     uuid NOT NULL REFERENCES "core"."vendors"("id"),
  "paid_on"       date NOT NULL,
  "account_id"    uuid NOT NULL,
  "method"        text NOT NULL DEFAULT 'check' CHECK ("method" IN ('check', 'ach', 'wire', 'card', 'cash')),
  "reference"     text,
  "amount_cents"  "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "memo"          text,
  "posting_seq"   int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id" uuid,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."bill_payment_applications" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bill_payment_id"  uuid,
  "vendor_credit_id" uuid,
  "bill_id"          uuid NOT NULL,
  "amount_cents"     "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "applied_on"       date NOT NULL,
  "removed_at"       timestamptz,
  "removed_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bill_payment_applications_one_source_check" CHECK (num_nonnulls("bill_payment_id", "vendor_credit_id") = 1)
);
--> statement-breakpoint
-- 5.5 Expenses -------------------------------------------------------------------------------
-- reimbursement_payments: one bank payment that pays one or several approved reimbursements
-- (4.8 "several at once in one bank payment"; posting row "Reimbursement paid").
CREATE TABLE "ledger"."reimbursement_payments" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"        text,
  "paid_on"       date NOT NULL,
  "account_id"    uuid NOT NULL,
  "method"        text NOT NULL DEFAULT 'ach' CHECK ("method" IN ('check', 'ach', 'wire', 'card', 'cash')),
  "reference"     text,
  "amount_cents"  "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "memo"          text,
  "posting_seq"   int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id" uuid,
  "is_sample"     boolean NOT NULL DEFAULT false,
  "created_by"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."expenses" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                   uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"                   text,
  "kind"                     text NOT NULL CHECK ("kind" IN ('card', 'reimbursement')),
  "spent_on"                 date NOT NULL,
  "submitted_by"             uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "paid_from_account_id"     uuid,
  "merchant"                 text,
  "amount_cents"             "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("amount_cents" >= 0),
  "status"                   text NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected', 'paid')),
  "approver_id"              uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "submitted_at"             timestamptz,
  "approved_at"              timestamptz,
  "approved_by"              uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "rejected_note"            text,
  "memo"                     text,
  "reimbursement_payment_id" uuid,
  "posting_seq"              int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"            uuid,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "expenses_paid_from_check" CHECK ("kind" <> 'reimbursement' OR "paid_from_account_id" IS NULL),
  CONSTRAINT "expenses_paid_status_check" CHECK ("status" <> 'paid' OR "kind" = 'reimbursement'),
  CONSTRAINT "expenses_card_account_check" CHECK ("kind" <> 'card' OR "status" IN ('draft', 'rejected') OR "paid_from_account_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger"."expense_lines" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "expense_id"   uuid NOT NULL,
  "position"     int NOT NULL DEFAULT 0,
  "account_id"   uuid NOT NULL,
  "amount_cents" "ledger"."cents" NOT NULL CHECK ("amount_cents" >= 0),
  "customer_id"  uuid REFERENCES "core"."customers"("id"),
  "pulse_job_id" uuid,
  "memo"         text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- 5.6 Bank -----------------------------------------------------------------------------------
CREATE TABLE "ledger"."bank_accounts" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "account_id"            uuid NOT NULL,
  "name"                  text NOT NULL CHECK (btrim("name") <> ''),
  "kind"                  text NOT NULL DEFAULT 'bank' CHECK ("kind" IN ('bank', 'card')),
  "last4"                 text CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$'),
  "feed"                  text NOT NULL DEFAULT 'statement_import' CHECK ("feed" IN ('statement_import', 'provider')),
  "provider"              text,
  "provider_ref"          text,
  "currency"              text NOT NULL DEFAULT 'USD' CHECK ("currency" ~ '^[A-Z]{3}$'),
  "opening_balance_cents" "ledger"."cents" NOT NULL DEFAULT 0,
  "opening_date"          date,
  "archived_at"           timestamptz,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bank_accounts_account_key" UNIQUE ("org_id", "account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."bank_imports" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bank_account_id"             uuid NOT NULL,
  "file_name"                   text,
  "file_hash"                   text,
  "format"                      text NOT NULL CHECK ("format" IN ('csv', 'ofx')),
  "line_count"                  int NOT NULL DEFAULT 0 CHECK ("line_count" >= 0),
  "new_count"                   int NOT NULL DEFAULT 0 CHECK ("new_count" >= 0),
  "duplicate_count"             int NOT NULL DEFAULT 0 CHECK ("duplicate_count" >= 0),
  "statement_end_date"          date,
  "statement_end_balance_cents" "ledger"."cents",
  "is_sample"                   boolean NOT NULL DEFAULT false,
  "created_by"                  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."bank_lines" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bank_account_id" uuid NOT NULL,
  "import_id"       uuid,
  "posted_on"       date NOT NULL,
  "amount_cents"    "ledger"."cents" NOT NULL CHECK ("amount_cents" <> 0),
  "description"     text NOT NULL DEFAULT '',
  "check_number"    text,
  "fitid"           text,
  "dedupe_key"      text NOT NULL,
  "status"          text NOT NULL DEFAULT 'unmatched' CHECK ("status" IN ('unmatched', 'matched', 'not_ours')),
  "note"            text,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bank_lines_dedupe_key" UNIQUE ("org_id", "bank_account_id", "dedupe_key"),
  CONSTRAINT "bank_lines_not_ours_check" CHECK ("status" <> 'not_ours' OR "note" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger"."bank_matches" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bank_line_id" uuid NOT NULL,
  "entity_type"  text NOT NULL CHECK ("entity_type" IN ('payment', 'deposit', 'bill_payment', 'expense', 'reimbursement_payment', 'refund', 'transfer', 'journal_entry')),
  "entity_id"    uuid NOT NULL,
  "amount_cents" "ledger"."cents" NOT NULL,
  "confirmed_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "confirmed_at" timestamptz NOT NULL DEFAULT now(),
  "removed_at"   timestamptz,
  "removed_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."bank_rules" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bank_account_id" uuid,
  "contains"        text NOT NULL CHECK (btrim("contains") <> ''),
  "account_id"      uuid,
  "vendor_id"       uuid REFERENCES "core"."vendors"("id"),
  "memo"            text,
  "position"        int NOT NULL DEFAULT 0,
  "active"          boolean NOT NULL DEFAULT true,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."transfers" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "from_account_id" uuid NOT NULL,
  "to_account_id"   uuid NOT NULL,
  "transferred_on"  date NOT NULL,
  "amount_cents"    "ledger"."cents" NOT NULL CHECK ("amount_cents" > 0),
  "memo"            text,
  "posting_seq"     int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "last_entry_id"   uuid,
  "is_sample"       boolean NOT NULL DEFAULT false,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "transfers_accounts_check" CHECK ("from_account_id" <> "to_account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."reconciliations" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"                      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "bank_account_id"             uuid NOT NULL,
  "statement_end_date"          date NOT NULL,
  "statement_end_balance_cents" "ledger"."cents" NOT NULL,
  "cleared_cents"               "ledger"."cents" NOT NULL DEFAULT 0,
  "status"                      text NOT NULL DEFAULT 'in_progress' CHECK ("status" IN ('in_progress', 'finished')),
  "finished_by"                 uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "finished_at"                 timestamptz,
  "matched_line_ids"            uuid[] NOT NULL DEFAULT '{}',
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reconciliations_key" UNIQUE ("org_id", "bank_account_id", "statement_end_date"),
  CONSTRAINT "reconciliations_finished_check" CHECK ("status" <> 'finished' OR "cleared_cents" = "statement_end_balance_cents")
);
--> statement-breakpoint
-- 5.7 Books, close and system ----------------------------------------------------------------
CREATE TABLE "ledger"."journal_entries" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "number"            text,
  "entry_date"        date NOT NULL,
  "period_month"      date NOT NULL,
  "source_type"       text NOT NULL CHECK ("source_type" IN ('invoice', 'credit_note', 'payment', 'refund', 'application', 'write_off', 'deposit', 'bill', 'vendor_credit', 'bill_payment', 'expense', 'reimbursement', 'reimbursement_payment', 'transfer', 'accrual', 'accrual_reversal', 'manual', 'opening', 'payroll')),
  "source_id"         uuid,
  "posting_seq"       int NOT NULL DEFAULT 0 CHECK ("posting_seq" >= 0),
  "reverses_entry_id" uuid,
  "auto_reverse_on"   date,
  "memo"              text,
  "activity_id"       uuid,
  "posted_by"         uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "posted_at"         timestamptz NOT NULL DEFAULT now(),
  "is_sample"         boolean NOT NULL DEFAULT false,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "journal_entries_posting_key" UNIQUE ("org_id", "source_type", "source_id", "posting_seq"),
  CONSTRAINT "journal_entries_period_check" CHECK ("period_month" = date_trunc('month', "entry_date")::date)
);
--> statement-breakpoint
CREATE TABLE "ledger"."journal_lines" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "entry_id"     uuid NOT NULL,
  "line_no"      int NOT NULL CHECK ("line_no" >= 1),
  "account_id"   uuid NOT NULL,
  "debit_cents"  "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("debit_cents" >= 0),
  "credit_cents" "ledger"."cents" NOT NULL DEFAULT 0 CHECK ("credit_cents" >= 0),
  "customer_id"  uuid REFERENCES "core"."customers"("id"),
  "vendor_id"    uuid REFERENCES "core"."vendors"("id"),
  "invoice_id"   uuid,
  "bill_id"      uuid,
  "pulse_job_id" uuid,
  "tax_rate_id"  uuid,
  "memo"         text,
  "entry_date"   date NOT NULL,
  "period_month" date NOT NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "journal_lines_one_side_check" CHECK (("debit_cents" > 0 AND "credit_cents" = 0) OR ("credit_cents" > 0 AND "debit_cents" = 0)),
  CONSTRAINT "journal_lines_line_key" UNIQUE ("org_id", "entry_id", "line_no")
);
--> statement-breakpoint
CREATE TABLE "ledger"."account_month_totals" (
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "account_id"   uuid NOT NULL,
  "period_month" date NOT NULL,
  "debit_cents"  bigint NOT NULL DEFAULT 0,
  "credit_cents" bigint NOT NULL DEFAULT 0,
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "account_month_totals_pkey" PRIMARY KEY ("org_id", "account_id", "period_month")
);
--> statement-breakpoint
CREATE TABLE "ledger"."periods" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "period_month"  date NOT NULL CHECK (extract(day FROM "period_month") = 1),
  "status"        text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'closed')),
  "closed_at"     timestamptz,
  "closed_by"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reopened_at"   timestamptz,
  "reopened_by"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "reopen_reason" text,
  "checklist"     jsonb,
  "snapshot"      jsonb,
  "pulse_locked"  boolean NOT NULL DEFAULT false,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "periods_month_key" UNIQUE ("org_id", "period_month"),
  CONSTRAINT "periods_reopen_check" CHECK ("reopened_at" IS NULL OR "reopen_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger"."close_task_templates" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "title"      text NOT NULL CHECK (btrim("title") <> ''),
  "owner_id"   uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "due_day"    smallint NOT NULL DEFAULT 5 CHECK ("due_day" BETWEEN 1 AND 28),
  "position"   int NOT NULL DEFAULT 0,
  "active"     boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."close_tasks" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "period_month" date NOT NULL CHECK (extract(day FROM "period_month") = 1),
  "template_id"  uuid,
  "title"        text NOT NULL CHECK (btrim("title") <> ''),
  "owner_id"     uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "due_date"     date,
  "done_at"      timestamptz,
  "done_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "pm_task_id"   uuid,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."accruals" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "period_month"      date NOT NULL CHECK (extract(day FROM "period_month") = 1),
  "entry_id"          uuid,
  "reversal_entry_id" uuid,
  "total_cents"       "ledger"."cents" NOT NULL CHECK ("total_cents" >= 0),
  "lines"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source"            text NOT NULL CHECK ("source" IN ('pulse', 'manual')),
  "created_by"        uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."attachments" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "entity_type"  text NOT NULL CHECK ("entity_type" IN ('bill', 'expense', 'invoice', 'bank_import', 'settings')),
  "entity_id"    uuid,
  "name"         text NOT NULL CHECK (btrim("name") <> ''),
  "content_type" text NOT NULL CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'application/pdf')),
  "size_bytes"   int NOT NULL CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  "storage"      text NOT NULL CHECK ("storage" IN ('blob', 'db')),
  "storage_key"  text,
  "data"         bytea,
  "is_sample"    boolean NOT NULL DEFAULT false,
  "uploaded_by"  uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "attachments_storage_data_check" CHECK (("storage" = 'db' AND "data" IS NOT NULL) OR ("storage" = 'blob' AND "storage_key" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ledger"."activity" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "actor_id"    uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "actor_kind"  text NOT NULL DEFAULT 'user' CHECK ("actor_kind" IN ('user', 'system', 'integration', 'automation', 'customer')),
  "verb"        text NOT NULL CHECK ("verb" ~ '^[a-z_]+\.[a-z_]+$'),
  "entity_type" text NOT NULL,
  "entity_id"   uuid,
  "before"      jsonb,
  "after"       jsonb,
  "meta"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."notifications" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "kind"       text NOT NULL,
  "params"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "url"        text CHECK ("url" IS NULL OR ("url" LIKE '/%' AND "url" NOT LIKE '//%')),
  "read_at"    timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."user_prefs" (
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "user_id"    uuid NOT NULL REFERENCES "core"."user"("id") ON DELETE CASCADE,
  "prefs"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_prefs_pkey" PRIMARY KEY ("org_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."import_batches" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"          uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "stream"          text NOT NULL,
  "file_name"       text,
  "file_size"       int,
  "file_hash"       text,
  "delimiter"       text,
  "header"          jsonb,
  "mapping"         jsonb,
  "options"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"          text NOT NULL DEFAULT 'uploading' CHECK ("status" IN ('uploading', 'mapped', 'checked', 'committed', 'failed', 'undone')),
  "total_rows"      int NOT NULL DEFAULT 0,
  "create_count"    int NOT NULL DEFAULT 0,
  "update_count"    int NOT NULL DEFAULT 0,
  "unchanged_count" int NOT NULL DEFAULT 0,
  "skip_count"      int NOT NULL DEFAULT 0,
  "error_count"     int NOT NULL DEFAULT 0,
  "warning_count"   int NOT NULL DEFAULT 0,
  "committed_at"    timestamptz,
  "undone_at"       timestamptz,
  "undo_until"      timestamptz,
  "created_by"      uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."import_rows" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"     uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "batch_id"   uuid NOT NULL,
  "row_number" int NOT NULL,
  "raw"        jsonb,
  "parsed"     jsonb,
  "action"     text CHECK ("action" IN ('create', 'update', 'unchanged', 'skip', 'lookalike', 'error')),
  "messages"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "entity_id"  uuid,
  "before"     jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."import_presets" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"           uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "stream"           text NOT NULL,
  "name"             text NOT NULL,
  "header_signature" text,
  "mapping"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "options"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_used_at"     timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "import_presets_org_stream_name_key" UNIQUE ("org_id", "stream", "name")
);
--> statement-breakpoint
CREATE TABLE "ledger"."bridge_events" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "kind"          text NOT NULL CHECK ("kind" IN ('wms_bill_sent', 'wms_bill_changed', 'crew_hours_approved', 'pulse_month_changed')),
  "target_id"     text NOT NULL,
  "payload"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "claimed_at"    timestamptz,
  "claimed_until" timestamptz,
  "attempts"      int NOT NULL DEFAULT 0,
  "last_error"    text,
  "parked_at"     timestamptz,
  "processed_at"  timestamptz,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Sync tables (8) ----------------------------------------------------------------------------
CREATE TABLE "ledger"."sync_connections" (
  "org_id"             uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "provider"           text NOT NULL CHECK ("provider" IN ('qbo', 'xero')),
  "realm_id"           text,
  "company_name"       text,
  "status"             text NOT NULL DEFAULT 'disconnected' CHECK ("status" IN ('connected', 'needs_reconnect', 'paused', 'disconnected')),
  "access_token_enc"   text,
  "refresh_token_enc"  text,
  "access_expires_at"  timestamptz,
  "refresh_expires_at" timestamptz,
  "start_date"         date,
  "tax_mode"           text,
  "mappings"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "connected_by"       uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
  "last_ok_at"         timestamptz,
  "last_error"         text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sync_connections_pkey" PRIMARY KEY ("org_id", "provider")
);
--> statement-breakpoint
CREATE TABLE "ledger"."sync_objects" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"            uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "provider"          text NOT NULL CHECK ("provider" IN ('qbo', 'xero')),
  "local_type"        text NOT NULL,
  "local_id"          uuid NOT NULL,
  "remote_type"       text,
  "remote_id"         text,
  "remote_sync_token" text,
  "local_version"     int,
  "pushed_hash"       text,
  "status"            text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('synced', 'pending', 'failed', 'conflict', 'skipped')),
  "last_pushed_at"    timestamptz,
  "last_error"        text,
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sync_objects_local_key" UNIQUE ("org_id", "provider", "local_type", "local_id"),
  CONSTRAINT "sync_objects_remote_key" UNIQUE ("org_id", "provider", "remote_type", "remote_id")
);
--> statement-breakpoint
CREATE TABLE "ledger"."sync_queue" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "provider"      text NOT NULL CHECK ("provider" IN ('qbo', 'xero')),
  "local_type"    text NOT NULL,
  "local_id"      uuid NOT NULL,
  "op"            text NOT NULL CHECK ("op" IN ('upsert', 'void', 'delete')),
  "doc_date"      date,
  "attempts"      int NOT NULL DEFAULT 0,
  "next_try_at"   timestamptz NOT NULL DEFAULT now(),
  "claimed_until" timestamptz,
  "parked_at"     timestamptz,
  "last_error"    text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."sync_runs" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "provider"    text NOT NULL CHECK ("provider" IN ('qbo', 'xero')),
  "started_at"  timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "pushed"      int NOT NULL DEFAULT 0,
  "failed"      int NOT NULL DEFAULT 0,
  "skipped"     int NOT NULL DEFAULT 0,
  "errors"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ledger"."remote_changes" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"      uuid NOT NULL REFERENCES "core"."organization"("id") ON DELETE CASCADE,
  "provider"    text NOT NULL CHECK ("provider" IN ('qbo', 'xero')),
  "remote_type" text NOT NULL,
  "remote_id"   text NOT NULL,
  "seen_at"     timestamptz NOT NULL DEFAULT now(),
  "kind"        text NOT NULL CHECK ("kind" IN ('made_in_remote', 'changed_in_remote', 'deleted_in_remote')),
  "status"      text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open', 'brought_in', 'ignored', 'resolved')),
  "payload"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Shared columns -----------------------------------------------------------------------------
-- SD: soft delete (drafts only; posted documents are voided, never deleted). V: optimistic
-- version. SRC: where a document came from, so a sync or a re-import is always an upsert on
-- (org_id, source, source_ref).
DO $$
DECLARE
  t text;
  sd_tables  text[] := ARRAY['invoices', 'bills', 'expenses'];
  v_tables   text[] := ARRAY['accounts', 'items', 'tax_rates', 'terms', 'invoices', 'payments', 'bills', 'bill_payments', 'expenses'];
  src_tables text[] := ARRAY['invoices', 'payments', 'bills', 'bill_payments', 'expenses'];
BEGIN
  FOREACH t IN ARRAY sd_tables LOOP
    EXECUTE format('ALTER TABLE "ledger".%I ADD COLUMN "deleted_at" timestamptz', t);
  END LOOP;
  FOREACH t IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE "ledger".%I ADD COLUMN "version" int NOT NULL DEFAULT 1', t);
  END LOOP;
  FOREACH t IN ARRAY src_tables LOOP
    EXECUTE format($f$ALTER TABLE "ledger".%I
      ADD COLUMN "source" text NOT NULL DEFAULT 'manual' CHECK ("source" IN ('manual','csv','wms','pulse','program','recurring','crew','qbo','system','sample')),
      ADD COLUMN "source_ref" text,
      ADD COLUMN "import_batch_id" uuid,
      ADD COLUMN "is_sample" boolean NOT NULL DEFAULT false,
      ADD COLUMN "created_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL,
      ADD COLUMN "updated_by" uuid REFERENCES "core"."user"("id") ON DELETE SET NULL$f$, t);
    EXECUTE format('CREATE UNIQUE INDEX %I ON "ledger".%I ("org_id", "source", "source_ref") WHERE "source_ref" IS NOT NULL%s',
      t || '_source_ref_key', t, CASE WHEN t = ANY (sd_tables) THEN ' AND "deleted_at" IS NULL' ELSE '' END);
  END LOOP;
  -- No cross org pointers: every table with an id gets UNIQUE (org_id, id).
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
           WHERE c.table_schema = 'ledger' AND c.column_name = 'id' ORDER BY c.table_name LOOP
    EXECUTE format('ALTER TABLE "ledger".%I ADD CONSTRAINT %I UNIQUE ("org_id", "id")', t, t || '_org_id_id_key');
  END LOOP;
END $$;
--> statement-breakpoint
-- Composite foreign keys: child(org_id, column) references parent(org_id, id).
-- NO ACTION (checked at statement end) stands in for RESTRICT so an org cascade can remove
-- parents and children in one statement. 'c' rows cascade from their parent.
DO $$
DECLARE
  fk text[];
  fks text[][] := ARRAY[
    ['settings','default_terms_id','terms','n'], ['settings','logo_attachment_id','attachments','n'],
    ['accounts','parent_id','accounts','n'],
    ['tax_rates','account_id','accounts','n'],
    ['items','account_id','accounts','n'], ['items','tax_rate_id','tax_rates','n'],
    ['source_mappings','item_id','items','n'],
    ['customer_profiles','terms_id','terms','n'], ['customer_profiles','default_tax_rate_id','tax_rates','n'],
    ['vendor_profiles','terms_id','terms','n'], ['vendor_profiles','default_account_id','accounts','n'],
    ['invoices','terms_id','terms','n'], ['invoices','credit_for_invoice_id','invoices','n'],
    ['invoices','recurring_invoice_id','recurring_invoices','n'], ['invoices','last_entry_id','journal_entries','n'],
    ['invoice_lines','invoice_id','invoices','c'], ['invoice_lines','item_id','items','n'],
    ['invoice_lines','account_id','accounts','n'], ['invoice_lines','tax_rate_id','tax_rates','n'],
    ['invoice_sources','invoice_id','invoices','c'], ['invoice_sources','invoice_line_id','invoice_lines','c'],
    ['recurring_invoices','terms_id','terms','n'],
    ['recurring_invoice_lines','recurring_invoice_id','recurring_invoices','c'], ['recurring_invoice_lines','item_id','items','n'],
    ['recurring_invoice_lines','account_id','accounts','n'], ['recurring_invoice_lines','tax_rate_id','tax_rates','n'],
    ['payments','deposit_to_account_id','accounts','n'], ['payments','deposit_id','deposits','n'], ['payments','last_entry_id','journal_entries','n'],
    ['payment_applications','payment_id','payments','c'], ['payment_applications','credit_note_id','invoices','n'],
    ['payment_applications','invoice_id','invoices','n'],
    ['deposits','bank_account_id','bank_accounts','n'], ['deposits','fee_account_id','accounts','n'],
    ['deposits','bank_line_id','bank_lines','n'], ['deposits','last_entry_id','journal_entries','n'],
    ['write_offs','invoice_id','invoices','n'], ['write_offs','account_id','accounts','n'], ['write_offs','last_entry_id','journal_entries','n'],
    ['disputes','invoice_id','invoices','n'], ['disputes','invoice_line_id','invoice_lines','n'], ['disputes','credit_note_id','invoices','n'],
    ['reminder_sends','invoice_id','invoices','c'], ['reminder_sends','email_id','emails','n'],
    ['public_links','invoice_id','invoices','c'],
    ['bills','terms_id','terms','n'], ['bills','last_entry_id','journal_entries','n'],
    ['bill_lines','bill_id','bills','c'], ['bill_lines','account_id','accounts','n'],
    ['bill_payments','account_id','accounts','n'], ['bill_payments','last_entry_id','journal_entries','n'],
    ['bill_payment_applications','bill_payment_id','bill_payments','c'], ['bill_payment_applications','vendor_credit_id','bills','n'],
    ['bill_payment_applications','bill_id','bills','n'],
    ['reimbursement_payments','account_id','accounts','n'], ['reimbursement_payments','last_entry_id','journal_entries','n'],
    ['expenses','paid_from_account_id','accounts','n'], ['expenses','reimbursement_payment_id','reimbursement_payments','n'],
    ['expenses','last_entry_id','journal_entries','n'],
    ['expense_lines','expense_id','expenses','c'], ['expense_lines','account_id','accounts','n'],
    ['bank_accounts','account_id','accounts','n'],
    ['bank_imports','bank_account_id','bank_accounts','n'],
    ['bank_lines','bank_account_id','bank_accounts','n'], ['bank_lines','import_id','bank_imports','n'],
    ['bank_matches','bank_line_id','bank_lines','c'],
    ['bank_rules','bank_account_id','bank_accounts','n'], ['bank_rules','account_id','accounts','n'],
    ['transfers','from_account_id','accounts','n'], ['transfers','to_account_id','accounts','n'], ['transfers','last_entry_id','journal_entries','n'],
    ['reconciliations','bank_account_id','bank_accounts','n'],
    ['journal_entries','reverses_entry_id','journal_entries','n'], ['journal_entries','activity_id','activity','n'],
    ['journal_lines','entry_id','journal_entries','c'], ['journal_lines','account_id','accounts','n'],
    ['journal_lines','invoice_id','invoices','n'], ['journal_lines','bill_id','bills','n'], ['journal_lines','tax_rate_id','tax_rates','n'],
    ['account_month_totals','account_id','accounts','n'],
    ['close_tasks','template_id','close_task_templates','n'],
    ['accruals','entry_id','journal_entries','n'], ['accruals','reversal_entry_id','journal_entries','n'],
    ['import_rows','batch_id','import_batches','c']
  ];
BEGIN
  FOREACH fk SLICE 1 IN ARRAY fks LOOP
    EXECUTE format('ALTER TABLE "ledger".%I ADD CONSTRAINT %I FOREIGN KEY ("org_id", %I) REFERENCES "ledger".%I ("org_id", "id")%s',
      fk[1], fk[1] || '_' || fk[2] || '_fkey', fk[2], fk[3], CASE WHEN fk[4] = 'c' THEN ' ON DELETE CASCADE' ELSE '' END);
  END LOOP;
END $$;
--> statement-breakpoint
-- Unique keys and indexes --------------------------------------------------------------------
CREATE UNIQUE INDEX "accounts_number_key" ON "ledger"."accounts" ("org_id", lower("number")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "accounts_system_key" ON "ledger"."accounts" ("org_id", "system_key") WHERE "system_key" IS NOT NULL;
CREATE INDEX "accounts_type_idx" ON "ledger"."accounts" ("org_id", "type");
CREATE UNIQUE INDEX "items_code_key" ON "ledger"."items" ("org_id", lower("code")) WHERE "archived_at" IS NULL;
CREATE UNIQUE INDEX "terms_default_key" ON "ledger"."terms" ("org_id") WHERE "is_default" AND "active";
CREATE UNIQUE INDEX "terms_name_key" ON "ledger"."terms" ("org_id", lower("name")) WHERE "active";
CREATE UNIQUE INDEX "invoices_number_key" ON "ledger"."invoices" ("org_id", "kind", lower("number")) WHERE "number" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "invoices_status_idx" ON "ledger"."invoices" ("org_id", "status");
CREATE INDEX "invoices_customer_status_idx" ON "ledger"."invoices" ("org_id", "customer_id", "status");
CREATE INDEX "invoices_open_due_idx" ON "ledger"."invoices" ("org_id", "due_date") WHERE "status" IN ('sent', 'partially_paid');
CREATE INDEX "invoices_issue_date_idx" ON "ledger"."invoices" ("org_id", "issue_date");
CREATE INDEX "invoice_lines_position_idx" ON "ledger"."invoice_lines" ("org_id", "invoice_id", "position");
CREATE INDEX "invoice_lines_job_idx" ON "ledger"."invoice_lines" ("org_id", "pulse_job_id") WHERE "pulse_job_id" IS NOT NULL;
CREATE UNIQUE INDEX "invoice_sources_live_key" ON "ledger"."invoice_sources" ("org_id", "source_type", "source_ref") WHERE "active";
CREATE INDEX "invoice_sources_invoice_idx" ON "ledger"."invoice_sources" ("org_id", "invoice_id");
CREATE INDEX "recurring_invoices_due_idx" ON "ledger"."recurring_invoices" ("next_run_date") WHERE "active";
CREATE INDEX "recurring_invoice_lines_position_idx" ON "ledger"."recurring_invoice_lines" ("org_id", "recurring_invoice_id", "position");
CREATE UNIQUE INDEX "payments_number_key" ON "ledger"."payments" ("org_id", lower("number")) WHERE "number" IS NOT NULL;
CREATE INDEX "payments_customer_idx" ON "ledger"."payments" ("org_id", "customer_id", "received_on");
CREATE INDEX "payments_deposit_idx" ON "ledger"."payments" ("org_id", "deposit_id");
CREATE INDEX "payment_applications_invoice_idx" ON "ledger"."payment_applications" ("org_id", "invoice_id");
CREATE INDEX "payment_applications_payment_idx" ON "ledger"."payment_applications" ("org_id", "payment_id");
CREATE INDEX "write_offs_invoice_idx" ON "ledger"."write_offs" ("org_id", "invoice_id");
CREATE INDEX "disputes_invoice_idx" ON "ledger"."disputes" ("org_id", "invoice_id");
CREATE INDEX "promises_customer_idx" ON "ledger"."promises" ("org_id", "customer_id", "status");
CREATE INDEX "public_links_invoice_idx" ON "ledger"."public_links" ("org_id", "invoice_id");
CREATE UNIQUE INDEX "bills_number_key" ON "ledger"."bills" ("org_id", "kind", lower("number")) WHERE "number" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "bills_vendor_ref_key" ON "ledger"."bills" ("org_id", "vendor_id", lower("vendor_ref")) WHERE "vendor_ref" IS NOT NULL AND "deleted_at" IS NULL AND "status" <> 'void';
CREATE INDEX "bills_status_idx" ON "ledger"."bills" ("org_id", "status");
CREATE INDEX "bills_vendor_idx" ON "ledger"."bills" ("org_id", "vendor_id");
CREATE INDEX "bills_open_due_idx" ON "ledger"."bills" ("org_id", "due_date") WHERE "status" IN ('approved', 'scheduled');
CREATE INDEX "bills_approver_idx" ON "ledger"."bills" ("org_id", "approver_id", "status");
CREATE INDEX "bill_lines_position_idx" ON "ledger"."bill_lines" ("org_id", "bill_id", "position");
CREATE UNIQUE INDEX "bill_payments_number_key" ON "ledger"."bill_payments" ("org_id", lower("number")) WHERE "number" IS NOT NULL;
CREATE INDEX "bill_payment_applications_bill_idx" ON "ledger"."bill_payment_applications" ("org_id", "bill_id");
CREATE UNIQUE INDEX "expenses_number_key" ON "ledger"."expenses" ("org_id", lower("number")) WHERE "number" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "expenses_submitter_idx" ON "ledger"."expenses" ("org_id", "submitted_by", "status");
CREATE INDEX "expenses_spent_on_idx" ON "ledger"."expenses" ("org_id", "spent_on");
CREATE INDEX "expense_lines_position_idx" ON "ledger"."expense_lines" ("org_id", "expense_id", "position");
CREATE INDEX "bank_lines_posted_idx" ON "ledger"."bank_lines" ("org_id", "bank_account_id", "posted_on");
CREATE INDEX "bank_lines_unmatched_idx" ON "ledger"."bank_lines" ("org_id", "status") WHERE "status" = 'unmatched';
CREATE INDEX "bank_matches_line_idx" ON "ledger"."bank_matches" ("org_id", "bank_line_id") WHERE "removed_at" IS NULL;
CREATE INDEX "bank_matches_entity_idx" ON "ledger"."bank_matches" ("org_id", "entity_type", "entity_id") WHERE "removed_at" IS NULL;
CREATE UNIQUE INDEX "journal_entries_number_key" ON "ledger"."journal_entries" ("org_id", lower("number")) WHERE "number" IS NOT NULL;
CREATE INDEX "journal_entries_date_idx" ON "ledger"."journal_entries" ("org_id", "entry_date");
CREATE INDEX "journal_entries_period_idx" ON "ledger"."journal_entries" ("org_id", "period_month");
CREATE INDEX "journal_entries_source_idx" ON "ledger"."journal_entries" ("org_id", "source_type", "source_id");
CREATE INDEX "journal_lines_account_date_idx" ON "ledger"."journal_lines" ("org_id", "account_id", "entry_date");
CREATE INDEX "journal_lines_customer_idx" ON "ledger"."journal_lines" ("org_id", "customer_id") WHERE "customer_id" IS NOT NULL;
CREATE INDEX "journal_lines_vendor_idx" ON "ledger"."journal_lines" ("org_id", "vendor_id") WHERE "vendor_id" IS NOT NULL;
CREATE INDEX "journal_lines_entry_idx" ON "ledger"."journal_lines" ("org_id", "entry_id");
CREATE INDEX "journal_lines_invoice_idx" ON "ledger"."journal_lines" ("org_id", "invoice_id") WHERE "invoice_id" IS NOT NULL;
CREATE INDEX "close_tasks_month_idx" ON "ledger"."close_tasks" ("org_id", "period_month");
CREATE INDEX "accruals_month_idx" ON "ledger"."accruals" ("org_id", "period_month");
CREATE INDEX "attachments_entity_idx" ON "ledger"."attachments" ("org_id", "entity_type", "entity_id");
CREATE INDEX "activity_entity_idx" ON "ledger"."activity" ("org_id", "entity_type", "entity_id", "created_at" DESC);
CREATE INDEX "activity_created_idx" ON "ledger"."activity" ("org_id", "created_at" DESC);
CREATE INDEX "notifications_user_idx" ON "ledger"."notifications" ("org_id", "user_id", "read_at");
CREATE INDEX "import_rows_batch_idx" ON "ledger"."import_rows" ("org_id", "batch_id", "row_number");
CREATE UNIQUE INDEX "bridge_events_pending_key" ON "ledger"."bridge_events" ("org_id", "kind", "target_id") WHERE "processed_at" IS NULL;
CREATE INDEX "bridge_events_waiting_idx" ON "ledger"."bridge_events" ("org_id", "created_at") WHERE "processed_at" IS NULL;
CREATE UNIQUE INDEX "sync_queue_pending_key" ON "ledger"."sync_queue" ("org_id", "provider", "local_type", "local_id") WHERE "parked_at" IS NULL;
CREATE INDEX "sync_queue_due_idx" ON "ledger"."sync_queue" ("next_try_at") WHERE "parked_at" IS NULL;
CREATE INDEX "remote_changes_open_idx" ON "ledger"."remote_changes" ("org_id", "status") WHERE "status" = 'open';
--> statement-breakpoint
-- Triggers -----------------------------------------------------------------------------------
-- SQLSTATEs: KL001 unbalanced entry, KL002 append only, KL003 closed month, KL004 cross org
-- customer or vendor, KL005 system account, KL006 tax rate in use, KL007 lines do not add up.
--
-- Balanced at commit (4.3). A deferred constraint trigger on both journal tables: at commit every
-- touched entry must have two or more lines and equal debits and credits, to the cent.
CREATE OR REPLACE FUNCTION "ledger"."check_entry_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry uuid;
  v_lines int;
  v_debit bigint;
  v_credit bigint;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    v_entry := NEW."id";
  ELSE
    v_entry := NEW."entry_id";
  END IF;
  -- Removed again in the same transaction (purge, seed wipe): nothing to check.
  IF NOT EXISTS (SELECT 1 FROM "ledger"."journal_entries" WHERE "id" = v_entry) THEN
    RETURN NULL;
  END IF;
  SELECT count(*), COALESCE(sum("debit_cents"), 0), COALESCE(sum("credit_cents"), 0)
    INTO v_lines, v_debit, v_credit
    FROM "ledger"."journal_lines" WHERE "entry_id" = v_entry;
  IF v_lines < 2 THEN
    RAISE EXCEPTION 'journal_unbalanced:% has % line(s); an entry needs two or more', v_entry, v_lines USING ERRCODE = 'KL001';
  END IF;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'journal_unbalanced:% debits % and credits % differ', v_entry, v_debit, v_credit USING ERRCODE = 'KL001';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_entries_balanced" AFTER INSERT ON "ledger"."journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger"."check_entry_balanced"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_balanced" AFTER INSERT ON "ledger"."journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger"."check_entry_balanced"();
--> statement-breakpoint
-- Append only (4.3, 4.12). A mistake is fixed by a reversing entry, never an edit. Lets the
-- statement through under SET LOCAL ledger.allow_purge = 'on' (purge, seed wipe, "Clear sample
-- data") and for a DELETE when the org row is already gone (org cascade).
CREATE OR REPLACE FUNCTION "ledger"."append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('ledger.allow_purge', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "core"."organization" WHERE "id" = OLD."org_id") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'append_only:ledger.% rows cannot be changed or removed. Post a reversing entry instead.', TG_TABLE_NAME USING ERRCODE = 'KL002';
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger"."journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."append_only"();
--> statement-breakpoint
CREATE TRIGGER "journal_lines_append_only" BEFORE UPDATE OR DELETE ON "ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."append_only"();
--> statement-breakpoint
-- The activity log: UPDATE never; DELETE stays allowed (org cascade, purge, 7 year retention).
CREATE TRIGGER "activity_append_only" BEFORE UPDATE ON "ledger"."activity"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."append_only"();
--> statement-breakpoint
-- Every new entry: stamp period_month from entry_date, and refuse a closed month (KL003,
-- message month_closed:YYYY-MM). Nothing moves a date on its own.
CREATE OR REPLACE FUNCTION "ledger"."journal_entries_before_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  closed date;
BEGIN
  NEW."period_month" := date_trunc('month', NEW."entry_date")::date;
  IF current_setting('ledger.allow_purge', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT p."period_month" INTO closed
    FROM "ledger"."periods" p
   WHERE p."org_id" = NEW."org_id" AND p."status" = 'closed' AND p."period_month" = NEW."period_month"
   LIMIT 1;
  IF closed IS NOT NULL THEN
    RAISE EXCEPTION 'month_closed:%', to_char(closed, 'YYYY-MM') USING ERRCODE = 'KL003';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_stamp" BEFORE INSERT ON "ledger"."journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."journal_entries_before_insert"();
--> statement-breakpoint
-- A line copies its entry's dates (fast reports), so a line can never disagree with its entry.
CREATE OR REPLACE FUNCTION "ledger"."journal_lines_before_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT e."entry_date", e."period_month" INTO NEW."entry_date", NEW."period_month"
    FROM "ledger"."journal_entries" e WHERE e."id" = NEW."entry_id" AND e."org_id" = NEW."org_id";
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_stamp" BEFORE INSERT ON "ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."journal_lines_before_insert"();
--> statement-breakpoint
-- account_month_totals is kept in the same transaction as every line (reports read it).
CREATE OR REPLACE FUNCTION "ledger"."journal_lines_totals"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "ledger"."account_month_totals" ("org_id", "account_id", "period_month", "debit_cents", "credit_cents")
    VALUES (NEW."org_id", NEW."account_id", NEW."period_month", NEW."debit_cents", NEW."credit_cents")
    ON CONFLICT ("org_id", "account_id", "period_month") DO UPDATE
      SET "debit_cents" = "account_month_totals"."debit_cents" + EXCLUDED."debit_cents",
          "credit_cents" = "account_month_totals"."credit_cents" + EXCLUDED."credit_cents",
          "updated_at" = now();
    RETURN NEW;
  END IF;
  UPDATE "ledger"."account_month_totals"
     SET "debit_cents" = "debit_cents" - OLD."debit_cents", "credit_cents" = "credit_cents" - OLD."credit_cents", "updated_at" = now()
   WHERE "org_id" = OLD."org_id" AND "account_id" = OLD."account_id" AND "period_month" = OLD."period_month";
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_totals" AFTER INSERT OR DELETE ON "ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."journal_lines_totals"();
--> statement-breakpoint
-- Org guard: a customer_id or vendor_id must belong to the row's org (the FKs to core are plain).
-- TG_ARGV lists the columns to check; a column ending in vendor_id is checked against core.vendors.
CREATE OR REPLACE FUNCTION "ledger"."guard_party_org"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  i int;
  col text;
  v_id uuid;
  ok boolean;
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    col := TG_ARGV[i];
    v_id := (to_jsonb(NEW) ->> col)::uuid;
    CONTINUE WHEN v_id IS NULL;
    IF col LIKE '%vendor_id' THEN
      SELECT EXISTS (SELECT 1 FROM "core"."vendors" v WHERE v."id" = v_id AND v."org_id" = NEW."org_id") INTO ok;
    ELSE
      SELECT EXISTS (SELECT 1 FROM "core"."customers" c WHERE c."id" = v_id AND c."org_id" = NEW."org_id") INTO ok;
    END IF;
    IF NOT ok THEN
      RAISE EXCEPTION 'cross_org:ledger.%.% points at a row of another workspace', TG_TABLE_NAME, col USING ERRCODE = 'KL004';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ['customer_profiles', 'customer_id'], ['program_billing', 'customer_id'], ['invoices', 'customer_id'],
    ['recurring_invoices', 'customer_id'], ['payments', 'customer_id'], ['promises', 'customer_id'],
    ['bill_lines', 'customer_id'], ['expense_lines', 'customer_id'],
    ['vendor_profiles', 'vendor_id'], ['bills', 'vendor_id'], ['bill_payments', 'vendor_id'], ['bank_rules', 'vendor_id']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON "ledger".%I FOR EACH ROW EXECUTE FUNCTION "ledger"."guard_party_org"(%L)',
      spec[1] || '_party_org', spec[2], spec[1], spec[2]);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_party_org" BEFORE INSERT ON "ledger"."journal_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."guard_party_org"('customer_id', 'vendor_id');
--> statement-breakpoint
-- A system account (posting needs it) can be renamed and renumbered, never archived or retyped.
CREATE OR REPLACE FUNCTION "ledger"."guard_system_account"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."system_key" IS NOT NULL AND NEW."archived_at" IS NOT NULL THEN
      RAISE EXCEPTION 'system_account:% cannot be archived', NEW."system_key" USING ERRCODE = 'KL005';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."system_key" IS NOT NULL AND (
       NEW."archived_at" IS NOT NULL OR NEW."type" <> OLD."type" OR NEW."system_key" IS DISTINCT FROM OLD."system_key") THEN
    RAISE EXCEPTION 'system_account:% can be renamed but not archived or retyped', OLD."system_key" USING ERRCODE = 'KL005';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "accounts_system_guard" BEFORE INSERT OR UPDATE ON "ledger"."accounts"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."guard_system_account"();
--> statement-breakpoint
-- A tax rate is never edited once a line uses it: a new rate is a new row (4.5.5).
CREATE OR REPLACE FUNCTION "ledger"."guard_tax_rate_in_use"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."rate_millionths" <> OLD."rate_millionths" AND (
       EXISTS (SELECT 1 FROM "ledger"."invoice_lines" l WHERE l."org_id" = OLD."org_id" AND l."tax_rate_id" = OLD."id")
       OR EXISTS (SELECT 1 FROM "ledger"."recurring_invoice_lines" l WHERE l."org_id" = OLD."org_id" AND l."tax_rate_id" = OLD."id")) THEN
    RAISE EXCEPTION 'tax_rate_in_use:make a new rate and archive this one' USING ERRCODE = 'KL006';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "tax_rates_in_use" BEFORE UPDATE OF "rate_millionths" ON "ledger"."tax_rates"
  FOR EACH ROW EXECUTE FUNCTION "ledger"."guard_tax_rate_in_use"();
--> statement-breakpoint
-- Stored totals equal their stamped lines (4.2 "stamp once, sum always"), checked at commit for
-- every document that is not a draft. Drafts are checked when they are sent or approved.
CREATE OR REPLACE FUNCTION "ledger"."check_document_lines"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_doc uuid;
  v_status text;
  v_deleted timestamptz;
  v_head_amount bigint;
  v_head_tax bigint;
  v_sum_amount bigint;
  v_sum_tax bigint;
BEGIN
  IF TG_TABLE_NAME IN ('invoices', 'bills', 'expenses') THEN
    v_doc := NEW."id";
  ELSIF TG_TABLE_NAME = 'invoice_lines' THEN
    v_doc := COALESCE(NEW."invoice_id", OLD."invoice_id");
  ELSIF TG_TABLE_NAME = 'bill_lines' THEN
    v_doc := COALESCE(NEW."bill_id", OLD."bill_id");
  ELSE
    v_doc := COALESCE(NEW."expense_id", OLD."expense_id");
  END IF;
  IF TG_TABLE_NAME IN ('invoices', 'invoice_lines') THEN
    SELECT i."status", i."deleted_at", i."subtotal_cents", i."tax_cents" INTO v_status, v_deleted, v_head_amount, v_head_tax
      FROM "ledger"."invoices" i WHERE i."id" = v_doc;
    SELECT COALESCE(sum("amount_cents"), 0), COALESCE(sum("tax_cents"), 0) INTO v_sum_amount, v_sum_tax
      FROM "ledger"."invoice_lines" WHERE "invoice_id" = v_doc;
  ELSIF TG_TABLE_NAME IN ('bills', 'bill_lines') THEN
    SELECT b."status", b."deleted_at", b."total_cents", 0 INTO v_status, v_deleted, v_head_amount, v_head_tax
      FROM "ledger"."bills" b WHERE b."id" = v_doc;
    SELECT COALESCE(sum("amount_cents"), 0), 0 INTO v_sum_amount, v_sum_tax
      FROM "ledger"."bill_lines" WHERE "bill_id" = v_doc;
  ELSE
    SELECT x."status", x."deleted_at", x."amount_cents", 0 INTO v_status, v_deleted, v_head_amount, v_head_tax
      FROM "ledger"."expenses" x WHERE x."id" = v_doc;
    SELECT COALESCE(sum("amount_cents"), 0), 0 INTO v_sum_amount, v_sum_tax
      FROM "ledger"."expense_lines" WHERE "expense_id" = v_doc;
  END IF;
  IF v_status IS NULL OR v_status = 'draft' OR v_deleted IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF v_head_amount <> v_sum_amount OR v_head_tax <> v_sum_tax THEN
    RAISE EXCEPTION 'lines_mismatch:ledger.% % stores % and % but its lines add to % and %', TG_TABLE_NAME, v_doc, v_head_amount, v_head_tax, v_sum_amount, v_sum_tax
      USING ERRCODE = 'KL007';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices', 'bills', 'expenses'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON "ledger".%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger"."check_document_lines"()',
      t || '_lines_match', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['invoice_lines', 'bill_lines', 'expense_lines'] LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON "ledger".%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger"."check_document_lines"()',
      t || '_lines_match', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- A bank line's live matches add up to its amount exactly (4.9), checked at commit.
CREATE OR REPLACE FUNCTION "ledger"."check_bank_matches"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_line uuid := COALESCE(NEW."bank_line_id", OLD."bank_line_id");
  v_amount bigint;
  v_live int;
  v_sum bigint;
BEGIN
  SELECT "amount_cents" INTO v_amount FROM "ledger"."bank_lines" WHERE "id" = v_line;
  IF v_amount IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*), COALESCE(sum("amount_cents"), 0) INTO v_live, v_sum
    FROM "ledger"."bank_matches" WHERE "bank_line_id" = v_line AND "removed_at" IS NULL;
  IF v_live > 0 AND v_sum <> v_amount THEN
    RAISE EXCEPTION 'match_mismatch:bank line % is % but its matches add to %', v_line, v_amount, v_sum USING ERRCODE = 'KL007';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "bank_matches_sum" AFTER INSERT OR UPDATE OR DELETE ON "ledger"."bank_matches"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "ledger"."check_bank_matches"();
--> statement-breakpoint
-- Row level security (R13): one policy on every table, ledger_org_isolation, on the session
-- setting ledger.org_id. A role with no setting sees nothing and writes nothing. The owner (the
-- app login) skips RLS until LEDGER_DB_GUARD=1 makes every statement run as ledger_app.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'ledger' AND c.relkind IN ('r', 'p')
     ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE "ledger".%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "ledger_org_isolation" ON "ledger".%I', t.tablename);
    EXECUTE format(
      'CREATE POLICY "ledger_org_isolation" ON "ledger".%I AS PERMISSIVE FOR ALL TO PUBLIC '
      || 'USING ("org_id" = (SELECT NULLIF(current_setting(''ledger.org_id'', true), '''')::uuid)) '
      || 'WITH CHECK ("org_id" = (SELECT NULLIF(current_setting(''ledger.org_id'', true), '''')::uuid))',
      t.tablename
    );
  END LOOP;
END $$;
--> statement-breakpoint
-- The plain role for the database guard (Pulse 0009 and 0012, copied): no login, owns nothing,
-- cannot skip row level security. Each step is skipped with a NOTICE where the migration role may
-- not do it; /api/health then answers guard ready false.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ledger 0000: skipped CREATE ROLE ledger_app (not allowed for %). Ask a database admin to make it.', current_user;
  WHEN duplicate_object THEN
    NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  modern constant boolean := current_setting('server_version_num')::int >= 160000;
  can_set boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    RAISE NOTICE 'ledger 0000: role ledger_app is missing, nothing to grant.';
    RETURN;
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  IF modern THEN
    can_set := pg_has_role(current_user, 'ledger_app', 'SET');
  ELSE
    can_set := pg_has_role(current_user, 'ledger_app', 'MEMBER');
  END IF;
  IF can_set THEN
    RETURN;
  END IF;
  IF modern THEN
    EXECUTE format('GRANT ledger_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  ELSE
    EXECUTE format('GRANT ledger_app TO %I', current_user);
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ledger 0000: skipped GRANT ledger_app TO % (not allowed). Ask a database admin to run: GRANT ledger_app TO % WITH SET TRUE;', current_user, current_user;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    RAISE NOTICE 'ledger 0000: role ledger_app is missing, grants skipped.';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA ledger TO ledger_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ledger TO ledger_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ledger TO ledger_app;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ledger TO ledger_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ledger GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ledger_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ledger GRANT USAGE, SELECT ON SEQUENCES TO ledger_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA ledger GRANT EXECUTE ON FUNCTIONS TO ledger_app;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ledger 0000: skipped the grants on schema ledger (not allowed for %).', current_user;
END $$;
--> statement-breakpoint
-- ledger_app reads the core rows of its own workspace: organization, member and user (sign in
-- joins), and customers and vendors (Ledger keeps its money settings beside them and may add
-- rows for a shop that runs Ledger alone). Each policy is for ledger_app only, so nothing in core
-- changes for the other apps.
DO $$
DECLARE
  org_setting constant text := '(SELECT NULLIF(current_setting(''ledger.org_id'', true), '''')::uuid)';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    RAISE NOTICE 'ledger 0000: role ledger_app is missing, core grants skipped.';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA core TO ledger_app;
  GRANT SELECT ON core.organization, core.member, core."user" TO ledger_app;
  GRANT SELECT, INSERT, UPDATE ON core.customers, core.vendors TO ledger_app;

  DROP POLICY IF EXISTS "ledger_app_read_own_org" ON core.organization;
  EXECUTE 'CREATE POLICY "ledger_app_read_own_org" ON core.organization AS PERMISSIVE FOR SELECT TO ledger_app USING ("id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "ledger_app_read_own_org" ON core.member;
  EXECUTE 'CREATE POLICY "ledger_app_read_own_org" ON core.member AS PERMISSIVE FOR SELECT TO ledger_app USING ("organization_id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "ledger_app_read_own_org" ON core."user";
  EXECUTE 'CREATE POLICY "ledger_app_read_own_org" ON core."user" AS PERMISSIVE FOR SELECT TO ledger_app USING ("id" IN (SELECT m."user_id" FROM core.member m WHERE m."organization_id" = ' || org_setting || '))';

  DROP POLICY IF EXISTS "ledger_app_own_org" ON core.customers;
  EXECUTE 'CREATE POLICY "ledger_app_own_org" ON core.customers AS PERMISSIVE FOR ALL TO ledger_app USING ("org_id" = ' || org_setting || ') WITH CHECK ("org_id" = ' || org_setting || ')';

  DROP POLICY IF EXISTS "ledger_app_own_org" ON core.vendors;
  EXECUTE 'CREATE POLICY "ledger_app_own_org" ON core.vendors AS PERMISSIVE FOR ALL TO ledger_app USING ("org_id" = ' || org_setting || ') WITH CHECK ("org_id" = ' || org_setting || ')';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'ledger 0000: skipped the grants on core (not allowed for %).', current_user;
END $$;
