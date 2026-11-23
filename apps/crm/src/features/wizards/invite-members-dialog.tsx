'use client';
/**
 * Invite members: email chips with per-invitee roles, optional team, partial-success results
 * shown inline, and the pending invitations list (copy link, revoke with Undo).
 */
import { useMemo, useState } from 'react';
import { SeatLimitLink, seatLimitKind } from '@/features/shell/seat-limit-link';
import { Check, Copy, Mail, UserPlus } from 'lucide-react';
import {
  Badge,
  Button,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Select,
  SkeletonRows,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@/components/ui';
import type { InvitationDto } from '@/server/services/contracts/dto';
import { useCan, useOrg } from '@/features/shell/org-context';
import {
  describeError,
  sendInvitations,
  useBulkInvite,
  useInvitationsList,
  useMembersList,
  useRevokeInvite,
  useTeamsList,
} from './api';
import { InviteeList } from './components/invitee-list';
import { GuardedDialog, InlineError, preventEscape } from './components/primitives';
import { expiresIn, grantableRoles, inviteLink, roleLabel, type InviteRole, type Invitee } from './model/invites';

export interface InviteMembersDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Focus ring only for keyboard focus, rounded like the design-system controls. */
const TAB_FOCUS = 'rounded-t-sm focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function InviteMembersDialog({ open, onClose }: InviteMembersDialogProps) {
  const { org, role: myRole, user } = useOrg();
  const canInvite = useCan('member:invite');
  const canSeeMembers = useCan('member:read');
  const roles = grantableRoles(myRole);
  const invitations = useInvitationsList(org.id, open && canSeeMembers);
  const teams = useTeamsList(org.id, open && canSeeMembers);
  const members = useMembersList(org.id, open && canSeeMembers);
  const bulk = useBulkInvite(org.id);
  const [tab, setTab] = useState<'invite' | 'pending'>('invite');
  const [invitees, setInvitees] = useState<Invitee[]>([]);
  const [defaultRole, setDefaultRole] = useState<InviteRole>('member');
  const [teamId, setTeamId] = useState<string>('none');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // The plan's seat limit (docs/billing/SPEC.md section 6.9): the whole sentence and the next step.
  const seatMessage = Object.values(rowErrors).find((message) => seatLimitKind(message) !== null) ?? null;
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);

  const pendingEmails = useMemo(
    () => new Set((invitations.data ?? []).map((invitation) => invitation.email.toLowerCase())),
    [invitations.data],
  );
  const memberEmails = useMemo(
    () => new Set((members.data ?? []).map((member) => member.email.toLowerCase())),
    [members.data],
  );

  const send = () => {
    if (!invitees.length || bulk.isPending) return;
    setError(null);
    bulk.mutate(
      {
        invitations: invitees.map((invitee) => ({
          email: invitee.email,
          role: invitee.role,
          ...(teamId !== 'none' ? { teamId } : {}),
        })),
      },
      {
        onSuccess: (results) => {
          const failed = results.filter((result) => !result.ok);
          const sent = results.length - failed.length;
          setRowErrors(Object.fromEntries(failed.map((result) => [result.email, result.ok ? '' : result.message])));
          setInvitees((current) => current.filter((invitee) => failed.some((result) => result.email === invitee.email)));
          if (sent > 0) {
            // No invitation email goes out yet: sharing the link is the way people join.
            const created = results.filter((result): result is Extract<typeof result, { ok: true }> => result.ok);
            const first = created[0]?.invitation;
            const summary = failed.length
              ? `${failed.length} couldn’t be created. See the list for details.`
              : sent === 1
                ? `Share the invite link with ${first?.email ?? 'them'} so they can join.`
                : 'Share each invite link from Pending so they can join.';
            if (sent === 1 && first) {
              toast.undo('Invitation created', {
                description: summary,
                undoLabel: 'Copy invite link',
                duration: 10_000,
                onUndo: async () => {
                  const ok = await copyText(inviteLink(window.location.origin, first.id));
                  if (ok) toast.success('Invite link copied', `Send it to ${first.email}. They sign in with that email to join.`);
                  else toast.error('Couldn’t copy the link', 'Your browser blocked clipboard access. Copy it from Pending.');
                },
              });
            } else {
              toast.success(`${sent} invitations created`, summary);
            }
          }
          if (failed.length && sent === 0)
            setError({ message: 'None of the invitations could be sent. Check the details below.', retryable: false });
          if (!failed.length) setTab('pending');
        },
        onError: (cause) => {
          const described = describeError(cause);
          setError(described);
        },
      },
    );
  };

  const pendingCount = invitations.data?.length ?? 0;

  return (
    <GuardedDialog open={open} onOpenChange={(next) => !next && onClose()} dirty={invitees.length > 0 && !bulk.isPending} locked={bulk.isPending}>
      {(requestClose) => (
        <DialogContent size="md" data-testid="invite-dialog" onEscapeKeyDown={preventEscape}>
          <DialogHeader
            title={
              <span className="block">
                <span className="text-lg sm:hidden">Invite to {org.name}</span>
                <span className="max-sm:hidden">Invite people to {org.name}</span>
              </span>
            }
            description={
              <span className="block max-w-prose [text-wrap:pretty]">
                Each invitation has a join link you share from Pending. Links expire after 7&nbsp;days.
              </span>
            }
            icon={
              <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary max-sm:hidden">
                <UserPlus aria-hidden className="size-5" />
              </span>
            }
          />
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'invite' | 'pending')} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-6" aria-label="Invite sections">
              <TabsTrigger value="invite" className={TAB_FOCUS}>
                Invite
              </TabsTrigger>
              <TabsTrigger value="pending" data-testid="pending-tab" disabled={!canSeeMembers} className={TAB_FOCUS}>
                Pending
                {pendingCount ? <Badge size="sm" tone="primary">{pendingCount}</Badge> : null}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="invite" className="flex min-h-0 flex-1 flex-col outline-none">
              <DialogBody className="flex min-h-[300px] flex-col gap-4 pt-4 pb-4">
                {!canInvite ? (
                  <InlineError>Your role can’t invite people. Ask an admin to send the invitation.</InlineError>
                ) : (
                  <>
                    <InviteeList
                      invitees={invitees}
                      onChange={(next) => {
                        setInvitees(next);
                        setError(null);
                      }}
                      roles={roles}
                      defaultRole={defaultRole}
                      onDefaultRoleChange={setDefaultRole}
                      blocked={pendingEmails}
                      members={memberEmails}
                      selfEmail={user.email}
                      rowErrors={rowErrors}
                      disabled={bulk.isPending}
                      autoFocus
                      onSubmitShortcut={send}
                    />
                    {teams.data && teams.data.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-semibold text-fg-secondary" htmlFor="invite-team">
                          Add to team <span className="font-normal text-fg-muted">(optional)</span>
                        </label>
                        <Select
                          id="invite-team"
                          size="lg"
                          value={teamId}
                          onValueChange={setTeamId}
                          options={[{ value: 'none', label: 'No team' }, ...teams.data.map((team) => ({ value: team.id, label: team.name }))]}
                          disabled={bulk.isPending}
                        />
                      </div>
                    ) : null}
                    {error ? (
                      <InlineError onRetry={error.retryable ? send : undefined}>{error.message}</InlineError>
                    ) : null}
                    {seatMessage ? (
                      <div
                        role="status"
                        data-testid="invite-seat-limit"
                        className="flex flex-col gap-1 rounded-md border border-warning/25 bg-warning-subtle px-3 py-2 text-sm text-warning-text"
                      >
                        <p>{seatMessage}</p>
                        <SeatLimitLink text={seatMessage} />
                      </div>
                    ) : null}
                  </>
                )}
              </DialogBody>
              <DialogFooter>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={requestClose} disabled={bulk.isPending}>
                    Cancel
                  </Button>
                  <Button
                    onClick={send}
                    loading={bulk.isPending}
                    disabled={!invitees.length || !canInvite}
                    leadingIcon={<Mail aria-hidden />}
                    data-testid="invite-send"
                  >
                    {invitees.length > 1 ? `Send ${invitees.length} invites` : 'Send invite'}
                  </Button>
                </div>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="pending" className="flex min-h-0 flex-1 flex-col outline-none">
              <DialogBody className="min-h-[300px] pt-4 pb-4">
                <PendingInvitations
                  orgId={org.id}
                  loading={invitations.isLoading}
                  error={invitations.isError}
                  onRetry={() => void invitations.refetch()}
                  invitations={invitations.data ?? []}
                  onInviteMore={() => setTab('invite')}
                />
              </DialogBody>
              <DialogFooter>
                <Button variant="ghost" onClick={requestClose}>
                  Close
                </Button>
                <Button variant="secondary" leadingIcon={<UserPlus aria-hidden />} onClick={() => setTab('invite')}>
                  Invite more
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      )}
    </GuardedDialog>
  );
}

