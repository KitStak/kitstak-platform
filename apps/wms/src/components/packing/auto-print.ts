/**
 * Complete Packing → automatic printing (M04 §2 step 3: "prints the label and packing slip
 * through the user's printer setup"). The plan is PURE (unit tested); `runPrintPlan` sends
 * each document to the KitStaks desktop print agent when it is installed (label → the user's
 * barcode printer, slip → the laser printer for the station's warehouse), and otherwise
 * prints through the browser print dialog from a hidden frame, so nothing depends on pop-ups.
 */

export interface PrinterSetup {
  readonly barcodePrinter: string | null;
  readonly laserPrinter: string | null;
}

export interface PrintJob {
  readonly kind: 'label' | 'slip';
  readonly fileId: string;
  readonly title: string;
  readonly printerType: 'Label Printer' | 'Laser Printer';
  /** The assigned printer name, or null when the user has none for this warehouse. */
  readonly printer: string | null;
}

export interface CompletedDocs {
  readonly shipments: readonly {
    readonly packageSeq: number;
    readonly trackingNumber: string;
    readonly labelFileId: string | null;
  }[];
  readonly packingSlipFileId: string | null;
}

/** Every label (one per package) on the barcode printer, then the packing slip on the laser printer. */
export function printPlan(docs: CompletedDocs, setup: PrinterSetup | null): readonly PrintJob[] {
  const jobs: PrintJob[] = [];
  for (const s of docs.shipments) {
    if (s.labelFileId)
      jobs.push({
        kind: 'label',
        fileId: s.labelFileId,
        title: `Label · package ${s.packageSeq} · ${s.trackingNumber}`,
        printerType: 'Label Printer',
        printer: setup?.barcodePrinter ?? null,
      });
  }
  if (docs.packingSlipFileId)
    jobs.push({
      kind: 'slip',
      fileId: docs.packingSlipFileId,
      title: 'Packing slip',
      printerType: 'Laser Printer',
      printer: setup?.laserPrinter ?? null,
    });
  return jobs;
}

/** One-line summary for the success card ("Label → ZEBRA-01 · Packing slip → HP-LASER"). */
export function printSummary(jobs: readonly PrintJob[], via: 'agent' | 'browser'): string {
  if (jobs.length === 0) return 'No documents to print.';
  const labels = jobs.filter((j) => j.kind === 'label');
  const slip = jobs.find((j) => j.kind === 'slip');
  const where = (j: PrintJob | undefined) =>
    via === 'agent' ? (j?.printer ?? 'default printer') : 'print dialog';
  const parts: string[] = [];
  if (labels.length)
    parts.push(`${labels.length === 1 ? 'Label' : `${labels.length} labels`} → ${where(labels[0])}`);
  if (slip) parts.push(`Packing slip → ${where(slip)}`);
  return parts.join(' · ');
}

interface PrintAgent {
  print(input: {
    readonly url: string;
    readonly printerType: string;
    readonly copies: number;
    readonly printerName?: string;
  }): Promise<void>;
}

function agent(): PrintAgent | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { kitstakPrintAgent?: unknown }).kitstakPrintAgent;
  return candidate && typeof (candidate as PrintAgent).print === 'function'
    ? (candidate as PrintAgent)
    : null;
}

const fileUrl = (id: string) => `/api/files/${encodeURIComponent(id)}`;

/** Prints one PDF through the browser from a hidden iframe (no new tab, no pop-up blocker). */
function framePrint(url: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    const cleanup = () => setTimeout(() => frame.remove(), 60_000);
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      cleanup();
      resolve();
    };
    frame.src = url;
    document.body.appendChild(frame);
  });
}

/** Runs the plan; resolves with how it printed. Errors are reported per job, never thrown. */
export async function runPrintPlan(
  jobs: readonly PrintJob[],
): Promise<{ readonly via: 'agent' | 'browser'; readonly failed: readonly string[] }> {
  const a = agent();
  const failed: string[] = [];
  for (const job of jobs) {
    try {
      if (a)
        await a.print({
          url: fileUrl(job.fileId),
          printerType: job.printerType,
          copies: 1,
          ...(job.printer ? { printerName: job.printer } : {}),
        });
      else await framePrint(fileUrl(job.fileId));
    } catch {
      failed.push(job.title);
    }
  }
  return { via: a ? 'agent' : 'browser', failed };
}
