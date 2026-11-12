/**
 * `POST /api/end-of-day/print-custom` — Custom EOD report (totals by client and service).
 * Body is either `{ ids }` (selected manifests) or the standalone dialog's parameters
 * `{ from, to, carrierCodes?, warehouseCodes?, clientName? }` (Logiwa parity: works with no selection).
 */
import { z } from "zod";
import { defineRoute } from "@/server/api/define-route";
import { printCustomReport, printCustomReportByParams } from "@/server/repositories/end-of-day";

const day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Use a YYYY-MM-DD date");
const codes = z.array(z.string().trim().min(1).max(64)).max(50).optional();

const body = z.union([
  z.object({ ids: z.array(z.string().trim().min(1).max(200)).min(1, "Select at least one manifest").max(200) }),
  z.object({ from: day, to: day, carrierCodes: codes, warehouseCodes: codes, clientName: z.string().trim().min(1).max(200).nullish() }),
]);

export const POST = defineRoute({
  permission: "fulfillment.end_of_day.print_custom_report",
  body,
  transaction: false,
  handler: ({ db, auth, body }) => ("ids" in body ? printCustomReport(db, auth, body.ids) : printCustomReportByParams(db, auth, body)),
});
