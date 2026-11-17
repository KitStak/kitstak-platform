/**
 * DTOs shared by the server domain layer, /api/v1 and the client. Timestamps are ISO strings,
 * dates are YYYY-MM-DD strings, money is integer cents (null when hidden from the reader).
 */
import type { OrgRole, PulseRole } from './permissions';

export interface PersonRef {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
}

/** An org member (people pickers, owners, assignees). */
export interface OrgPerson extends PersonRef {
  readonly orgRole: OrgRole;
  readonly title: string | null;
}

export interface OrgRef {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logo: string | null;
  readonly role: OrgRole;
}

export interface ModuleFlagsDTO {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
  readonly pulse: boolean;
}

/** Which sibling apps Pulse can read for this org (licensed and their tables exist). */
export interface IntegrationAvailabilityDTO {
  readonly crm: boolean;
  readonly wms: boolean;
  readonly projects: boolean;
}

/** `GET /api/v1/me`. */
export interface MeResponse {
  readonly user: PersonRef;
  readonly org: OrgRef;
  readonly orgRole: OrgRole;
  readonly orgs: readonly OrgRef[];
  readonly pulseRole: PulseRole;
  readonly seesMoney: boolean;
  readonly seesWages: boolean;
  readonly modules: ModuleFlagsDTO;
  readonly integrations: IntegrationAvailabilityDTO;
}
