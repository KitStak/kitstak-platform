import 'server-only';
import { ShieldQuestion } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/crew/button-link';
import { Teach } from '@/components/crew/teach';
import { landingPath } from '@/lib/nav';
import { CREW_ROLE_LABELS, type CrewRole } from '@/lib/permissions';

/** A page the role does not include says so (the same words as PhasePage). */
export function BlockedPage({ title, role }: { readonly title: string; readonly role: CrewRole }) {
  return (
    <Page title={title} width="narrow">
      <Panel>
        <Teach
          testId="page-blocked"
          icon={ShieldQuestion}
          title="This page is not part of your role"
          why={`Your Crew role is ${CREW_ROLE_LABELS[role]}. This page is not part of it. Ask an admin of your workspace if you need it.`}
          actions={<ButtonLink href={landingPath(role)}>Go to Crew home</ButtonLink>}
        />
      </Panel>
    </Page>
  );
}
