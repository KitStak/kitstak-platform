import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "./brand-logo";

/** Centered card layout for the public auth pages (forgot / reset password). */
export function AuthFrame({ title, description, children }: { readonly title: string; readonly description: React.ReactNode; readonly children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10">
      <Link href="/login" aria-label="KitStak home" className="mb-8 flex items-center">
        <BrandLogo tone="light" height={24} showProduct />
      </Link>
      <main className="w-full max-w-[400px]">
        <div className="rounded-xl border border-border bg-surface p-8 shadow-lg">
          <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <div className="mt-1 text-sm text-secondary">{description}</div>
          <div className="mt-5">{children}</div>
        </div>
        <Link href="/login" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to log in
        </Link>
      </main>
    </div>
  );
}
