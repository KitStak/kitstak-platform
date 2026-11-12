/**
 * `/api/cron/tick` authentication: `Authorization: Bearer <CRON_SECRET>`.
 * Constant-time comparison; a missing or short secret disables the endpoint.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const MIN_CRON_SECRET_LENGTH = 32;

export type CronAuthResult = "ok" | "unauthorized" | "not_configured";

const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

export function verifyCronAuthorization(header: string | null | undefined, secret: string | undefined = process.env.CRON_SECRET): CronAuthResult {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH) return "not_configured";
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  if (!match?.[1]) return "unauthorized";
  return timingSafeEqual(digest(match[1].trim()), digest(secret)) ? "ok" : "unauthorized";
}
