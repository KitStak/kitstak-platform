/** `GET /api/counts/next-code` - the next suggested CNT code (consumed only when a plan uses it). */
import { defineRoute } from "@/server/api/define-route";
import { COUNT_PERMISSIONS as P } from "@/lib/grid-defs/counts/count-grids";
import { nextCountCode } from "@/server/repositories/counts-plans";

export const GET = defineRoute({ permission: [P.create, P.edit], handler: ({ db }) => ({ code: nextCountCode(db) }) });
