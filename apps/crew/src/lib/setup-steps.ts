/**
 * The five Crew onboarding steps (docs/crew/SPEC.md section 9). Same keys, titles and order as the
 * cross app contract (docs/integration/ONBOARDING.md), so the welcome checklist and the Portal
 * guide read alike. Pure module.
 */
import type { CrewSetupSignals, CrewSetupStep } from '@kitstak/crew-bridge';
import { routes } from './routes';

export interface SetupStep {
  readonly key: CrewSetupStep;
  readonly title: string;
  readonly requires: CrewSetupStep | null;
  /** A Crew path, or `pulse:` + a Pulse path. */
  readonly href: string;
  readonly detail: string;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  { key: 'crew_people', title: 'Add your people', requires: null, href: routes.newPerson(), detail: 'Type them in, or bring in a file from your agency or payroll.' },
  { key: 'crew_schedule', title: 'Publish your first week', requires: 'crew_people', href: routes.schedule(), detail: 'Build the week from shift templates and publish it.' },
  { key: 'crew_kiosk', title: 'Set up the time clock', requires: 'crew_people', href: routes.settingsKiosks(), detail: 'Open a device link on a tablet at the door, or turn on the phone clock.' },
  { key: 'crew_approve', title: 'Approve a week of hours', requires: 'crew_kiosk', href: routes.time(), detail: 'Fix what needs a fix, then approve the week for payroll.' },
  { key: 'crew_connect', title: 'Send hours to Pulse', requires: 'crew_approve', href: 'pulse:/settings/apps', detail: 'Approved hours become paid hours in Pulse with no file.' },
];

export interface SetupStepState extends SetupStep {
  readonly done: boolean;
  /** The step it needs is not done yet. */
  readonly waiting: boolean;
}

/** The checklist for an org. `crew_connect` is left out when Pulse is not in the database (`null` signal). */
export function setupChecklist(signals: CrewSetupSignals | null): readonly SetupStepState[] {
  const done = (key: CrewSetupStep): boolean => signals?.[key] === true;
  return SETUP_STEPS.filter((step) => step.key !== 'crew_connect' || (signals !== null && signals.crew_connect !== null)).map((step) => ({
    ...step,
    done: done(step.key),
    waiting: step.requires !== null && !done(step.requires),
  }));
}
