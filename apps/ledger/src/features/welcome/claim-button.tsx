'use client';
/** The claim step (SPEC 3.2): "Run Ledger for this workspace" makes this admin the Ledger owner. */
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@/components/ui';
import { claimLedgerAction } from '@/server/actions/access';

export function ClaimButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      data-testid="claim-ledger"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await claimLedgerAction();
          if (!result.ok) {
            toast.error("Couldn't take over Ledger", result.error.message);
            return;
          }
          toast.success('You now run Ledger for this workspace');
          router.refresh();
        })
      }
    >
      Run Ledger for this workspace
    </Button>
  );
}
