/**
 * CRM module contracts: Zod input schemas + DTO types shared by the CRM services, the
 * `/api/v1/crm/**` routes and the client (`src/features/crm`). Client-safe: zod + types only.
 */
import { z } from 'zod';
import type { LabelColor } from '@/server/db/schema/cell-values';

// ---------------------------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------------------------

export type CrmObjectKind = 'leads' | 'contacts' | 'accounts' | 'deals' | 'activities';
export const CRM_OBJECT_KINDS: readonly CrmObjectKind[] = ['deals', 'leads', 'contacts', 'accounts', 'activities'];

export interface CrmBoardRefDto {
  readonly id: string;
  readonly name: string;
  readonly kind: CrmObjectKind;
  readonly itemTerminology: string;
  readonly itemCount: number;
}

/** The CRM boards the caller can see, one primary per object kind. */
export interface CrmBoardsDto {
  readonly primary: Partial<Record<CrmObjectKind, CrmBoardRefDto>>;
  /** Every visible deals board (pipeline switcher). */
  readonly dealBoards: readonly CrmBoardRefDto[];
}

export interface CrmLabelDto {
  readonly id: string;
  readonly name: string;
  readonly color: LabelColor;
}

export interface CrmUserDto {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

// ---------------------------------------------------------------------------------------------
// Pipeline cockpit
// ---------------------------------------------------------------------------------------------

export const PIPELINE_PERIODS = ['this_month', 'this_quarter', 'next_quarter', 'this_year', 'all'] as const;
export type PipelinePeriod = (typeof PIPELINE_PERIODS)[number];

export const pipelineQuerySchema = z.object({
  boardId: z.uuid().optional(),
  owner: z.uuid().optional(),
  period: z.enum(PIPELINE_PERIODS).default('this_quarter'),
});
export type PipelineQuery = z.infer<typeof pipelineQuerySchema>;

/** Per-board CRM settings, stored in `boards.settings.crm` (jsonb, no schema change). */
export interface CrmBoardSettings {
  /** Stage label id → win probability 0..100. */
  readonly stageProbabilities?: Readonly<Record<string, number>>;
  /** User id → quota per quarter (board currency). */
  readonly quotas?: Readonly<Record<string, number>>;
  /** A deal with no activity for this many days is "at risk". */
  readonly staleDays?: number;
  /** Dismissed duplicate pairs ("idA:idB", ids sorted). */
  readonly dismissedDuplicates?: readonly string[];
}

export const pipelineSettingsSchema = z.object({
  boardId: z.uuid(),
  stageProbabilities: z.record(z.string().min(1).max(64), z.number().int().min(0).max(100)).optional(),
  quotas: z.record(z.uuid(), z.number().min(0).max(1_000_000_000_000)).optional(),
  staleDays: z.number().int().min(1).max(365).optional(),
});
export type PipelineSettingsInput = z.infer<typeof pipelineSettingsSchema>;

export type StageKind = 'open' | 'won' | 'lost';

export interface FunnelStageDto {
  readonly label: CrmLabelDto;
  readonly kind: StageKind;
  readonly probability: number;
  readonly count: number;
  readonly value: number;
  readonly weighted: number;
  /** Share of deals that reached the previous stage and also reached this one (0..1), null for the first. */
  readonly conversion: number | null;
}

export interface ForecastMonthDto {
  /** `YYYY-MM`, or `overdue` for open deals whose close date has passed. */
  readonly month: string;
  readonly won: number;
  readonly weighted: number;
  readonly bestCase: number;
  readonly count: number;
}

export interface RepRowDto {
  readonly user: CrmUserDto;
  readonly openCount: number;
  readonly openValue: number;
  readonly weighted: number;
  readonly won: number;
  readonly quota: number | null;
  /** won / quota (0..n), null without a quota. */
  readonly attainment: number | null;
}

export type RiskReason = 'stale' | 'overdue';

export interface RiskDealDto {
  readonly id: string;
  readonly name: string;
  readonly stage: CrmLabelDto | null;
  readonly value: number;
  readonly closeDate: string | null;
  readonly owner: CrmUserDto | null;
  readonly lastActivityAt: string | null;
  readonly daysSinceActivity: number | null;
  readonly reasons: readonly RiskReason[];
}

export interface StageVelocityDto {
  readonly label: CrmLabelDto;
  /** Average days spent in the stage before moving on (completed transitions). */
  readonly avgDays: number | null;
  readonly transitions: number;
  /** Average age of the deals currently sitting in the stage. */
  readonly currentAvgDays: number | null;
  readonly currentCount: number;
}

export interface PipelineSummaryDto {
  readonly openCount: number;
  readonly openValue: number;
  readonly weighted: number;
  readonly wonValue: number;
  readonly wonCount: number;
  readonly lostCount: number;
  /** won / (won + lost) in the period, null when nothing closed. */
  readonly winRate: number | null;
  readonly avgDealSize: number | null;
}

export interface PipelineDto {
  readonly board: CrmBoardRefDto;
  readonly dealBoards: readonly CrmBoardRefDto[];
  readonly currency: string;
  readonly period: PipelinePeriod;
  readonly periodRange: { readonly from: string; readonly to: string } | null;
  readonly owner: string | null;
  readonly owners: readonly CrmUserDto[];
  readonly settings: {
    readonly stageProbabilities: Readonly<Record<string, number>>;
    readonly quotas: Readonly<Record<string, number>>;
    readonly staleDays: number;
    /** Probabilities come from the saved settings (true) or were derived from the data. */
    readonly customized: boolean;
  };
  readonly canEdit: boolean;
  readonly summary: PipelineSummaryDto;
  readonly funnel: readonly FunnelStageDto[];
  readonly forecast: readonly ForecastMonthDto[];
  readonly reps: readonly RepRowDto[];
  readonly atRisk: readonly RiskDealDto[];
  readonly velocity: readonly StageVelocityDto[];
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Contact / Account 360
// ---------------------------------------------------------------------------------------------

export interface RecordRefDto {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
}

export interface DealRowDto extends RecordRefDto {
  readonly stage: CrmLabelDto | null;
  readonly stageKind: StageKind;
  readonly value: number;
  readonly closeDate: string | null;
  readonly owner: CrmUserDto | null;
}

export interface ContactRowDto extends RecordRefDto {
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly lastContacted: string | null;
}

export type TimelineKind = 'call' | 'email' | 'meeting' | 'demo' | 'task' | 'note' | 'update' | 'other';

export interface TimelineEntryDto {
  readonly id: string;
  /** `activity` = Activities board item, `update` = comment on the record or a related deal. */
  readonly source: 'activity' | 'update';
  readonly kind: TimelineKind;
  readonly title: string;
  readonly body: string | null;
  readonly at: string;
  readonly author: CrmUserDto | null;
  readonly status: CrmLabelDto | null;
  readonly typeLabel: CrmLabelDto | null;
  readonly upcoming: boolean;
  /** Item to open (activity item, or the item the update belongs to). */
  readonly itemId: string;
  readonly boardId: string;
  readonly relatedTo: readonly RecordRefDto[];
}

export interface NextStepDto {
  readonly id: string;
  readonly kind: 'activity' | 'deal';
  readonly title: string;
  readonly due: string | null;
  readonly overdue: boolean;
  readonly itemId: string;
  readonly boardId: string;
}

export interface DealTotalsDto {
  readonly count: number;
  readonly openCount: number;
  readonly openValue: number;
  readonly wonValue: number;
  readonly weighted: number;
}

export interface ProfileFieldDto {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly href?: string;
  readonly pill?: CrmLabelDto;
}

interface RecordBaseDto {
  readonly id: string;
  readonly name: string;
  readonly board: CrmBoardRefDto;
  readonly canEdit: boolean;
  readonly owners: readonly CrmUserDto[];
  readonly tags: readonly CrmLabelDto[];
  readonly fields: readonly ProfileFieldDto[];
  readonly deals: readonly DealRowDto[];
  readonly dealTotals: DealTotalsDto;
  readonly currency: string;
  readonly timeline: readonly TimelineEntryDto[];
  readonly nextSteps: readonly NextStepDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Activities board available for "Log activity" (null hides the composer). */
  readonly activityBoard: CrmBoardRefDto | null;
  readonly activityTypes: readonly CrmLabelDto[];
}

export interface Contact360Dto extends RecordBaseDto {
  readonly kind: 'contacts';
  readonly email: string | null;
  readonly phone: string | null;
  readonly title: string | null;
  readonly lastContacted: string | null;
  readonly account: (RecordRefDto & { readonly website: string | null }) | null;
  readonly relatedContacts: readonly ContactRowDto[];
}

export interface Account360Dto extends RecordBaseDto {
  readonly kind: 'accounts';
  readonly website: string | null;
  readonly domain: string | null;
  readonly contacts: readonly ContactRowDto[];
}

export type Record360Dto = Contact360Dto | Account360Dto;

// ---------------------------------------------------------------------------------------------
// Records index (/crm/contacts and /crm/accounts)
// ---------------------------------------------------------------------------------------------

/** One row of the flat records list. Contact-only and account-only fields are null elsewhere. */
export interface CrmRecordRowDto {
  readonly id: string;
  readonly name: string;
  readonly owner: CrmUserDto | null;
  /** Lifecycle / type (contacts) or industry (accounts) pill. */
  readonly label: CrmLabelDto | null;
  readonly email: string | null;
  readonly title: string | null;
  /** Linked account name (contacts). */
  readonly account: string | null;
  /** Website domain (accounts). */
  readonly domain: string | null;
  readonly lastContacted: string | null;
  readonly updatedAt: string;
}

export interface CrmRecordsDto {
  readonly kind: 'contacts' | 'accounts';
  readonly board: CrmBoardRefDto | null;
  readonly rows: readonly CrmRecordRowDto[];
}

// ---------------------------------------------------------------------------------------------
// Log activity
// ---------------------------------------------------------------------------------------------

export const ACTIVITY_OUTCOMES = ['completed', 'connected', 'left_voicemail', 'no_answer', 'scheduled', 'cancelled'] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const logActivitySchema = z.object({
  typeLabelId: z.string().min(1).max(64),
  subject: z.string().trim().max(200).optional(),
  outcome: z.enum(ACTIVITY_OUTCOMES).default('completed'),
  date: isoDate,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).optional(),
  notes: z.string().max(10_000).optional(),
  contactIds: z.array(z.uuid()).max(20).default([]),
  dealIds: z.array(z.uuid()).max(20).default([]),
  /** The record the composer was opened from (used for the default subject and last-contacted). */
  fromItemId: z.uuid().optional(),
});
export type LogActivityInput = z.infer<typeof logActivitySchema>;

export interface LoggedActivityDto {
  readonly id: string;
  readonly boardId: string;
  readonly name: string;
  readonly upcoming: boolean;
  readonly updatedContactIds: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Lead conversion
// ---------------------------------------------------------------------------------------------

export interface MatchCandidateDto extends RecordRefDto {
  readonly reason: 'email' | 'domain' | 'name';
  readonly confidence: 'high' | 'medium';
  readonly detail: string | null;
}

export interface ConversionPreviewDto {
  readonly lead: {
    readonly id: string;
    readonly name: string;
    readonly boardId: string;
    readonly email: string | null;
    readonly phone: string | null;
    readonly company: string | null;
    readonly title: string | null;
    readonly domain: string | null;
    readonly owner: CrmUserDto | null;
    readonly source: CrmLabelDto | null;
  };
  readonly converted: {
    readonly at: string;
    readonly accountId: string | null;
    readonly contactId: string | null;
    readonly dealId: string | null;
  } | null;
  readonly boards: {
    readonly accounts: CrmBoardRefDto | null;
    readonly contacts: CrmBoardRefDto | null;
    readonly deals: CrmBoardRefDto | null;
  };
  readonly accountMatches: readonly MatchCandidateDto[];
  readonly contactMatches: readonly MatchCandidateDto[];
  readonly stages: readonly (CrmLabelDto & { readonly probability: number; readonly kind: StageKind })[];
  readonly defaultStageId: string | null;
  readonly currency: string;
  readonly users: readonly CrmUserDto[];
  readonly canEdit: boolean;
}

export const convertLeadSchema = z.object({
  account: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('existing'), itemId: z.uuid() }),
    z.object({
      mode: z.literal('new'),
      name: z.string().trim().min(1, 'Account name is required').max(255),
      website: z.string().trim().max(500).optional(),
    }),
  ]),
  contact: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('existing'), itemId: z.uuid(), fillEmpty: z.boolean().default(true) }),
    z.object({
      mode: z.literal('new'),
      name: z.string().trim().min(1, 'Contact name is required').max(255),
      email: z.email().max(320).optional(),
      phone: z.string().trim().max(64).optional(),
      title: z.string().trim().max(255).optional(),
    }),
  ]),
  deal: z
    .object({
      name: z.string().trim().min(1, 'Deal name is required').max(255),
      amount: z.number().min(0).max(1_000_000_000_000).optional(),
      stageLabelId: z.string().min(1).max(64).optional(),
      closeDate: isoDate.optional(),
    })
    .optional(),
  ownerId: z.uuid().optional(),
});
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export interface ConvertedRecordDto extends RecordRefDto {
  readonly created: boolean;
}

