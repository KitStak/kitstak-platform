/** Shown (server-rendered) when a non-admin opens an admin URL. The attempt is audited. */
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

export function AdminForbidden({ orgSlug, roleLabel }: { readonly orgSlug: string; readonly roleLabel: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-app px-4 py-16" data-testid="admin-forbidden">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-border-subtle bg-panel px-8 py-10 text-center shadow-sm">
        <span className="flex size-12 items-center justify-center rounded-full bg-warning-subtle text-warning-text">
          <ShieldAlert aria-hidden className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold text-fg">Admins only</h1>
          <p className="text-base text-fg-secondary">
            The admin center is available to organization owners and admins. You’re signed in as a{' '}
            <strong className="font-semibold text-fg">{roleLabel}</strong>. Ask an admin if you need access.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link
            href={`/${orgSlug}`}
            className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-base font-medium text-primary-fg shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-primary-active"
          >
            Go home
          </Link>
          <Link
            href={`/${orgSlug}/settings/profile`}
            className="inline-flex h-8 items-center rounded-sm border border-border-input bg-panel px-3 text-base font-medium text-fg transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed"
          >
            My profile
          </Link>
        </div>
      </div>
    </div>
  );
}
