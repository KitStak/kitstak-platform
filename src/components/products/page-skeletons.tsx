/**
 * Route-level loading skeletons for the catalog pages (server-safe, no hooks).
 *
 * The staged slow notices are driven by CSS animation delays, not timers, so they appear
 * even when the client bundle has not hydrated yet (the case where a slow server leaves
 * only streamed HTML on screen). Retry/Reload are plain links to the current URL, so they
 * work without JavaScript.
 */
import { AlertTriangle, Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Seconds before the "taking longer than usual" notice, and before the "not responding" notice. */
export const SLOW_NOTICE_S = 8;
export const STALLED_NOTICE_S = 45;

const STAGE_CSS = `
@keyframes ks-cat-reveal { to { visibility: visible; opacity: 1; } }
@keyframes ks-cat-conceal { to { visibility: hidden; opacity: 0; } }
.ks-cat-slow { visibility: hidden; opacity: 0; animation: ks-cat-reveal 0.2s ease-out ${SLOW_NOTICE_S}s forwards, ks-cat-conceal 0.01s linear ${STALLED_NOTICE_S}s forwards; }
.ks-cat-stalled { visibility: hidden; opacity: 0; animation: ks-cat-reveal 0.2s ease-out ${STALLED_NOTICE_S}s forwards; }
@media (prefers-reduced-motion: reduce) {
  .ks-cat-slow { animation-duration: 0.01s, 0.01s; }
  .ks-cat-stalled { animation-duration: 0.01s; }
}
`;

export function StagedNotices({ title }: { readonly title: string }) {
  const link = (primary: boolean) => cn(buttonVariants({ variant: primary ? "primary" : "secondary", size: "sm" }));
  return (
    <>
      <style>{STAGE_CSS}</style>
      <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center px-4">
        <div className="relative w-full max-w-md">
          <div
            role="status"
            data-testid="catalog-slow-notice"
            className="ks-cat-slow pointer-events-auto absolute inset-x-0 top-0 rounded-lg border border-warning/40 bg-surface p-4 shadow-md"
          >
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-body">This is taking longer than usual</p>
                <p className="mt-0.5 text-xs text-secondary">Still loading {title}. You can keep waiting or retry.</p>
              </div>
              <a href="" className={link(true)}>Retry</a>
            </div>
          </div>
          <div
            role="alert"
            data-testid="catalog-stalled-notice"
            className="ks-cat-stalled pointer-events-auto absolute inset-x-0 top-0 rounded-lg border border-danger/40 bg-surface p-4 shadow-md"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-body">{title} isn&apos;t responding</p>
                <p className="mt-0.5 text-xs text-secondary">
                  The server hasn&apos;t answered in {STALLED_NOTICE_S} seconds. Your data is safe; nothing was saved or changed.
                  Reload to try again. If it keeps happening, contact your administrator.
                </p>
                <div className="mt-3 flex gap-2">
                  <a href="" className={link(true)}>Reload page</a>
                  <a href="/dashboard" className={link(false)}>Go to dashboard</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function ListPageSkeleton({ title }: { readonly title: string }) {
  return (
    <div className="flex flex-col gap-4 px-6 pt-4" aria-busy="true" aria-label={`Loading ${title}`}>
      <Skeleton className="h-3 w-40" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-48" />
        <div className="flex gap-2"><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-40" /></div>
      </div>
      <Skeleton className="h-8 w-full" />
      <div className="relative">
        <SkeletonTable rows={10} columns={8} />
        <StagedNotices title={title} />
      </div>
    </div>
  );
}
