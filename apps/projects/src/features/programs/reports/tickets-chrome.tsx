'use client';
/** The print page frame for build tickets: covers the app, a toolbar with Print and Back, and a print stylesheet that hides everything else. */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui';

export function TicketsChrome({ title, count, backHref, children }: { readonly title: string; readonly count: number; readonly backHref: string; readonly children: ReactNode }) {
  return (
    <div className="tickets-print fixed inset-0 z-[var(--z-modal)] overflow-auto bg-app print:static print:overflow-visible print:bg-white" data-testid="build-tickets">
      <style>{`@media print { body * { visibility: hidden !important; } .tickets-print, .tickets-print * { visibility: visible !important; } .tickets-print { position: absolute !important; inset: 0 !important; } .tickets-toolbar { display: none !important; } @page { margin: 12mm; } }`}</style>
      <div className="tickets-toolbar sticky top-0 z-[1] flex flex-wrap items-center gap-3 border-b border-border-subtle bg-panel px-6 py-3">
        <Link href={backHref} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg">
          <ArrowLeft aria-hidden className="size-4" />
          Back to builds
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-fg">Build tickets</h1>
          <p className="truncate text-xs text-fg-muted">
            {title} · {count} {count === 1 ? 'ticket' : 'tickets'}
          </p>
        </div>
        <Button leadingIcon={<Printer aria-hidden />} onClick={() => window.print()} disabled={count === 0}>
          Print
        </Button>
      </div>
      <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2 print:gap-3 print:p-0">{children}</div>
    </div>
  );
}
