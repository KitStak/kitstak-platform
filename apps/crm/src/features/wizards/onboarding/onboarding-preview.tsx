'use client';
/**
 * Live "your workspace" preview beside the /welcome steps: it fills in as the user answers
 * (company tile and name, team size, the boards the starter installs, invited teammates).
 */
import { LayoutDashboard, Sparkles, Users } from 'lucide-react';
import { Avatar, cn } from '@/components/ui';
import type { GalleryBoard } from '@/server/services/wizards-gallery';
import { BoardGlyph } from '../components/template-icons';
import { MANAGE_OPTIONS, TEAM_SIZES, starterTemplateIds, type OnboardingDraft, type StarterId } from '../model/onboarding';

export type StarterPreviews = Readonly<Record<string, { readonly board: GalleryBoard; readonly accent: string }>>;

const TEAM_DOTS: Readonly<Record<(typeof TEAM_SIZES)[number], number>> = {
  '1': 1,
  '2-5': 3,
  '6-20': 5,
  '21-100': 6,
  '101-500': 7,
  '500+': 8,
};
/** Visible avatar slots before the rest collapse into a "+N" chip. */
const MAX_SLOTS = 6;

export interface OnboardingPreviewProps {
  readonly draft: OnboardingDraft;
  readonly starter: StarterId;
  readonly firstName: string;
  readonly previews: StarterPreviews;
  readonly stepId: string;
}

export function OnboardingPreview({ draft, starter, firstName, previews, stepId }: OnboardingPreviewProps) {
  const company = draft.organizationName.trim() || 'Your company';
  const boardIds = starterTemplateIds(starter, draft.manages);
  const highlightBoards = stepId === 'starter' || stepId === 'manage';
  const teamDots = draft.teamSize ? TEAM_DOTS[draft.teamSize] : 1;
  // Only real people get avatars: you, then invitees. Open seats show as dashed slots.
  const invited = draft.invitees.map((invitee) => ({ key: invitee.email, name: invitee.name ?? invitee.email }));
  const shownInvited = invited.slice(0, MAX_SLOTS - 1);
  const openSlots = Math.max(0, Math.min(teamDots - 1 - invited.length, MAX_SLOTS - 1 - shownInvited.length));
  const overflow = invited.length - shownInvited.length;
  return (
    <aside aria-label="Workspace preview" className="flex flex-col gap-3" data-testid="onboarding-preview">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-fg-secondary">
        <Sparkles aria-hidden className="size-4 text-primary" />
        Your workspace
      </span>
      <div className="flex flex-col gap-4 rounded-2xl border border-border-subtle bg-sunken p-5 shadow-xs">
        <div className="flex items-center gap-3">
          <Avatar name={company} shape="square" size="lg" />
          <div className="min-w-0">
            <p className="truncate text-md font-semibold text-fg" data-testid="onboarding-preview-company">
              {company}
            </p>
            <p className="truncate text-sm text-fg-secondary">
              {starter === 'success' ? 'Customer Success' : 'Sales CRM'} workspace
            </p>
          </div>
        </div>

        <div
          className={cn(
            'flex items-center gap-2 rounded-lg px-1 transition-colors duration-[var(--duration-normal)]',
            (stepId === 'team' || stepId === 'invite') && 'bg-primary-subtle',
          )}
        >
          <span className="flex items-center gap-1 py-1" data-testid="onboarding-preview-people">
            <Avatar name={firstName || 'You'} size="sm" />
            {shownInvited.map((person) => (
              <Avatar key={person.key} name={person.name} size="sm" className="animate-pop-in" />
            ))}
            {overflow > 0 ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold text-fg-secondary">
                +{overflow}
              </span>
            ) : null}
            {Array.from({ length: openSlots }, (_, index) => (
              <span
                key={`slot-${index}`}
                aria-hidden
                data-testid="onboarding-preview-slot"
                className="inline-block size-6 rounded-full border border-dashed border-border-strong"
              />
            ))}
          </span>
          <span className="flex items-center gap-1 text-sm text-fg-secondary">
            <Users aria-hidden className="size-3.5 text-icon" />
            {draft.teamSize ? (draft.teamSize === '1' ? 'Just you for now' : `${draft.teamSize} people`) : 'Team size not set'}
          </span>
        </div>

        <div className={cn('flex flex-col gap-1 rounded-lg transition-colors duration-[var(--duration-normal)]', highlightBoards && 'bg-primary-subtle p-1.5')}>
          <span className="px-1 text-xs font-semibold text-fg-muted ">Boards</span>
          <ul className="flex flex-col" data-testid="onboarding-preview-boards">
            {boardIds.map((id) => {
              const preview = previews[id];
              const accent = preview?.accent ?? 'blue';
              return (
                <li key={id} className="flex h-8 animate-fade-in items-center gap-2 rounded-md px-1.5 text-base text-fg">
                  <span
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px]"
                    style={{ background: `var(--label-${accent})`, color: `var(--label-${accent}-fg)` }}
                  >
                    <BoardGlyph templateId={id} className="size-3" />
                  </span>
                  <span className="truncate">{preview?.board.name ?? id}</span>
                  {preview ? (
                    <span className="ml-auto shrink-0 text-xs text-fg-muted tabular-nums">{preview.board.columns.length} columns</span>
                  ) : null}
                </li>
              );
            })}
            {boardIds.includes('crm-deals') ? (
              <li className="flex h-8 items-center gap-2 rounded-md px-1.5 text-base text-fg">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-fg">
                  <LayoutDashboard aria-hidden className="size-3" />
                </span>
                Sales dashboard
              </li>
            ) : null}
          </ul>
        </div>

        {draft.manages.length ? (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="What you manage">
            <span className="text-xs font-semibold text-fg-muted ">You manage</span>
            {draft.manages.map((id) => (
              <span key={id} className="inline-flex h-6 items-center rounded-full bg-raised px-2.5 text-sm text-fg shadow-xs">
                {MANAGE_OPTIONS.find((option) => option.id === id)?.label ?? id}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
