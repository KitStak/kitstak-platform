"use client";

import "./globals.css";
import { ErrorView } from "@/components/layout/error-view";

/** Replaces the root layout when it fails, so it renders its own document. */
export default function GlobalError({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col antialiased">
        <title>Something went wrong · KitStak WMS</title>
        <ErrorView error={error} retry={retry} />
      </body>
    </html>
  );
}
