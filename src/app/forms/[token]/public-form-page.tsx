'use client';
import { FileQuestion } from 'lucide-react';
import { PublicForm } from '@/features/board-views/form/public-form';
import type { PublicFormDto } from '@/server/services/board-views-form-model';

export function PublicFormPage({ form, token }: { readonly form: PublicFormDto | null; readonly token: string }) {
  return (
    <main className="flex min-h-dvh justify-center bg-sunken px-4 py-10 max-[480px]:py-4">
      <div className="w-full max-w-[680px]">
        {form ? (
          <PublicForm form={form} token={token} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-panel px-8 py-14 text-center shadow-sm" data-testid="form-missing">
            <FileQuestion aria-hidden className="size-10 text-icon" strokeWidth={1.5} />
            <h1 className="font-heading text-xl font-semibold text-fg">This form isn&apos;t available</h1>
            <p className="max-w-sm text-fg-secondary">The link may be mistyped, or the form was unpublished. Ask the person who shared it for a new link.</p>
          </div>
        )}
      </div>
    </main>
  );
}
