/**
 * Job Management "Print ▾" documents (Logiwa 02 §1): Job Pick List, Job Content, Pick
 * Short Consolidation, Mobile Cart Layout and Packing List — one PDF for the selected
 * jobs, rendered with the foundation PdfWriter.
 */
import { eq, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { PdfWriter, type TableColumn } from "@/server/print/pdf";
import { loadJob } from "./jobs";
import { cellDisplayName } from "@/lib/grid-defs/facility/mobile-carts";

export const JOB_PRINT_DOCS = ["pick-list", "job-content", "pick-short", "cart-layout", "packing-list"] as const;
export type JobPrintDoc = (typeof JOB_PRINT_DOCS)[number];

export const JOB_PRINT_TITLES: Readonly<Record<JobPrintDoc, string>> = {
  "pick-list": "Job Pick List",
  "job-content": "Job Content",
  "pick-short": "Pick Short Consolidation",
  "cart-layout": "Mobile Cart Layout",
  "packing-list": "Packing List",
};

interface TaskLine {
  readonly location: string; readonly sku: string; readonly name: string; readonly qty: number; readonly actual: number;
  readonly orderCode: string; readonly lot: string; readonly lpn: string; readonly status: string; readonly taskType: string;
  readonly pickShort: string; readonly walk: number | null; readonly target: string;
}

function taskLines(db: AppDb, jobId: string): TaskLine[] {
  return db.all<TaskLine>(sql`SELECT COALESCE(sl.code, '-') AS location, COALESCE(p.sku, '-') AS sku, COALESCE(p.name, '') AS name,
      t.planned_qty AS qty, t.actual_qty AS actual, COALESCE(o.code, '-') AS orderCode, COALESCE(t.lot_number, '') AS lot,
      COALESCE((SELECT lp.number FROM license_plates lp WHERE lp.id = t.source_lp_id), '') AS lpn, t.status, t.task_type AS taskType,
      t.pick_short_status AS pickShort, sl.walking_path_priority AS walk, COALESCE(tl.code, '') AS target
    FROM tasks t LEFT JOIN products p ON p.id = t.product_id LEFT JOIN locations sl ON sl.id = t.source_location_id
      LEFT JOIN locations tl ON tl.id = t.target_location_id LEFT JOIN shipment_orders o ON o.id = t.order_id
    WHERE t.job_id = ${jobId} AND t.status <> 'Cancelled' ORDER BY COALESCE(sl.walking_path_priority, 999999), sl.code, p.sku`);
}

const PICK_COLUMNS: readonly TableColumn<TaskLine>[] = [
  { label: "Location", width: 0.15, value: (l) => l.location },
  { label: "SKU", width: 0.17, value: (l) => l.sku },
  { label: "Description", width: 0.26, value: (l) => l.name },
  { label: "LP / Lot", width: 0.14, value: (l) => [l.lpn, l.lot].filter(Boolean).join(" / ") },
  { label: "Order", width: 0.12, value: (l) => l.orderCode },
  { label: "Qty", width: 0.08, align: "right", value: (l) => String(l.qty) },
  { label: "Picked", width: 0.08, value: () => "[  ]" },
];

const CONTENT_COLUMNS: readonly TableColumn<TaskLine>[] = [
  { label: "Type", width: 0.11, value: (l) => l.taskType },
  { label: "Order", width: 0.12, value: (l) => l.orderCode },
  { label: "SKU", width: 0.16, value: (l) => l.sku },
  { label: "Description", width: 0.23, value: (l) => l.name },
  { label: "From", width: 0.12, value: (l) => l.location },
  { label: "To", width: 0.1, value: (l) => l.target || "-" },
  { label: "Qty", width: 0.07, align: "right", value: (l) => `${l.actual}/${l.qty}` },
  { label: "Status", width: 0.09, value: (l) => l.status },
];

function header(w: PdfWriter, title: string, job: typeof schema.jobs.$inferSelect, extra: readonly (readonly [string, unknown])[] = []): void {
  w.text(title, { size: 18, bold: true });
  w.text(`${job.code} · ${job.jobType}`, { size: 11, muted: true });
  w.moveDown(4);
  w.keyValues([["Status", job.status], ["Priority", job.priority], ["Wave", job.waveNumber ?? "-"], ["Orders", job.orderCount], ["Tasks", job.taskCount], ...extra]);
  w.moveDown(8);
}

async function renderDoc(db: AppDb, w: PdfWriter, doc: JobPrintDoc, job: typeof schema.jobs.$inferSelect): Promise<void> {
  const lines = taskLines(db, job.id);
  const title = JOB_PRINT_TITLES[doc];
  switch (doc) {
    case "pick-list": {
      header(w, title, job);
      w.table(PICK_COLUMNS, lines.filter((l) => l.taskType === "Picking" && l.status !== "Completed"));
      w.moveDown(16);
      w.text("Picked by: ____________________     Date: ____________", { size: 9, muted: true });
      return;
    }
    case "job-content": {
      header(w, title, job);
      w.table(CONTENT_COLUMNS, lines);
      return;
    }
    case "pick-short": {
      const shorts = lines.filter((l) => l.pickShort === "Open");
      header(w, title, job, [["Short lines", shorts.length]]);
      w.table(PICK_COLUMNS.slice(0, 6).map((c) => (c.label === "Qty" ? { ...c, label: "Short", value: (l: TaskLine) => String(Math.max(0, l.qty - l.actual)) } : c)), shorts);
      return;
    }
    case "cart-layout": {
      const cart = job.mobileCartId ? db.select().from(schema.mobileCarts).where(eq(schema.mobileCarts.id, job.mobileCartId)).get() : undefined;
      header(w, title, job, [["Cart", cart?.code ?? "-"], ["Layout", cart ? `${cart.levels} levels x ${cart.columns} columns` : "-"]]);
      const orders = [...new Set(lines.map((l) => l.orderCode))];
      const cols = Math.max(1, cart?.columns ?? 4);
      // The cell each order was put in (put-to-cart, REQ-R10-6), named like the cart's cell grid and
      // labels (A01 · MC-01-A01); orders not placed yet show the cell they would get, in order.
      const placed = new Map(cart ? db.all<{ code: string; level: number; col: number; barcode: string }>(sql`SELECT so.code AS code, c.level AS level, c."column" AS col, c.barcode AS barcode
        FROM mobile_cart_cells c JOIN shipment_orders so ON so.id = c.order_id WHERE c.cart_id = ${cart.id}`).map((r) => [r.code, `${cellDisplayName(r.level, r.col)} · ${r.barcode}`]) : []);
      w.table<{ cell: string; order: string; units: string }>(
        [{ label: "Cell", width: 0.32, value: (r) => r.cell }, { label: "Order", width: 0.43, value: (r) => r.order }, { label: "Units", width: 0.25, align: "right", value: (r) => r.units }],
        orders.map((o, i) => ({ cell: placed.get(o) ?? cellDisplayName(Math.floor(i / cols) + 1, (i % cols) + 1), order: o, units: String(lines.filter((l) => l.orderCode === o && l.taskType === "Picking").reduce((s, l) => s + l.qty, 0)) })),
      );
      return;
    }
    case "packing-list": {
      const orders = [...new Set(lines.map((l) => l.orderCode))];
      for (const [i, code] of orders.entries()) {
        if (i > 0) w.newPage();
        header(w, `${title} · ${code}`, job);
        w.table(CONTENT_COLUMNS.filter((c) => ["SKU", "Description", "Qty"].includes(c.label)), lines.filter((l) => l.orderCode === code && l.taskType === "Picking"));
      }
      if (orders.length === 0) header(w, title, job);
    }
  }
}

/** Guard reasons shown on the disabled Print items. */
export function printGuard(db: AppDb, doc: JobPrintDoc, jobIds: readonly string[]): string | null {
  if (doc === "pick-short") {
    const any = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM tasks WHERE pick_short_status = 'Open' AND job_id IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`)?.n ?? 0;
    if (Number(any) === 0) return "None of the selected jobs has an open pick short";
  }
  if (doc === "cart-layout") {
    const any = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM jobs WHERE mobile_cart_id IS NOT NULL AND id IN (${sql.join(jobIds.map((id) => sql`${id}`), sql`, `)})`)?.n ?? 0;
    if (Number(any) === 0) return "None of the selected jobs uses a mobile cart";
  }
  return null;
}

export async function renderJobsPdf(db: AppDb, auth: AuthContext, doc: JobPrintDoc, jobIds: readonly string[]): Promise<Uint8Array> {
  const reason = printGuard(db, doc, jobIds);
  if (reason) throw new AppError("INVALID_STATE", reason);
  const jobs = jobIds.map((id) => loadJob(db, auth, id));
  const w = await PdfWriter.create(undefined, 36, `${JOB_PRINT_TITLES[doc]} ${jobs[0]?.code ?? ""}`);
  for (const [i, job] of jobs.entries()) {
    if (i > 0) w.newPage();
    await renderDoc(db, w, doc, job);
  }
  return w.finish(`Printed ${new Date().toLocaleString("en-US")}`);
}
