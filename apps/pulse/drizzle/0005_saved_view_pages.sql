-- Saved views for two more lists: the audit log and the export page (data team).
-- Their filters live in the URL like every other list, so the shared saved views bar
-- (src/features/views) can store them. Only the allowed page names change.
ALTER TABLE "pulse"."saved_views" DROP CONSTRAINT "saved_views_page_check";
--> statement-breakpoint
ALTER TABLE "pulse"."saved_views" ADD CONSTRAINT "saved_views_page_check" CHECK ("page" IN ('jobs', 'profit', 'log', 'labor', 'reports', 'alerts', 'audit', 'export'));
