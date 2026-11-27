/**
 * Deep links into Pulse. Pure string builders, safe in client components
 * (`@kitstak/pulse-bridge/urls`). The host passes the Pulse origin (NEXT_PUBLIC_PULSE_URL).
 * Pulse resolves `by-link` URLs itself: it opens the job tied to the record when one exists
 * and a prefilled new job when none does, so a link never goes stale.
 */
import type { PulseRecordType } from './types';

function withQuery(path: string, params: Readonly<Record<string, string | number | null | undefined>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export interface NewJobFromDeal {
  readonly dealId: string;
  /** Deal name, used as the job name. */
  readonly name?: string | null;
  /** Deal value in whole currency units, as CRM stores it. */
  readonly value?: number | string | null;
  readonly accountItemId?: string | null;
  readonly coreCustomerId?: string | null;
}

export interface NewJobFromProgram {
  readonly programId: string;
  /** Program name, used as the job name. */
  readonly name?: string | null;
  /** The program's customer: a core customer id or a CRM account item id. Pulse matches it to a client. */
  readonly clientHint?: string | null;
  /** The program's unit label (plural), like "kits". */
  readonly unitLabel?: string | null;
}

export interface PulseUrls {
  home(): string;
  /** `ref` is a job number (J-1042) or id. */
  job(ref: string): string;
  jobs(): string;
  jobsAtRisk(): string;
  newJob(): string;
  newJobFromDeal(deal: NewJobFromDeal): string;
  newJobFromWorkOrder(workOrderId: string): string;
  newJobFromProject(projectId: string, name?: string | null): string;
  /** A new ongoing per unit job that links the program on save (docs/programs/SPEC.md 6.1). */
  newJobFromProgram(program: NewJobFromProgram): string;
  /** Opens the job for a sibling record, or a prefilled new job when there is none. */
  byLink(type: PulseRecordType, id: string): string;
  /** The daily log, on a job when one is given. */
  log(jobRef?: string | null, date?: string | null): string;
  /** A client by any of its three ids. */
  client(ref: { readonly pulseClientId?: string | null; readonly coreCustomerId?: string | null; readonly crmAccountItemId?: string | null }): string;
  connectedApps(): string;
  /** Any Pulse path (as returned in a DTO's `path`). */
  path(path: string): string;
}

export function pulseUrls(base: string): PulseUrls {
  const origin = base.replace(/\/+$/, '');
  const abs = (path: string): string => `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  return {
    home: () => abs('/'),
    job: (ref) => abs(`/jobs/${encodeURIComponent(ref)}`),
    jobs: () => abs('/jobs'),
    jobsAtRisk: () => abs('/jobs?tab=open&risk=losing,at_risk'),
    newJob: () => abs('/jobs/new'),
    newJobFromDeal: (deal) =>
      abs(
        withQuery('/jobs/new', {
          crmDeal: deal.dealId,
          name: deal.name,
          value: deal.value,
          crmAccountItemId: deal.accountItemId,
          coreCustomerId: deal.coreCustomerId,
        }),
      ),
    newJobFromWorkOrder: (workOrderId) => abs(withQuery('/jobs/new', { wmsWorkOrder: workOrderId })),
    newJobFromProject: (projectId, name) => abs(withQuery('/jobs/new', { project: projectId, name })),
    newJobFromProgram: (program) =>
      abs(withQuery('/jobs/new', { program: program.programId, name: program.name, clientHint: program.clientHint, unitLabel: program.unitLabel })),
    byLink: (type, id) => abs(withQuery('/jobs/by-link', { type, id })),
    log: (jobRef, date) => abs(withQuery('/log', { job: jobRef, date })),
    client: (ref) =>
      ref.pulseClientId
        ? abs(`/clients/${encodeURIComponent(ref.pulseClientId)}`)
        : abs(withQuery('/clients/by-link', { coreCustomerId: ref.coreCustomerId, crmAccountItemId: ref.crmAccountItemId })),
    connectedApps: () => abs('/settings/apps'),
    path: (path) => abs(path),
  };
}
