/** Print rendering contracts and shared record schemas. */
import { z } from "zod";
import { PRINT_FORMATS, type PrintFormat } from "./catalog";

export const MAX_PRINT_RECORDS = 1000;
export const MAX_COPIES = 100;

export const printOptionsSchema = z.object({
  format: z.enum(PRINT_FORMATS).optional(),
  copies: z.number().int().min(1).max(MAX_COPIES).default(1),
  /** Label stock; ignored by list printouts. */
  labelSize: z.enum(["4x6", "4x2"]).optional(),
  /** Footer / header company name. */
  companyName: z.string().max(120).optional(),
}).strict();

export type PrintOptions = z.output<typeof printOptionsSchema>;

export const printRequestSchema = z.object({
  typeKey: z.string().min(1).max(80),
  records: z.array(z.unknown()).min(1).max(MAX_PRINT_RECORDS),
  options: printOptionsSchema.default({ copies: 1 }),
});

export type PrintRequest = z.input<typeof printRequestSchema>;

export interface PrintOutput {
  readonly bytes: Uint8Array;
  readonly mime: "application/pdf" | "application/x-zpl";
  readonly format: PrintFormat;
  readonly extension: "pdf" | "zpl";
}

export interface RenderContext {
  readonly typeKey: string;
  readonly typeName: string;
  readonly format: PrintFormat;
  readonly options: PrintOptions;
  readonly now: Date;
}

export interface PrintTemplate<R> {
  readonly recordSchema: z.ZodType<R>;
  render(records: readonly R[], ctx: RenderContext): Promise<PrintOutput>;
}

const str = (max = 200) => z.string().trim().max(max);

export const addressSchema = z.object({
  name: str(),
  company: str().optional(),
  address1: str(),
  address2: str().optional(),
  city: str(),
  state: str(60).optional(),
  postalCode: str(20).optional(),
  country: str(60).optional(),
  phone: str(40).optional(),
});

export type Address = z.output<typeof addressSchema>;

/** Address as printable lines (blank parts dropped). */
export function addressLines(address: Address): string[] {
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [address.name, address.company, address.address1, address.address2, cityLine, address.country, address.phone]
    .filter((line): line is string => typeof line === "string" && line.length > 0);
}

export function pdfOutput(bytes: Uint8Array): PrintOutput {
  return { bytes, mime: "application/pdf", format: "pdf", extension: "pdf" };
}

export function zplOutput(text: string): PrintOutput {
  return { bytes: new TextEncoder().encode(text), mime: "application/x-zpl", format: "zpl", extension: "zpl" };
}

/** `M/D/YYYY h:mm A` (Logiwa display parity) for printed timestamps, in UTC. */
export function formatPrintDate(value: string | Date | undefined | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const h = date.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()} ${hour12}:${minutes} ${h < 12 ? "AM" : "PM"}`;
}

export function formatPrintDay(value: string | Date | undefined | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${date.getUTCFullYear()}`;
}
