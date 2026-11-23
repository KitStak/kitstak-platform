import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Check } from 'lucide-react';
import { formatDay } from '@kitstak/billing/catalog';
import { getPlanState, listBillingHolders } from '@kitstak/billing/server';
import { requireBillingContext } from '@/server/billing/context';
import { listOrgMembers } from '@/server/orgs';
import { Card, Notice } from '@/components/ui';
import { BillingHeader, TestModeBadge } from '@/features/billing/billing-chrome';
import { TeamManager } from '@/features/billing/team/team-manager';

export const metadata: Metadata = { title: 'Billing team' };

const CAN_DO = ['Pay bills and update the card', 'Change the plan, seats and warehouses', 'Download invoices and edit billing details'];

/** Who holds billing (SPEC 6.7). Owners are listed and fixed. An owner adds or removes billing managers. */
export default async function BillingTeamPage() {
  const context = await requireBillingContext('/billing/team');
  const { rt, org, access, session, timeZone } = context;
  if (!access.canView) redirect('/billing');
  const [holders, members, state] = await Promise.all([listBillingHolders(rt.db, org.id), listOrgMembers(org.id), getPlanState(rt, org.id)]);
  const holderIds = new Set(holders.map((holder) => holder.userId));
  const candidates = members.filter((person) => !holderIds.has(person.userId));

  return (
    <div className="flex flex-col gap-6">
      <BillingHeader
        orgName={org.name}
        title="Billing team"
        description="The people who can pay and change the plan."
        badges={<TestModeBadge mode={state.mode} />}
      />
      {holders.length === 1 ? (
        <Notice tone="info">Add a second person so billing never gets stuck.</Notice>
      ) : null}
      {!access.canAssignManagers ? (
        <Notice tone="neutral" role="status">
          Only an owner can add or remove a billing manager.{access.ownerName ? ` Ask ${access.ownerName}.` : ''}
        </Notice>
      ) : null}

      {/* One left edge with the tabs and the title. The list keeps a readable width; the help card sits beside it from 1024 px. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <Card className="overflow-hidden" aria-label="People who can manage billing">
        <TeamManager
          holders={holders.map((holder) => ({
            userId: holder.userId,
            name: holder.name,
            email: holder.email,
            kind: holder.kind,
            addedLabel: holder.addedAt ? formatDay(holder.addedAt, timeZone) : null,
          }))}
          candidates={candidates.map((person) => ({ userId: person.userId, name: person.name, email: person.email }))}
          canAssign={access.canAssignManagers}
          selfId={session.user.id}
        />
      </Card>

      <Card className="p-5 sm:p-6" aria-labelledby="billing-manager-can">
        <h2 id="billing-manager-can" className="text-base font-semibold text-fg">
          What a billing manager can do
        </h2>
        <p className="mt-1 text-sm text-fg-secondary">Pay bills, change the plan and download invoices. No extra access to your data.</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {CAN_DO.map((line) => (
            <li key={line} className="flex items-center gap-2 text-sm text-fg">
              <Check aria-hidden className="size-4 shrink-0 text-success-text" />
              {line}
            </li>
          ))}
        </ul>
      </Card>
      </div>
    </div>
  );
}
