import { notFound } from 'next/navigation';
import { getPublicForm } from '@/server/domain';
import { getContext } from '@/server/session';
import { PublicForm } from './public-form';

export async function PublicFormPage({ token }: { readonly token: string }) {
  const context = await getContext();
  const form = await getPublicForm(token, context?.orgs.map((org) => org.id) ?? []);
  if (!form) notFound();
  return <PublicForm form={form} />;
}
