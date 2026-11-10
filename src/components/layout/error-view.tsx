"use client";

import * as React from "react";
import { AlertOctagon, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HomeLink, StatusScreen } from "./status-screen";

/** Digest of a server error (matches server logs); never the raw message in production. */
export function errorDigest(error: unknown): string | null {
  if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string") return error.digest;
  return null;
}

/** Error boundary body: friendly copy, Retry, and the digest for support. */
export function ErrorView({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  const digest = errorDigest(error);
  return (
    <StatusScreen
      icon={AlertOctagon}
      tone="danger"
      title="Something went wrong"
      description={
        <>
          <p>This page hit an unexpected error. Your data is safe — try again, or head back to the dashboard.</p>
          {digest ? <p className="mt-2 text-[11px] text-faint">Reference: <code className="font-mono">{digest}</code></p> : null}
        </>
      }
      actions={
        <>
          <Button variant="secondary" size="lg" onClick={() => retry()}>
            <RotateCw className="h-4 w-4" aria-hidden />
            Retry
          </Button>
          <HomeLink />
        </>
      }
    />
  );
}
