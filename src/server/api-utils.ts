import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";

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

export function unauthorized(error = "Authentication required"): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ success: false, error }, { status: 401 });
}

/**
 * Cryptographically verify the session JWT for an API route.
 * Middleware only checks cookie presence, so every data route must call this.
 * Returns a 401 response to send when the session is missing/invalid, or null when authenticated.
 */
export async function requireSession(): Promise<NextResponse<ApiEnvelope<never>> | null> {
  const user = await getSessionUser();
  return user ? null : unauthorized();
}

export function forbidden(error = "Insufficient permissions"): NextResponse<ApiEnvelope<never>> {
  return NextResponse.json({ success: false, error }, { status: 403 });
}

/**
 * Like requireSession, but additionally requires one of the given roles.
 * Returns the 401/403 response to send, or null when authorized.
 */
export async function requireRole(
  roles: readonly string[]
): Promise<NextResponse<ApiEnvelope<never>> | null> {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return roles.includes(user.role) ? null : forbidden();
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
