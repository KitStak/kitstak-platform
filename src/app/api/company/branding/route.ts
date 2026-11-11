/**
 * `GET /api/company/branding` — the company display name and logo URL for the app shell
 * (any signed-in user; no settings permission needed). The top bar shows the uploaded logo
 * and falls back to the KitStak mark when there is none.
 */
import { defineRoute } from "@/server/api/define-route";
import { getCompany } from "@/server/repositories/company";

export const GET = defineRoute({
  handler: async ({ db }) => {
    const company = await getCompany(db);
    return { displayName: company.displayName, logoUrl: company.logoUrl };
  },
});
