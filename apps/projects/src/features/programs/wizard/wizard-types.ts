/**
 * Shapes shared by the New program wizard's server page and its client steps
 * (docs/programs/SPEC.md 5.4).
 */
import type { IsoDate, OrgCalendarDTO, ProgramTemplateDTO, ProgramWizardPayload, WizardDraftDTO } from '@/lib/program-types';
import type { StartMode, WizardState } from './wizard-model';

export interface WizardData {
  readonly today: IsoDate;
  readonly calendar: OrgCalendarDTO;
  readonly drafts: readonly WizardDraftDTO[];
  readonly draft: WizardDraftDTO | null;
  readonly templates: readonly ProgramTemplateDTO[];
  readonly programs: readonly { readonly key: string; readonly name: string; readonly color: string | null; readonly icon: string | null; readonly customer: string | null; readonly variantsCount: number; readonly scheduleText: string | null }[];
  readonly taken: readonly { readonly key: string; readonly name: string; readonly kind: 'project' | 'program' }[];
  readonly customers: readonly { readonly kind: 'core' | 'crm_account'; readonly id: string; readonly name: string }[];
  readonly wonDeals: readonly { readonly id: string; readonly name: string; readonly accountName: string | null; readonly valueCents: string | null; readonly currency: string | null; readonly closeDate: IsoDate | null; readonly programKey: string | null }[];
  readonly kitItems: readonly { readonly id: string; readonly customerId: string; readonly sku: string; readonly name: string }[];
  /** Null when Pulse is not on or cannot be read. */
  readonly pulseJobs: readonly { readonly id: string; readonly number: string; readonly name: string; readonly clientName: string | null; readonly unitLabel: string; readonly ongoing: boolean; readonly perUnit: boolean; readonly refusal: string | null }[] | null;
  readonly prefill: ProgramWizardPayload | null;
  readonly prefillExtra: { readonly customerName: string | null; readonly crmItemTitle: string | null; readonly templateName: string | null };
  readonly deal: { readonly name: string; readonly accountName: string | null; readonly valueCents: string | null; readonly currency: string | null; readonly closeDate: IsoDate | null; readonly termMonths: number | null } | null;
  readonly url: { readonly mode: StartMode | null; readonly crmItem: string | null; readonly template: string | null; readonly copy: string | null; readonly customer: string | null; readonly name: string | null; readonly draft: string | null; readonly include: string | null };
  readonly suggestedKey: string | null;
  readonly crmOn: boolean;
  readonly pulseOn: boolean;
}

export type SetState = (update: (state: WizardState) => WizardState) => void;

export interface StepProps {
  readonly state: WizardState;
  readonly set: SetState;
  readonly data: WizardData;
  /** Problems on this step, shown after Continue was pressed. */
  readonly problems: Readonly<Record<string, string>>;
  readonly showErrors: boolean;
}
