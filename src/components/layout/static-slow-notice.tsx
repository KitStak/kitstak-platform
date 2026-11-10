/**
 * JS-free "still loading" / "did not load" notice for server-rendered streaming fallbacks (the
 * app shell skeleton included): timed with CSS animation delays (10 s / 30 s), Retry is a plain
 * link that reloads the URL. A client timer cannot help when the client chunks never hydrate on
 * an overloaded server (fulfillment-jobs R6b-4, facility-config REQ-R8-3). Lifted from M03.
 */
const CSS = `
@keyframes ks-shell-reveal { to { visibility: visible; height: auto; opacity: 1; } }
@keyframes ks-shell-hide { to { visibility: hidden; height: 0; opacity: 0; padding: 0; border-width: 0; margin: 0; } }
[data-ks-shell-slow] { visibility: hidden; height: 0; opacity: 0; overflow: hidden; animation: ks-shell-reveal 0s 10s forwards, ks-shell-hide 0s 30s forwards; }
[data-ks-shell-failed] { visibility: hidden; height: 0; opacity: 0; overflow: hidden; animation: ks-shell-reveal 0s 30s forwards; }
`;

export function StaticSlowNotice({ what = "this page" }: { readonly what?: string }) {
  const title = what;
  return (
    <>
      <style href="ks-shell-skel" precedence="default">{CSS}</style>
      <div data-ks-shell-slow="" role="status" data-testid="slow-load-notice" className="flex max-w-[760px] items-center justify-between gap-3 rounded-md border border-[#E7C46A] bg-[#FFF8E1] px-3 py-2 text-[13px] text-[#6B4E00] dark:border-[#7A5D12] dark:bg-[#2B2410] dark:text-[#F3D98B]">
        <span>Still loading {title}. This is taking longer than usual; the server may be busy.</span>
        <a href="" className="shrink-0 rounded border border-current px-2 py-0.5 text-[12px] font-semibold hover:bg-black/5">Retry</a>
      </div>
      <div data-ks-shell-failed="" role="alert" className="flex max-w-[760px] items-center justify-between gap-3 rounded-md border border-[#E8A99A] bg-[#FDECE8] px-3 py-2 text-[13px] text-[#8A2A12] dark:border-[#7A2A18] dark:bg-[#2B1410] dark:text-[#F5B7A6]">
        <span>{title.charAt(0).toUpperCase() + title.slice(1)} has not loaded after 30 seconds. The server may be busy or unreachable; retry to send the request again.</span>
        <a href="" className="shrink-0 rounded border border-current px-2 py-0.5 text-[12px] font-semibold hover:bg-black/5">Retry</a>
      </div>
    </>
  );
}