function PendingInvitations({
  orgId,
  loading,
  error,
  onRetry,
  invitations,
  onInviteMore,
}: {
  readonly orgId: string;
  readonly loading: boolean;
  readonly error: boolean;
  readonly onRetry: () => void;
  readonly invitations: readonly InvitationDto[];
  readonly onInviteMore: () => void;
}) {
  const revoke = useRevokeInvite(orgId);
  const [copied, setCopied] = useState<string | null>(null);

  if (loading) return <div aria-busy="true"><SkeletonRows rows={3} /></div>;
  if (error) return <InlineError onRetry={onRetry}>Pending invitations couldn’t load.</InlineError>;
  if (!invitations.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-icon">
          <Mail aria-hidden className="size-5" />
        </span>
        <p className="font-semibold text-fg">No pending invitations</p>
        <Button variant="secondary" className="mt-2" onClick={onInviteMore}>
          Invite people
        </Button>
      </div>
    );
  }

  const copy = async (invitation: InvitationDto) => {
    const ok = await copyText(inviteLink(window.location.origin, invitation.id));
    if (ok) {
      setCopied(invitation.id);
      toast.success('Invite link copied', `Send it to ${invitation.email}. They sign in with that email to join.`);
      window.setTimeout(() => setCopied((current) => (current === invitation.id ? null : current)), 2000);
    } else toast.error('Couldn’t copy the link', 'Your browser blocked clipboard access.');
  };

  const revokeOne = (invitation: InvitationDto) => {
    revoke.mutate(invitation.id, {
      onSuccess: () =>
        toast.undo(`Invitation to ${invitation.email} revoked`, {
          onUndo: async () => {
            const [result] = await sendInvitations(orgId, {
              invitations: [{ email: invitation.email, role: invitation.role === 'owner' ? 'admin' : invitation.role, ...(invitation.teamId ? { teamId: invitation.teamId } : {}) }],
            });
            if (!result?.ok) throw new Error(result && !result.ok ? result.message : 'Please try again.');
            onRetry();
            toast.success('Invitation restored');
          },
        }),
      onError: (cause) =>
        toast.error('Couldn’t revoke the invitation', cause instanceof Error ? cause.message : 'Please try again.'),
    });
  };

  return (
    <div className="flex flex-col gap-2">
    <p className="text-sm text-fg-secondary" data-testid="pending-share-note">
      Copy each link and send it to the person. They join by signing in with the invited email.
    </p>
    <ul aria-label="Pending invitations" className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle" data-testid="pending-invitations">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="pending-invitation">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base text-fg">{invitation.email}</p>
            <p className="text-xs text-fg-muted">
              {roleLabel(invitation.role)} · {expiresIn(invitation.expiresAt)}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            aria-label={copied === invitation.id ? 'Link copied' : `Copy invite link for ${invitation.email}`}
            leadingIcon={copied === invitation.id ? <Check aria-hidden className="text-success" /> : <Copy aria-hidden />}
            onClick={() => void copy(invitation)}
            data-testid="pending-copy-link"
          >
            {copied === invitation.id ? 'Copied' : 'Copy link'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => revokeOne(invitation)}>
            Revoke
          </Button>
        </li>
      ))}
    </ul>
    </div>
  );
}
