-- Pulse program tracker: money check (docs/programs/PULSE_PROGRAMS_SPEC.md 8).
--
-- Read only. Run it against production before the deploy that applies pulse 0016, save the output,
-- run it again after the deploy and the first program sync, and compare. Every row must match:
-- the tracker is a read model and must not move any money.
--
-- One row per job that a program links to, plus one row per program for rows billed to other jobs.
SELECT 'job' AS scope,
       j.org_id,
       j.number AS ref,
       (SELECT coalesce(sum(p.base_revenue_cents), 0) FROM pulse.production_entries p
         WHERE p.org_id = j.org_id AND p.job_id = j.id AND p.deleted_at IS NULL) AS production_revenue_cents,
       (SELECT count(*) FROM pulse.production_entries p
         WHERE p.org_id = j.org_id AND p.job_id = j.id AND p.deleted_at IS NULL) AS production_rows,
       (SELECT coalesce(sum(r.amount_cents), 0) FROM pulse.revenue_entries r
         WHERE r.org_id = j.org_id AND r.job_id = j.id AND r.deleted_at IS NULL) AS revenue_entry_cents,
       (SELECT count(*) FROM pulse.revenue_entries r
         WHERE r.org_id = j.org_id AND r.job_id = j.id AND r.deleted_at IS NULL) AS revenue_rows
  FROM pulse.jobs j
 WHERE EXISTS (SELECT 1 FROM pulse.job_links l
                WHERE l.org_id = j.org_id AND l.job_id = j.id AND l.target_type IN ('pm_program', 'pm_build'))
UNION ALL
SELECT 'program',
       p.org_id,
       p.pm_program_id::text,
       coalesce(sum(p.base_revenue_cents), 0),
       count(*),
       NULL,
       NULL
  FROM pulse.production_entries p
 WHERE p.pm_program_id IS NOT NULL AND p.deleted_at IS NULL
 GROUP BY p.org_id, p.pm_program_id
 ORDER BY 1, 2, 3;
