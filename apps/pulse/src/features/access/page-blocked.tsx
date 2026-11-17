import { ClipboardPen, ShieldQuestion } from 'lucide-react';
import { Page, Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { PULSE_ROLE_LABELS, canPulse, type PulseRole } from '@/lib/permissions';
import { routes } from '@/lib/routes';

/** Shown when a person opens a page their Pulse role does not include (for example a supervisor on Profit). */
export function PageBlocked({ title, role }: { readonly title: string; readonly role: PulseRole }) {
  const canLog = canPulse(role, 'production:log');
  return (
    <Page title={title} width="narrow">
      <Panel>
        <Teach
          testId="page-blocked"
          icon={ShieldQuestion}
          title="This page is not part of your role"
          why={`Your Pulse role is ${PULSE_ROLE_LABELS[role]}. This page shows money, so only people who were given that right can open it. Ask an admin of your workspace if you need it.`}
          actions={
            canLog ? (
              <ButtonLink href={routes.log()} icon={<ClipboardPen aria-hidden />}>
                Go to Log work
              </ButtonLink>
            ) : (
              <ButtonLink href={routes.jobs()}>Go to Jobs</ButtonLink>
            )
          }
        />
      </Panel>
    </Page>
  );
}
