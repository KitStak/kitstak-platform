import { redirect } from 'next/navigation';

/** `/settings` has a single destination today: the signed-in user's profile. */
export default async function Page({ params }: { readonly params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/settings/profile`);
}
