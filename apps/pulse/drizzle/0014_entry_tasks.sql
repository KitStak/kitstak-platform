-- Tag a production entry with the Projects task it was for.
--
-- A program (one priced job, like an Advent calendar run) has steps: prebuild, labels, shippers,
-- kit pack. Those steps live as tasks in the Projects project linked to the job. Until now the only
-- way to see the cost of a step in Pulse was to make a job for it, which split one program's cost
-- from its revenue and counted prep output as finished units.
--
-- This adds two columns to pulse.production_entries:
--   pm_task_id  the pm.tasks row the hours were for. No foreign key: Projects may not be installed,
--               and a task deleted in Projects must not remove Pulse history. Pulse checks the task
--               belongs to a project linked to the job when the entry is saved.
--   task_units  how much of that step got done (puzzles built, labels applied). Optional. Kept apart
--               from units_good: it never counts toward the job's progress, revenue or pace.
--
-- The one-line rule widens to include the task: a job, day, shift and labor class can now hold one
-- line per task (temps on puzzles and temps on kit pack the same day), and still one untagged line.
-- The unique index production_entries_key is rebuilt with the task in it. Every existing row has a
-- null task, so the rebuilt index holds exactly the rows the old one held.
--
-- Both columns are null on every existing row, so nothing changes until someone picks a task.
-- Safe to run again.
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "pm_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "pulse"."production_entries" ADD COLUMN IF NOT EXISTS "task_units" numeric(14,3);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_entries_task_units_check') THEN
    ALTER TABLE "pulse"."production_entries" ADD CONSTRAINT "production_entries_task_units_check"
      CHECK ("task_units" IS NULL OR ("task_units" >= 0 AND "task_units" < 100000000));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_entries_job_task_idx"
  ON "pulse"."production_entries" ("org_id", "job_id", "pm_task_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "pulse"."production_entries_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "production_entries_key" ON "pulse"."production_entries" ("org_id", "job_id", "work_date", "shift", COALESCE("labor_class_id", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("pm_task_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "deleted_at" IS NULL;
