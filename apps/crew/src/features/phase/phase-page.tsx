import 'server-only';
import { Hammer, Rocket, ShieldQuestion } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/crew/button-link';
import { Teach } from '@/components/crew/teach';
import { Badge } from '@/components/ui';
import { arrivesIn, crewPage } from '@/lib/pages';
import { CREW_ROLE_LABELS } from '@/lib/permissions';
import { landingPath } from '@/lib/nav';
import { routes } from '@/lib/routes';
import { pageFor } from '@/server/page';
import { PAGE_ICONS } from './page-icons';

/**
 * Every Crew route that is not built yet renders through this: the teaching empty state of
 * src/lib/pages.ts (what this is, why it matters, what will show up here) and "Arrives in phase N"
 * (docs/crew/SPEC.md 6.1 and 12). The role check runs on the server; a page the role does not
 * include says so instead of teaching it.
 */
export async function PhasePage({ id, path, subtitle }: { readonly id: string; readonly path: string; readonly subtitle?: string }) {
  const page = crewPage(id);
  const { access, can, locked } = await pageFor(path);
  if (locked) return null;
  const Icon = PAGE_ICONS[page.icon];
  if (!can(page.needs)) {
    const why =
      page.needs === 'self'
        ? 'This page is for people whose login is linked to a person in Crew. Ask your supervisor to link yours.'
        : `Your Crew role is ${CREW_ROLE_LABELS[access.role]}. This page is not part of it. Ask an admin of your workspace if you need it.`;
    return (
      <Page title={page.title} width="narrow">
        <Panel>
          <Teach testId="page-blocked" icon={ShieldQuestion} title="This page is not part of your role" why={why} actions={<ButtonLink href={landingPath(access.role)}>Go to Crew home</ButtonLink>} />
        </Panel>
      </Page>
    );
  }
  return (
    <Page
      title={page.title}
      icon={<Icon aria-hidden className="size-6 text-icon" />}
      subtitle={subtitle ?? page.why}
      actions={
        <span data-testid="phase-badge">
          <Badge tone="info" icon={<Hammer aria-hidden className="size-3.5" />}>
            {arrivesIn(page.phase)}
          </Badge>
        </span>
      }
    >
      <Panel>
        <Teach
          testId={`teach-${page.id}`}
          icon={Icon}
          title={`${page.title} is on its way`}
          why={page.why}
          points={page.points}
          actions={
            <>
              {can('settings:manage') ? (
                <ButtonLink href={routes.welcome()} icon={<Rocket aria-hidden />}>
                  Getting started
                </ButtonLink>
              ) : null}
              {path !== '/' ? (
                <ButtonLink href={landingPath(access.role)} variant="secondary">
                  Back to Crew home
                </ButtonLink>
              ) : null}
            </>
          }
          footnote={`${arrivesIn(page.phase)}. Crew is in preview, so pages turn on one phase at a time.`}
        />
      </Panel>
    </Page>
  );
}
