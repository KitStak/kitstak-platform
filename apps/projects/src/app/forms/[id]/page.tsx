import type { Metadata } from 'next';
import { PublicFormPage, publicFormMetadata } from '@/features/forms';

export async function generateMetadata({ params }: { readonly params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return publicFormMetadata(decodeURIComponent(id));
}

/** Public intake form: no sign-in needed for public forms. `[id]` is the form's share token. */
export default async function Page({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicFormPage token={decodeURIComponent(id)} />;
}
