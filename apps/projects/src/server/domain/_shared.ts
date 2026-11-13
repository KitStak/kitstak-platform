/**
 * Shared plumbing for domain modules: the actor passed to every mutation, row → DTO mappers,
 * and small SQL helpers. Domain functions are plain async functions; they never read request
 * state themselves (callers pass a `DomainContext`), so seeds, tests and route handlers reuse them.
 */
import 'server-only';
import type { ProjectsContext } from '@/server/session';
import type { ActorKind } from '@/lib/constants';
import type { OrgRole } from '@/lib/permissions';
import type {
  AttachmentDTO,
  CustomFieldDTO,
  IntegrationLinkDTO,
  LabelDTO,
  SectionDTO,
  StatusDTO,
  TimeEntryDTO,
} from '@/lib/types';
import type {
  Attachment,
  CustomField,
  IntegrationLink,
  Label,
  Section,
  Status,
  TimeEntry,
} from '@/server/db/schema';

/** Who is acting, in which org. Built from the request (`toDomainContext`) or by scripts. */
export interface DomainContext {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly userId: string;
  readonly userName: string;
  readonly orgRole: OrgRole;
  /** `automation` / `integration` / `system` actors skip notifications to themselves and automations re-entry rules. */
  readonly actorKind: ActorKind;
  /** Automation recursion depth (executor sets it; user requests start at 0). */
  readonly automationDepth?: number;
}

export function toDomainContext(ctx: ProjectsContext): DomainContext {
  return {
    orgId: ctx.org.id,
    orgSlug: ctx.org.slug,
    userId: ctx.user.id,
    userName: ctx.user.name,
    orgRole: ctx.orgRole,
    actorKind: 'user',
  };
}

export const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);
export const isoRequired = (value: Date): string => value.toISOString();

export function toStatusDTO(row: Status): StatusDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    category: row.category,
    color: row.color,
    position: row.position,
    wipLimit: row.wipLimit,
    isDefault: row.isDefault,
  };
}

export function toSectionDTO(row: Section): SectionDTO {
  return { id: row.id, projectId: row.projectId, name: row.name, position: row.position };
}

export function toLabelDTO(row: Label): LabelDTO {
  return { id: row.id, projectId: row.projectId, name: row.name, color: row.color };
}

export function toCustomFieldDTO(row: CustomField): CustomFieldDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: row.type,
    config: row.config,
    description: row.description,
    required: row.required,
    position: row.position,
  };
}

export function attachmentUrl(id: string): string {
  return `/api/v1/attachments/${id}`;
}

export function toAttachmentDTO(row: Omit<Attachment, 'data'>): AttachmentDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    commentId: row.commentId,
    name: row.name,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    url: attachmentUrl(row.id),
    uploadedBy: row.uploadedBy,
    createdAt: isoRequired(row.createdAt),
  };
}

export function toTimeEntryDTO(row: TimeEntry): TimeEntryDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    userId: row.userId,
    startedAt: isoRequired(row.startedAt),
    endedAt: iso(row.endedAt),
    durationMinutes: row.durationMinutes,
    note: row.note,
    billable: row.billable,
    source: row.source,
  };
}

export function toIntegrationLinkDTO(row: IntegrationLink): IntegrationLinkDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    targetType: row.targetType,
    targetId: row.targetId,
    title: row.cachedTitle,
    status: row.cachedStatus,
    url: row.cachedUrl,
    cachedAt: iso(row.cachedAt),
    meta: row.meta,
  };
}

/** Trim + collapse whitespace; empty → null. */
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
