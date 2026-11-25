'use client';
import { useRouter } from 'next/navigation';
import { Notice } from '@/components/ui';
import { signOut } from '@/lib/auth-client';
import { StepEyebrow } from '../../_components/form-parts';

/** The thin strip above the picker: where the person is, whose workspace it is, and a way out. */
export function PlanStepHeader({
  orgName,
  email,
  trialUsed,
}: {
  readonly orgName: string;
  readonly email: string;
  readonly trialUsed: boolean;
}) {
  const router = useRouter();
  const onSignOut = async () => {
    try {
      await signOut();
    } finally {
      router.replace('/login?notice=signed-out');
      router.refresh();
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <StepEyebrow step={2} total={2} label="Your apps" />
        <p className="text-xs text-fg-muted">
          <span className="font-medium text-fg-secondary">{orgName}</span>
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          {email}
          <span className="mx-1.5" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={onSignOut}
            className="-my-3.5 rounded-sm py-3.5 font-medium text-fg-secondary underline underline-offset-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Sign out
          </button>
        </p>
      </div>
      {trialUsed ? (
        <Notice tone="info">You already used your free trial. You can still pick a plan.</Notice>
      ) : null}
    </div>
  );
}
