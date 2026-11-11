-- Module-owned tables that the app also creates on demand (CREATE TABLE IF NOT EXISTS in
-- src/server/scheduler/store.ts, repositories/packing-drafts.ts and
-- repositories/shipping-carrier-ops.ts). They are created here too, with the same DDL, so
-- that on Supabase they exist from deploy time with ROW LEVEL SECURITY enabled: a table the
-- app created at runtime would otherwise be readable and writable through the anon Data API
-- (e.g. an anon upsert of scheduler_lease would stop every cron tick). The runtime
-- CREATE ... IF NOT EXISTS statements become no-ops. Keep the DDL in sync with the code.
CREATE TABLE IF NOT EXISTS scheduler_lease (
  name TEXT PRIMARY KEY NOT NULL,
  owner TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scheduler_task_runs (
  task_key TEXT PRIMARY KEY NOT NULL,
  last_started_at TEXT,
  last_finished_at TEXT,
  last_status TEXT,
  last_message TEXT,
  run_count INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS pack_drafts (
  order_id TEXT PRIMARY KEY NOT NULL,
  station_id TEXT,
  state TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS eod_auto_close_rules (
  id TEXT PRIMARY KEY NOT NULL,
  warehouse_id TEXT NOT NULL,
  carrier_connection_id TEXT NOT NULL,
  cutoff_time TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_date TEXT,
  last_run_at TEXT,
  last_result TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS eod_auto_close_conn_idx ON eod_auto_close_rules (warehouse_id, carrier_connection_id);
--> statement-breakpoint
ALTER TABLE "scheduler_lease" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scheduler_task_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pack_drafts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "eod_auto_close_rules" ENABLE ROW LEVEL SECURITY;
