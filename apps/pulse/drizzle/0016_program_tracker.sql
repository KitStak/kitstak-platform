-- Program tracker (docs/programs/PULSE_PROGRAMS_SPEC.md 2.2 and 8).
--
-- A program in Projects bills to one ongoing per unit Pulse job, its program job. Pulse now tracks
-- that job as a program, under Programs, and leaves it out of the Jobs list. This adds:
--   jobs.program_job   true for a job a `pm_program` link points at. The program sync keeps it:
--                      set when the mirror is written, cleared when the mirror goes. It lets lists
--                      and redirects tell program jobs apart without a join.
--   jobs_program_job_idx   for list filters on program jobs
--
-- The backfill sets the flag on every job that already has a `pm_program` mirror (the programs
-- linked in production), so no one has to convert them by hand. Every other job keeps false, so
-- nothing changes for it. Safe to run again.
ALTER TABLE "pulse"."jobs" ADD COLUMN IF NOT EXISTS "program_job" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "pulse"."jobs" AS j SET "program_job" = true
 WHERE j."program_job" = false
   AND EXISTS (SELECT 1 FROM "pulse"."job_links" l WHERE l."org_id" = j."org_id" AND l."job_id" = j."id" AND l."target_type" = 'pm_program');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_program_job_idx" ON "pulse"."jobs" ("org_id") WHERE "program_job" AND "deleted_at" IS NULL;
