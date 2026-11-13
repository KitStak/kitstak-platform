-- Integration links pinned the sibling app's host at write time (cached_url =
-- 'http://localhost:3000/receiving/<id>'), so chips pointed at the wrong host after a domain
-- change, a preview deploy or a dev server on another port. Keep only the path, query and hash;
-- Projects adds the current NEXT_PUBLIC_CRM_URL / NEXT_PUBLIC_WMS_URL when it renders the link
-- (src/server/integrations/link-url.ts).
UPDATE pm.integration_links
   SET cached_url = regexp_replace(cached_url, '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*', '')
 WHERE cached_url ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://';
--> statement-breakpoint
UPDATE pm.integration_links SET cached_url = '/' WHERE cached_url = '';
