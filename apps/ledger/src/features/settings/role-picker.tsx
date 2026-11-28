'use client';
/** One person's Ledger role, changed in place (People and roles, "Who handles money here?"). */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select, toast } from '@/components/ui';
import { setMemberRoleAction } from '@/server/actions/access';
import { LEDGER_ROLE_LABELS, type LedgerRole } from '@/lib/permissions';

export function RolePicker({ userId, name, role, choices }: { readonly userId: string; readonly name: string; readonly role: LedgerRole; readonly choices: readonly LedgerRole[] }) {
  const router = useRouter();
  const [value, setValue] = useState<LedgerRole>(role);
  const [pending, startTransition] = useTransition();
  if (choices.length === 0) return <span className="text-sm text-fg-secondary">{LEDGER_ROLE_LABELS[role]}</span>;
  const change = (next: LedgerRole) => {
    const before = value;
    setValue(next);
    startTransition(async () => {
      const result = await setMemberRoleAction({ userId, role: next });
      if (!result.ok) {
        setValue(before);
        toast.error("Couldn't change the role", result.error.message);
        return;
      }
      toast.success(`${name} is now ${LEDGER_ROLE_LABELS[next]}`);
      router.refresh();
    });
  };
  return (
    <div className="w-44">
      <Select
        aria-label={`Ledger role for ${name}`}
        value={value}
        disabled={pending}
        onValueChange={(next) => change(next as LedgerRole)}
        options={choices.map((choice) => ({ value: choice, label: LEDGER_ROLE_LABELS[choice] }))}
        data-testid="role-picker"
      />
    </div>
  );
}
