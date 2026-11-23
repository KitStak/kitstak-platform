import { notFound, redirect } from 'next/navigation';
import { TEST_CARDS, getTestCardUpdate } from '@kitstak/billing/gateway/test';
import { billingRuntime } from '@/server/billing/runtime';
import { isActiveOrgMember } from '@/server/orgs';
import { getSession } from '@/server/session';
import { Card } from '@/components/ui';
import { cardExpiry, cardLabel } from '@/features/billing/format';
import { TestCardUpdate } from '@/features/test-gateway/test-card-update';

/** The test gateway's card page. Same guards as the test checkout page. */
export default async function TestCardPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const rt = billingRuntime();
  if (rt.mode !== 'test_gateway' || !/^[A-Za-z0-9_]{4,120}$/.test(sessionId)) notFound();
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/test-gateway/card/${sessionId}`)}`);
  const view = await getTestCardUpdate(rt.db, sessionId);
  if (!view || !(await isActiveOrgMember(session.user.id, view.orgId))) notFound();

  return (
    <div data-testid="test-checkout" className="mx-auto flex max-w-[460px] flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-fg-muted">{view.orgName}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-fg">Update your card</h1>
        <p className="mt-1 text-md text-fg-secondary">
          {view.current
            ? `Your card now: ${cardLabel(view.current)}, expires ${cardExpiry(view.current)}.`
            : 'You have no card on file yet.'}{' '}
          If a payment is due, we try it right after you save.
        </p>
      </div>
      <Card as="section" aria-label="New card" className="p-5 sm:p-6">
        <TestCardUpdate
          sessionId={view.sessionId}
          cards={TEST_CARDS.filter((card) => card.outcome !== 'requires_action').map((card) => ({
            number: card.number,
            label: card.label.replace('Works now, fails at the next renewal', 'Fails at next renewal'),
            outcome: card.outcome,
          }))}
          returnUrl={view.returnUrl}
        />
      </Card>
    </div>
  );
}
