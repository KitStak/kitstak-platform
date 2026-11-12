/** `POST /api/locations/generator/preview` — count, first 20 codes and collisions (read-only). */
import { defineRoute } from "@/server/api/define-route";
import { generatorSchema } from "@/lib/grid-defs/facility/location-generator";
import { previewGenerator } from "@/server/repositories/locations-generator";

export const POST = defineRoute({
  permission: "settings.locations.create",
  transaction: false,
  rateLimit: false,
  body: generatorSchema,
  handler: async ({ db, auth, body }) => await previewGenerator(db, auth, body),
});
