"use client";

import { ErrorView } from "@/components/layout/error-view";

export default function AppError({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
