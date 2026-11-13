import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { Logo } from '@/features/shell/logo';
import { appUrls } from '@/server/env';
import { getContext, getSession } from '@/server/session';

export const metadata: Metadata = { title: 'Join an organization' };

/** Signed in but not a member of any organization yet. */
export default async function NoWorkspacePage() {
  if (!(await getSession())) redirect('/login');
  if (await getContext()) redirect('/');
  const portal = appUrls().portal;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-app px-4">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <Logo size={26} />
        </div>
        <div className="mx-auto mt-6 flex size-12 items-center justify-center rounded-xl bg-sunken">
          <Building2 aria-hidden className="size-6 text-icon" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-fg">You’re not in an organization yet</h1>
        <p className="mt-2 text-base text-fg-secondary">
          Projects live inside an organization. Create one in the Portal, or ask a teammate to invite you.
        </p>
        <a
          href={portal}
          className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Go to the Portal
        </a>
      </div>
    </div>
  );
}
