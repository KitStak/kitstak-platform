import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { LinkIcon } from 'lucide-react';
import { getPublicForm } from '@/server/domain';
import { getContext } from '@/server/session';
import { ProjectsMark } from '@/features/shell/logo';
import { PublicForm } from './public-form';

/** One lookup per request, shared by the page and its metadata. */
const loadForm = cache(async (token: string) => {
  const context = await getContext();
  return getPublicForm(token, context?.orgs.map((org) => org.id) ?? []);
});

/** The browser tab names the form ("Request warehouse work · KitStak"), not a generic label. */
export async function publicFormMetadata(token: string): Promise<Metadata> {
  const form = await loadForm(token);
  return {
    title: { absolute: form ? `${form.name} · ${form.orgName}` : 'Form not available · KitStak' },
    robots: { index: false, follow: false },
  };
}

export async function PublicFormPage({ token }: { readonly token: string }) {
  const form = await loadForm(token);
  // A real 404 status; app/forms/[id]/not-found.tsx renders <FormUnavailable /> for it.
  if (!form) notFound();
  return <PublicForm form={form} />;
}

/**
 * Unknown, closed or private form links. The visitor is usually outside the workspace, so this
 * explains what happened and offers no internal links (they would only lead to a sign-in wall).
 */
export function FormUnavailable() {
  return (
    <div className="min-h-dvh bg-app px-4 py-16" data-testid="form-unavailable">
      <div className="mx-auto flex w-full max-w-[480px] flex-col items-center rounded-xl border border-border-subtle bg-panel px-6 py-10 text-center shadow-xs">
        <span className="flex size-11 items-center justify-center rounded-full bg-sunken text-icon">
          <LinkIcon aria-hidden className="size-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-fg">This form is not available</h1>
        <p className="mt-2 text-sm text-fg-secondary">The form may be closed, or the link may have changed. Please ask the person who sent it to you for a new link.</p>
        <p className="mt-8 inline-flex items-center gap-1.5 text-xs text-fg-muted">
          <ProjectsMark size={14} /> Forms by KitStak Projects
        </p>
      </div>
    </div>
  );
}