export interface ConversionResultDto {
  readonly lead: RecordRefDto;
  readonly account: ConvertedRecordDto;
  readonly contact: ConvertedRecordDto;
  readonly deal: ConvertedRecordDto | null;
}

// ---------------------------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------------------------

export const duplicatesQuerySchema = z.object({ kind: z.enum(['contacts', 'accounts']).default('contacts') });

export interface DuplicateRecordDto extends RecordRefDto {
  readonly email: string | null;
  readonly domain: string | null;
  readonly secondary: string | null;
  readonly owner: CrmUserDto | null;
  readonly linkCount: number;
  readonly filledFields: number;
  readonly updatedAt: string;
  /** Display text per compared column key (null = empty). */
  readonly fields: Readonly<Record<string, string | null>>;
}

export interface DuplicateFieldDto {
  readonly key: string;
  readonly title: string;
  /** True when at least two records hold different non-empty values. */
  readonly conflict: boolean;
}

export interface DuplicateClusterDto {
  readonly key: string;
  readonly reason: 'email' | 'domain' | 'name';
  readonly confidence: 'high' | 'medium';
  readonly records: readonly DuplicateRecordDto[];
  /** Suggested record to keep (most complete, most links, oldest). */
  readonly suggestedPrimaryId: string;
  /** Columns with a value on at least one record, in board order. */
  readonly fields: readonly DuplicateFieldDto[];
}

