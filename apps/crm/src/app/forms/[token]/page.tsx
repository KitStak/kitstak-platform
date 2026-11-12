import type { Metadata } from 'next';
import { NotFoundError } from '@/server/http/errors';
import { getPublicForm } from '@/server/services/board-views-forms';
import type { PublicFormDto } from '@/server/services/board-views-form-model';
import { PublicFormPage } from './public-form-page';

interface FormPageProps {
  readonly params: Promise<{ token: string }>;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/;

async function load(token: string): Promise<PublicFormDto | null> {
  if (!TOKEN_RE.test(token)) return null;
  try {
    return await getPublicForm(token);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function generateMetadata({ params }: FormPageProps): Promise<Metadata> {
  const form = await load((await params).token);
  return { title: form?.title ?? 'Form not found', robots: { index: false, follow: false } };
}

/** Public, sessionless form page (proxy allow-lists /forms/*). */
export default async function FormPage({ params }: FormPageProps) {
  const { token } = await params;
  const form = await load(token);
  return <PublicFormPage form={form} token={token} />;
}
