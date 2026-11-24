'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserMinus, X } from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@/components/ui';
import { organization } from '@/lib/auth-client';

/** Admin, member and viewer use a seat. Guest is free. */
const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer', 'guest'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function MemberRow({
  memberId,
  orgId,
  name,
  email,
  role,
  isSelf,
  canManage,
}: {
  readonly memberId: string;
  /** Passed explicitly: portal sessions don't always carry an active organization. */
  readonly orgId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly isSelf: boolean;
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const primaryRole = role.split(',')[0]?.trim() || 'member';
  const isOwner = primaryRole === 'owner';
  const editable = canManage && !isSelf && !isOwner;

  const changeRole = async (next: AssignableRole) => {
    setError(null);
    setPending(true);
    try {
      const result = await organization.updateMemberRole({ memberId, role: next, organizationId: orgId });
      if (result.error) {
        setError(result.error.message ?? 'Role change failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Try again.');
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setError(null);
    setPending(true);
    try {
      const result = await organization.removeMember({ memberIdOrEmail: memberId, organizationId: orgId });
      if (result.error) {
        setError(result.error.message ?? 'Removal failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    // Phones: the name and the whole email get the first line and wrap, never cut. The role and
    // Remove sit on a second line under them. From 640 px up everything is one row.
    <li data-testid="member-row" className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-6 py-4 sm:flex-nowrap">
      <span className="inline-flex size-8 shrink-0 items-center justify-center self-start rounded-full bg-inverse text-2xs font-bold text-fg-inverse sm:self-center">
        {initials(name, email)}
      </span>
      <span className="min-w-0 flex-1 basis-[calc(100%-44px)] sm:basis-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-testid="member-name" className="min-w-0 text-sm font-semibold text-fg [overflow-wrap:anywhere]">
            {name}
          </span>
          {isSelf ? <Badge tone="info">You</Badge> : null}
        </span>
        <span data-testid="member-email" className="block text-xs text-fg-muted [overflow-wrap:anywhere]">
          {email}
        </span>
        {error ? (
          <span role="alert" className="mt-1 block text-2xs font-medium text-danger-text">
            {error}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
        {pending ? <Spinner size="xs" className="text-icon" /> : null}
        {editable ? (
          <>
            <label className="sr-only" htmlFor={`role-${memberId}`}>
              Role for {name}
            </label>
            <select
              id={`role-${memberId}`}
              value={ASSIGNABLE_ROLES.includes(primaryRole as AssignableRole) ? primaryRole : 'member'}
              disabled={pending}
              onChange={(event) => void changeRole(event.target.value as AssignableRole)}
              className={cn(
                'h-8 rounded-md border border-border-input bg-panel px-2 text-sm text-fg capitalize pointer-coarse:h-11 pointer-coarse:text-md',
                'hover:border-border-input-hover focus:field-focus',
              )}
            >
              {ASSIGNABLE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void remove()}
              disabled={pending}
              leadingIcon={<UserMinus aria-hidden />}
            >
              Remove
            </Button>
          </>
        ) : (
          <Badge
            tone="neutral"
            className={cn('capitalize', !canManage && 'cursor-default')}
            title={canManage ? undefined : 'Only owners and admins can change roles'}
          >
            {primaryRole}
          </Badge>
        )}
      </span>
    </li>
  );
}

export function InvitationRow({
  invitationId,
  email,
  role,
  expired,
  expiresLabel,
  canManage,
}: {
  readonly invitationId: string;
  readonly email: string;
  readonly role: string;
  readonly expired: boolean;
  readonly expiresLabel: string;
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const cancel = async () => {
    setError(null);
    setPending(true);
    try {
      const result = await organization.cancelInvitation({ invitationId });
      if (result.error) {
        setError(result.error.message ?? 'Cancel failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    // Phones: the whole address on its own line, wrapped and never cut. The state and Cancel sit under it.
    <li data-testid="invitation-row" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4 sm:flex-nowrap">
      <span className="min-w-0 flex-1 basis-full sm:basis-0">
        <span data-testid="invitation-email" className="block text-sm font-semibold text-fg [overflow-wrap:anywhere]">
          {email}
        </span>
        <span className="block text-xs text-fg-muted capitalize">
          {role} · {expired ? 'expired' : `expires ${expiresLabel}`}
        </span>
        {error ? (
          <span role="alert" className="mt-1 block text-2xs font-medium text-danger-text">
            {error}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Badge tone={expired ? 'danger' : 'warning'}>{expired ? 'Expired' : 'Pending'}</Badge>
        {canManage ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void cancel()}
            loading={pending}
            leadingIcon={<X aria-hidden />}
          >
            Cancel
          </Button>
        ) : null}
      </span>
    </li>
  );
}
