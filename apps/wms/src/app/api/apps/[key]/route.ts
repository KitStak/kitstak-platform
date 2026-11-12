/**
 * `PATCH /api/apps/[key]` — `{ isActive }` activates / deactivates; `{ settings }` saves the gear panel.
 * Managing apps needs Company Settings: Update (the catalog's Add-Ons key is view-only).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { setAppActive, updateAppSettings } from "@/server/repositories/apps";

const params = z.object({ key: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/) });
const body = z.union([z.object({ isActive: z.boolean() }).strict(), z.object({ settings: z.record(z.string().max(60), z.unknown()) }).strict()]);

export const PATCH = defineRoute({
  permission: "settings.company_settings.update",
  params,
  body,
  handler: async ({ db, auth, actor, params: p, body: b, audit }) => {
    if ("isActive" in b) {
      const result = await setAppActive(db, auth, actor, p.key, b.isActive);
      await audit({ action: b.isActive ? "app.activate" : "app.deactivate", entity: "app", entityId: p.key });
      return result;
    }
    const result = await updateAppSettings(db, auth, actor, p.key, b.settings);
    await audit({ action: "app.settings", entity: "app", entityId: p.key });
    return result;
  },
});
