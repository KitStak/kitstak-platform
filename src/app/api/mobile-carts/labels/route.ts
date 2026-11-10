/** `POST /api/mobile-carts/labels { ids, include }` — `mobile-cart-label` records for carts and/or their cells (read-only). */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { bulkIds } from "@/lib/grid-defs/facility/common";
import { mobileCartLabelRecords } from "@/server/repositories/mobile-carts";

const body = bulkIds.extend({ include: z.enum(["carts", "cells", "both"]).default("both") });

export const POST = defineRoute({
  permission: "settings.mobile_carts.label",
  transaction: false,
  body,
  handler: ({ db, auth, body }) => mobileCartLabelRecords(db, auth, body.ids, body.include),
});
