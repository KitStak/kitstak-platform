/**
 * `POST /api/locations/generator { ...pattern, skipExisting }` — creates the pattern.
 * Collisions block the run unless `skipExisting`. Above 500 locations the run continues in
 * the background (chunked transactions) and the user is notified when it finishes.
 */
import { after } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { result } from "@/server/api/envelope";
import { GENERATOR_BACKGROUND_ABOVE, generatorSchema } from "@/lib/grid-defs/facility/location-generator";
import { planGenerator, runGeneratorInBackground, runGeneratorNow } from "@/server/repositories/locations-generator";
import { withWriteTx } from "@/server/db/sql";

const bodySchema = z.intersection(generatorSchema, z.object({ skipExisting: z.boolean().default(false) }));

export const POST = defineRoute({
  permission: "settings.locations.create",
  transaction: false,
  body: bodySchema,
  handler: async ({ db, auth, actor, body }) => {
    const plan = await planGenerator(db, auth, body, body.skipExisting);
    if (plan.rows.length > GENERATOR_BACKGROUND_ABOVE) {
      after(async () => await runGeneratorInBackground(db, auth, actor, body, plan));
      return result({ created: 0, queued: plan.rows.length, skipped: plan.collisions.length, collisions: plan.collisions.slice(0, 50), background: true }, { status: 202 });
    }
    return await withWriteTx(db, async (tx) => await runGeneratorNow(tx, auth, actor, body, plan));
  },
});
