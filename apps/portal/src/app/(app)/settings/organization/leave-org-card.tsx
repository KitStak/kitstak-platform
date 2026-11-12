'use client';
/** Danger-zone action: leave the active organization (two-step confirm, Better Auth endpoint). */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DoorOpen } from 'lucide-react';
import { Button } from '@/components/ui';
import { organization } from '@/lib/auth-client';

export function LeaveOrgButton({
  orgId,
  orgName,
  isSoleOwner,
}: {
  readonly orgId: string;
  readonly orgName: string;
  readonly isSoleOwner: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setError(null);
    setPending(true);
    try {
      const result = await organization.leave({ organizationId: orgId });
      if (result.error) {
        setError(result.error.message ?? 'Leaving failed.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Try again.');
    } finally {
      setPending(false);
    }
  };

  if (isSoleOwner) {
    return (
      <p className="text-xs text-fg-muted">
        You’re the only owner of {orgName}. Promote another member to owner before leaving.
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button
        variant="danger"
        size="sm"
        onClick={() => setConfirming(true)}
        leadingIcon={<DoorOpen aria-hidden />}
      >
        Leave organization
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-secondary">
        You’ll lose access to <span className="font-semibold text-fg">{orgName}</span> across every KitStak
        app. A member with invite rights can bring you back.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="danger" size="sm" onClick={() => void leave()} loading={pending}>
          Yes, leave {orgName}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
