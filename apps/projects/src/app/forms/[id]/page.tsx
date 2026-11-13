import type { Metadata } from 'next';
import { PublicFormPage } from '@/features/forms';

export const metadata: Metadata = { title: 'Request form', robots: { index: false, follow: false } };

/** Public intake form: no sign-in needed for public forms. `[id]` is the form's share token. */
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicFormPage token={decodeURIComponent(id)} />;
}
