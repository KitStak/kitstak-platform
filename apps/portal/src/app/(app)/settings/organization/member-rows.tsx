'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserMinus, X } from 'lucide-react';
import { Badge, Button, Spinner, cn } from '@/components/ui';
import { organization } from '@/lib/auth-client';

const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'] as const;
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
    <li className="flex flex-wrap items-center gap-3 px-6 py-4">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-inverse text-2xs font-bold text-fg-inverse">
        {initials(name, email)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">{name}</span>
          {isSelf ? <Badge tone="info">You</Badge> : null}
        </span>
        <span className="block truncate text-xs text-fg-muted">{email}</span>
        {error ? (
          <span role="alert" className="mt-1 block text-2xs font-medium text-danger-text">
            {error}
          </span>
        ) : null}
      </span>
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
              'h-8 rounded-md border border-border-input bg-panel px-2 text-sm text-fg capitalize',
              'hover:border-border-input-hover focus:border-border-strong focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--border-strong)_28%,transparent)] focus:outline-none',
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
    <li className="flex flex-wrap items-center gap-3 px-6 py-4">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{email}</span>
        <span className="block text-xs text-fg-muted capitalize">
          {role} · {expired ? 'expired' : `expires ${expiresLabel}`}
        </span>
        {error ? (
          <span role="alert" className="mt-1 block text-2xs font-medium text-danger-text">
            {error}
          </span>
        ) : null}
      </span>
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
    </li>
  );
}
