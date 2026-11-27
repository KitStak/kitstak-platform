import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { signupIntents } from '@kitstak/db/schema';
import { requirePageSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { invitation, member, organization } from '@/server/db/schema';
import { buildTemplateGallery } from '@/server/services/wizards-gallery';
import { OnboardingFlow, type StarterPreviews } from '@/features/wizards/onboarding/onboarding-flow';
import { STARTER_PREVIEW_IDS } from '@/features/wizards/model/onboarding';

export const metadata: Metadata = { title: 'Welcome' };

/** Mini-board previews for every board a starter CRM can install (the user has no org yet). */
function starterPreviews(): StarterPreviews {
  const previews: Record<string, StarterPreviews[string]> = {};
  for (const entry of buildTemplateGallery()) {
    const board = entry.boards[0];
    if (entry.type === 'board' && board && STARTER_PREVIEW_IDS.includes(entry.id)) previews[entry.id] = { board, accent: entry.accent };
  }
  return previews;
}

/**
 * True when this person was in an organization before: they joined one from an invite, or made one
 * themselves. The same rule as the Portal (`wasInOrganization` there), so a person who was removed
 * reads the Portal's sentence here too, not "yet" (billing review round 5). Fails soft: the plain
 * screen for a new person.
 */
async function wasInOrganization(userId: string, email: string): Promise<boolean> {
  try {
    const [joined, made] = await Promise.all([
      db
        .select({ id: invitation.id })
        .from(invitation)
        .where(and(eq(sql`lower(${invitation.email})`, email.trim().toLowerCase()), eq(invitation.status, 'accepted')))
        .limit(1),
      db
        .select({ id: signupIntents.id })
        .from(signupIntents)
        .where(and(eq(signupIntents.userId, userId), isNotNull(signupIntents.orgId)))
        .limit(1),
    ]);
    return joined.length > 0 || made.length > 0;
  } catch {
    return false;
  }
}

/** First-run setup for signed-in users without an organization (multi-step onboarding). */
export default async function WelcomePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePageSession('/welcome');
  const [existing] = await db
    .select({ slug: organization.slug })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (existing) redirect(`/${existing.slug}`);
  const params = await searchParams;
  // One front door (billing review round 4). A signed in person with no organization gets the same
  // calm answer in every KitStak app: "You are not in an organization yet", and one button to the
  // Portal, where an organization and its free trial are made. Before, the CRM ran a setup of its
  // own here, made an organization with one click, said "Your workspace is ready" and then showed
  // "CRM is not in your plan yet". The CRM's own setup stays for `?local=1` (tests, and a CRM that
  // runs with no Portal address).
  const portal = process.env.NEXT_PUBLIC_PORTAL_URL?.trim().replace(/\/+$/, '');
  if (portal && params.local !== '1') {
    const former = await wasInOrganization(session.user.id, session.user.email);
    return (
      <div className="text-center" data-testid="crm-no-organization" data-former={former ? 'true' : undefined}>
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-sunken">
          <Building2 aria-hidden className="size-6 text-icon" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-fg">{former ? 'You are no longer in an organization' : 'You are not in an organization yet'}</h1>
        <p className="mt-2 text-base text-fg-secondary">
          {former
            ? 'Your account still works, but you are not on a team right now. Ask a teammate to invite you again. Or start your own organization in the Portal.'
            : 'Create one in the Portal, or ask a teammate to invite you.'}
        </p>
        <a
          href={portal}
          data-testid="crm-go-to-portal"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Go to the Portal
        </a>
      </div>
    );
  }
  const firstName = session.user.name.trim().split(/\s+/)[0] ?? '';
  return <OnboardingFlow firstName={firstName} retry={params.retry === '1'} previews={starterPreviews()} />;
}
