'use client';
/**
 * The shared plan banner, placed by the Portal. The words come from the server. This wrapper only
 * knows which page it is on:
 *   - the welcome screen never carries a calm (info) plan banner. A person who just started a free
 *     trial reads "Your apps are ready", not a request to pay.
 *   - on the plan picker and on the review and pay screens the banner keeps its words but loses
 *     its button. That page is already the place the button would lead to, and each screen has
 *     one main button.
 */
import { usePathname } from 'next/navigation';
import { PlanBanner, type PlanBannerNotice } from '@kitstak/ui/plan-banner';

/** Pages that are the "Pick a plan" step themselves. */
const PLAN_STEPS = ['/billing/plan', '/billing/checkout'];
/** Banner kinds whose button leads to the plan picker. */
const PLAN_KINDS = new Set(['trial', 'trial_ending', 'trial_ended', 'ended']);

export function shellNoticeFor(notice: PlanBannerNotice | null, pathname: string): PlanBannerNotice | null {
  if (notice === null) return null;
  if (pathname === '/welcome' && notice.tone === 'info') return null;
  const onPlanStep = PLAN_STEPS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (onPlanStep && PLAN_KINDS.has(notice.kind)) {
    // The calm trial line says nothing the page does not say itself.
    if (notice.tone === 'info') return null;
    return { ...notice, action: null };
  }
  return notice;
}

export function ShellPlanBanner({ notice, className }: { readonly notice: PlanBannerNotice | null; readonly className?: string }) {
  const pathname = usePathname();
  return <PlanBanner notice={shellNoticeFor(notice, pathname)} dismissible className={className} />;
}
