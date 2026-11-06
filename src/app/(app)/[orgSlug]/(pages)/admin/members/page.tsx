import { redirect } from 'next/navigation';

/** Legacy URL: the members directory now lives under Admin → Users. */
export default async function Page({ params }: { readonly params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  redirect(`/${orgSlug}/admin/users`);
}
