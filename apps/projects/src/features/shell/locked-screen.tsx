import { Lock } from 'lucide-react';
import { ProjectsMark } from './logo';

/** Shown inside the app frame when the org is not entitled to KitStak Projects. */
export function LockedScreen({ orgName, portalUrl, canManage }: { readonly orgName: string; readonly portalUrl: string; readonly canManage: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-panel p-8 text-center shadow-sm" data-testid="locked-screen">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sunken">
          <ProjectsMark size={34} />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-fg">KitStak Projects isn’t turned on for {orgName}</h1>
        <p className="mt-2 text-base text-fg-secondary">
          {canManage
            ? 'Turn it on from the Portal to plan projects, assign tasks and track deadlines with your team.'
            : 'Ask an owner or admin of your organization to turn it on in the Portal.'}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <a
            href={`${portalUrl}/billing?module=projects`}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-fg hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Lock aria-hidden className="size-4" />
            {canManage ? 'Turn on Projects' : 'View plans'}
          </a>
          <a
            href={portalUrl}
            className="inline-flex h-10 items-center rounded-md border border-border-input bg-panel px-4 text-base font-medium text-fg hover:bg-muted"
          >
            Back to Portal
          </a>
        </div>
      </div>
    </div>
  );
}