export interface DuplicatesDto {
  readonly kind: 'contacts' | 'accounts';
  readonly board: CrmBoardRefDto | null;
  readonly scanned: number;
  readonly clusters: readonly DuplicateClusterDto[];
  readonly dismissedCount: number;
  readonly canEdit: boolean;
}

export const mergeDuplicatesSchema = z.object({
  kind: z.enum(['contacts', 'accounts']),
  primaryId: z.uuid(),
  duplicateIds: z.array(z.uuid()).min(1).max(20),
  /** Column key → record whose value wins (overrides "keep primary, fill empty"). */
  fieldChoices: z.record(z.string().min(1).max(64), z.uuid()).optional(),
});
export type MergeDuplicatesInput = z.infer<typeof mergeDuplicatesSchema>;

export interface MergeResultDto {
  readonly primary: RecordRefDto;
  readonly mergedIds: readonly string[];
  readonly movedLinks: number;
  readonly filledFields: readonly string[];
  /** Activity row id recording the merge diff (pass to restore for a lossless Undo). */
  readonly mergeId: string | null;
}

export const dismissDuplicatesSchema = z.object({
  kind: z.enum(['contacts', 'accounts']),
  itemIds: z.array(z.uuid()).min(2).max(20),
  undo: z.boolean().optional(),
});
export type DismissDuplicatesInput = z.infer<typeof dismissDuplicatesSchema>;

export const restoreMergedSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(20),
  /** Merge to reverse: reverts the primary's patched fields and re-points moved links back. */
  primaryId: z.uuid().optional(),
});
export type RestoreMergedInput = z.infer<typeof restoreMergedSchema>;

export interface ActivityOptionsDto {
  readonly record: RecordRefDto & { readonly kind: CrmObjectKind };
  readonly activityBoard: CrmBoardRefDto | null;
  readonly types: readonly CrmLabelDto[];
  readonly contacts: readonly RecordRefDto[];
  readonly deals: readonly RecordRefDto[];
  readonly defaultContactIds: readonly string[];
  readonly defaultDealIds: readonly string[];
}
