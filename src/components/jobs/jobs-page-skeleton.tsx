/**
 * Streaming fallback for every M03 page (critic R5-1). It is server-rendered HTML that needs no
 * JavaScript: on a dev server under load the client chunks can take minutes to arrive (or never
 * hydrate), so a client-timer notice never appears. Here the "taking longer than usual" notice
 * (after 6 s) and the "didn't load" error (after 30 s) are timed with CSS animation delays, and
 * Retry is a plain link that reloads the current URL. The page's default filter chip is drawn
 * statically, so it is visible before the first page of rows arrives.
 */
import { Skeleton } from "@/components/ui/skeleton";

const CSS = `
@keyframes ks-jobs-reveal { to { visibility: visible; height: auto; opacity: 1; } }
@keyframes ks-jobs-hide { to { visibility: hidden; height: 0; opacity: 0; padding: 0; border-width: 0; margin: 0; } }
[data-ks-jobs-skel-slow] { visibility: hidden; height: 0; opacity: 0; overflow: hidden; animation: ks-jobs-reveal 0s 6s forwards, ks-jobs-hide 0s 30s forwards; }
[data-ks-jobs-skel-failed] { visibility: hidden; height: 0; opacity: 0; overflow: hidden; animation: ks-jobs-reveal 0s 30s forwards; }
`;

export interface JobsPageSkeletonProps {
  /** Page title shown immediately (the real header replaces it on hydrate). */
  readonly title: string;
  /** Default filter chip, e.g. { label: "Job status", value: "Pending, Started" }. */
  readonly chip?: { readonly label: string; readonly value: string };
  /** "detail" draws the record header + tabs layout instead of a grid. */
  readonly variant?: "grid" | "detail";
}

/**
 * JS-free slow / failed notice (6 s / 30 s via CSS animation delays; Retry reloads the URL).
 * Safe in any server-rendered streaming fallback, including the app shell skeleton (request R6b-4).
 */
export function StaticSlowNotice({ what }: { readonly what: string }) {
  const title = what;
  return (
    <>
      <style href="ks-jobs-skel" precedence="default">{CSS}</style>
      <div data-ks-jobs-skel-slow="" role="status" data-testid="slow-load-notice" className="flex max-w-[760px] items-center justify-between gap-3 rounded-md border border-[#E7C46A] bg-[#FFF8E1] px-3 py-2 text-[13px] text-[#6B4E00] dark:border-[#7A5D12] dark:bg-[#2B2410] dark:text-[#F3D98B]">
        <span>Still loading {title}. This is taking longer than usual; the server may be busy.</span>
        <a href="" className="shrink-0 rounded border border-current px-2 py-0.5 text-[12px] font-semibold hover:bg-black/5">Retry</a>
      </div>
      <div data-ks-jobs-skel-failed="" role="alert" className="flex max-w-[760px] items-center justify-between gap-3 rounded-md border border-[#E8A99A] bg-[#FDECE8] px-3 py-2 text-[13px] text-[#8A2A12] dark:border-[#7A2A18] dark:bg-[#2B1410] dark:text-[#F5B7A6]">
        <span>{title} has not loaded after 30 seconds. The server may be busy or unreachable; retry to send the request again.</span>
        <a href="" className="shrink-0 rounded border border-current px-2 py-0.5 text-[12px] font-semibold hover:bg-black/5">Retry</a>
      </div>
    </>
  );
}

export function JobsPageSkeleton({ title, chip, variant = "grid" }: JobsPageSkeletonProps) {
  return (
    <div className="space-y-3 px-6 pt-4" aria-busy="true" data-testid="jobs-page-skeleton">
      <StaticSlowNotice what={title} />
      <Skeleton className="h-3 w-48" />
      <h1 className="text-[20px] font-semibold leading-7 text-body">{title}</h1>
      {variant === "detail" ? (
        <>
          <Skeleton className="h-2 w-full max-w-[520px] rounded-full" />
          <div className="flex gap-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-7 w-24" />)}</div>
          <div className="grid gap-4 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 w-full rounded-lg" />)}</div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-72" />
            {chip ? (
              <span className="inline-flex h-9 min-w-[150px] flex-col justify-center rounded-lg border border-primary/30 bg-primary-soft px-2.5 leading-tight" data-testid="default-filter-chip" title={`${chip.label}: ${chip.value}`}>
                <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-primary/80">{chip.label}</span>
                <span className="text-[12px] font-semibold text-primary">{chip.value}</span>
              </span>
            ) : null}
            <Skeleton className="h-8 w-24" />
          </div>
          <div role="status" aria-label={`Loading ${title}`} className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex gap-4 border-b border-border bg-surface-sunken px-4 py-3">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-2.5 flex-1" />)}</div>
            {Array.from({ length: 10 }, (_, r) => (
              <div key={r} className="flex h-10 items-center gap-4 border-b border-border px-4 last:border-b-0">
                {Array.from({ length: 7 }, (_, c) => <Skeleton key={c} className={c === 0 ? "h-3 max-w-[120px] flex-1" : "h-3 flex-1"} />)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
