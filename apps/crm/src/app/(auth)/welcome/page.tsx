import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { asc, eq } from 'drizzle-orm';
import { requirePageSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { member, organization } from '@/server/db/schema';
import { buildTemplateGallery } from '@/server/services/wizards-gallery';
import { OnboardingFlow, type StarterPreviews } from '@/features/wizards/onboarding/onboarding-flow';
import { STARTER_PREVIEW_IDS } from '@/features/wizards/model/onboarding';

export const metadata: Metadata = { title: 'Set up your workspace' };

/** Mini-board previews for every board a starter CRM can install (the user has no org yet). */
function starterPreviews(): StarterPreviews {
  const previews: Record<string, StarterPreviews[string]> = {};
  for (const entry of buildTemplateGallery()) {
    const board = entry.boards[0];
    if (entry.type === 'board' && board && STARTER_PREVIEW_IDS.includes(entry.id)) previews[entry.id] = { board, accent: entry.accent };
  }
  return previews;
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
  const firstName = session.user.name.trim().split(/\s+/)[0] ?? '';
  return <OnboardingFlow firstName={firstName} retry={params.retry === '1'} previews={starterPreviews()} />;
}
