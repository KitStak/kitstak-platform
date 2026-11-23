/**
 * The rows under the portal's top bar (docs/billing/CONTRACTS.md section 16.5), in this order:
 *   1. the "Test mode" strip in `stripe_test` and `test_gateway` mode,
 *   2. the plan notice, with the same words every product app shows (`planNoticeFor`),
 *   3. the verify email notice until the address is verified.
 * A server component: it reads the plan once per request and renders nothing when all is well.
 */
import { planNoticeFor, type PlanNotice } from '@kitstak/billing/plan-state';
import { PlanBanner } from '@kitstak/ui/plan-banner';
import { getBillingContext } from '@/server/billing/context';
import { getOrgPlan } from '@/server/entitlements';
import { PortalNoticeBar } from './portal-notice-bar';

/** Portal paths, so a banner button is an in app navigation, not a full reload of the same origin. */
function localHref(href: string, portalUrl: string): string {
  return href.startsWith(portalUrl) ? href.slice(portalUrl.length) || '/' : href;
}

/** Lines the shared banner up with the Portal's centered 1120 px page column. */
const BANNER_COLUMN = '[--ks-planbanner-max-width:1120px] [--ks-planbanner-pad-x:16px] sm:[--ks-planbanner-pad-x:24px]';

export async function ShellNotices() {
  const context = await getBillingContext();
  if (!context) return null;
  const { rt, org, access, emailVerified, timeZone } = context;
  const { state } = await getOrgPlan(org.id);

  const testMode = state.mode === 'stripe_test' || state.mode === 'test_gateway';
  const found = planNoticeFor(state, {
    module: null,
    viewer: { canManage: access.canManage, canView: access.canView, ownerName: access.ownerName },
    portalUrl: rt.portalUrl,
    now: rt.now(),
    timeZone,
  });
  const plan: PlanNotice | null = found
    ? { ...found, action: found.action ? { label: found.action.label, href: localHref(found.action.href, rt.portalUrl) } : null }
    : null;
  if (!testMode && !plan && emailVerified) return null;
  return (
    <div data-testid="shell-notices">
      {testMode ? (
        <PortalNoticeBar
          notice={{ kind: 'test_mode', tone: 'test', text: 'Test mode. No real money moves.', action: null, testId: 'test-mode-label' }}
        />
      ) : null}
      {/* The same banner, words and test ids as in CRM, WMS, Projects and Pulse. */}
      <PlanBanner notice={plan} dismissible className={BANNER_COLUMN} />
      {emailVerified ? null : (
        <PortalNoticeBar
          notice={{
            kind: 'verify_email',
            tone: 'info',
            text: 'Check your email for a 6 digit code to verify your address.',
            action: { label: 'Enter code', href: '/verify-email', testId: 'verify-email-action' },
            testId: 'verify-email-notice',
          }}
        />
      )}
    </div>
  );
}
