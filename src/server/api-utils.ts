import { NextResponse } from "next/server";
import { z } from "zod";

/** Standard API envelope: { success, data?, error?, meta? } */
export interface ApiMeta {
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: ApiMeta;
}

export function ok<T>(data: T, meta?: ApiMeta): NextResponse<ApiEnvelope<T>> {
  const body: ApiEnvelope<T> = meta ? { success: true, data, meta } : { success: true, data };
  return NextResponse.json(body);
}

export function badRequest(error: string): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export function notFound(error = "Not found"): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ success: false, error }, { status: 404 });
}

export function serverError(context: string, error: unknown): NextResponse<ApiEnvelope<never>> {
  console.error(`[api] ${context}:`, error);
  return NextResponse.json(
    { success: false, error: "Internal server error" },
    { status: 500 }
  );
}

/** Base pagination/search query schema shared across list endpoints. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

/** Read a Request's search params into a plain record for zod parsing. */
export function queryOf(request: Request): Record<string, string> {
  const url = new URL(request.url);
  return Object.fromEntries(url.searchParams.entries());
}

/** Format a ZodError into a short, user-readable message. */
export function zodMessage(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid query";
  const path = first.path.join(".");
  return path ? `Invalid query: ${path} — ${first.message}` : `Invalid query: ${first.message}`;
}
