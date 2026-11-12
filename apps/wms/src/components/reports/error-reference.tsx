"use client";

/**
 * Support line under a failed dashboard / report load: the request id from the JSON error
 * envelope, or — when the server answered with a non-JSON error page (a crashed worker or a
 * build error elsewhere in the app) — the HTTP status and a plain explanation.
 */
import * as React from "react";
import type { ApiError } from "@/lib/api-client";

export function errorReferenceText(error: Pick<ApiError, "status" | "requestId"> | null | undefined): string | null {
  if (!error) return null;
  if (error.requestId) return `Reference ${error.requestId}${error.status ? ` · HTTP ${error.status}` : ""}`;
  if (error.status === 0) return "No response from the server. Check your connection.";
  if (error.status >= 500) return `HTTP ${error.status} · the server returned an error page instead of data. Retry; if it persists, report the time below to support.`;
  return error.status ? `HTTP ${error.status}` : null;
}

export function ErrorReference({ error }: { readonly error: (Pick<ApiError, "status" | "requestId"> & { readonly message?: string }) | null | undefined }) {
  const [at] = React.useState(() => new Date());
  const text = errorReferenceText(error);
  if (!text) return null;
  return (
    <p className="max-w-[56ch] text-2xs text-faint" data-testid="error-reference">
      {text}
      <span className="block tabular-nums">{at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" })}</span>
    </p>
  );
}
