/**
 * `GET /api/company/return-rules` — Return Process parameters (8 switches + version).
 * `PUT` — save them (optimistic `version` on the company row; 409 when stale).
 */
import { defineRoute } from "@/server/api/define-route";
import { returnRulesSchema } from "@/lib/grid-defs/admin/return-rules";
import { getReturnRulesState, updateReturnRules } from "@/server/repositories/company-return-rules";

export const GET = defineRoute({
  permission: ["settings.data_setup.view", "settings.company_settings.view"],
  handler: async ({ db }) => await getReturnRulesState(db),
});

export const PUT = defineRoute({
  permission: "settings.data_setup.view",
  body: returnRulesSchema,
  handler: async ({ db, auth, actor, body, audit }) => {
    const state = await updateReturnRules(db, auth, actor, body);
    await audit({ action: "return_rules.update", entity: "company", entityId: "company", detail: Object.fromEntries(Object.entries(state.rules).map(([k, v]) => [k, v])) });
    return state;
  },
});
