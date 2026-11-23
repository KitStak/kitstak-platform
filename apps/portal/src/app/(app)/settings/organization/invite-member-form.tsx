'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { formatMoney, type PlanSelection } from '@kitstak/billing/catalog';
import type { ChangePreview } from '@kitstak/billing/server';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import { organization } from '@/lib/auth-client';
import { confirmPlanChangeAction, previewPlanChangeAction } from '@/server/billing-actions';

const INVITE_ROLES = ['admin', 'member', 'viewer'] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

const emailSchema = z.email('Enter a valid email address.');

export interface InviteSeatInfo {
  /** The viewer may pay and change the plan (owner or billing manager). */
  readonly canManageBilling: boolean;
  /** The paid plan when it is priced per seat. null in a trial, with no plan, and on plans with no seat price. */
  readonly paidSelection: PlanSelection | null;
  readonly ownerName: string | null;
  readonly siteUrl: string;
}

function seatsInUse(count: number): string {
  return count === 1 ? 'Your 1 seat is in use.' : `All ${count} seats are in use.`;
}

interface SeatOffer {
  readonly email: string;
  readonly role: InviteRole;
  readonly selection: PlanSelection;
  readonly preview: ChangePreview;
}

/**
 * Invite a teammate. When every paid seat is in use, the server refuses the invite before anything
 * is sent (SPEC 6.9). A billing manager then sees the price and says yes first. Anyone else is told
 * who can add a seat. Nothing raises the bill by itself.
 */
export function InviteMemberForm({
  orgId,
  emailVerified,
  seats,
}: {
  /** Passed explicitly: portal sessions do not always carry an active organization. */
  readonly orgId: string;
  readonly emailVerified: boolean;
  readonly seats: InviteSeatInfo;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [seatMessage, setSeatMessage] = useState<string | null>(null);
  const [offer, setOffer] = useState<SeatOffer | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState<'invite' | 'seat' | null>(null);

  /** Sends the invite. Returns 'seat_limit' when the plan has no free seat. */
  const sendInvite = async (to: string, as: InviteRole): Promise<'sent' | 'seat_limit' | 'failed'> => {
    const result = await organization.inviteMember({ email: to, role: as, organizationId: orgId });
    if (!result.error) {
      setEmail('');
      setSent(`Invite sent to ${to}.`);
      router.refresh();
      return 'sent';
    }
    if (result.error.code === 'SEAT_LIMIT_REACHED') {
      setSeatMessage(result.error.message ?? 'All your seats are in use. Add a seat first.');
      return 'seat_limit';
    }
    setError(result.error.message ?? 'We could not send the invite. Try again.');
    return 'failed';
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }
    setError(null);
    setSent(null);
    setSeatMessage(null);
    setOffer(null);
    setPending('invite');
    try {
      const outcome = await sendInvite(parsed.data, role);
      if (outcome === 'seat_limit' && seats.canManageBilling && seats.paidSelection) {
        // Ask the gateway what one more seat costs. Nothing is charged by asking.
        const selection = { ...seats.paidSelection, seats: seats.paidSelection.seats + 1 };
        const preview = await previewPlanChangeAction({ selection });
        if (preview.ok) setOffer({ email: parsed.data, role, selection, preview: preview.data });
      }
    } catch {
      setError('We could not reach KitStak. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  const addSeatAndInvite = async () => {
    if (!offer || pending) return;
    setPending('seat');
    setError(null);
    try {
      const changed = await confirmPlanChangeAction({
        selection: offer.selection,
        prorationDate: offer.preview.prorationDate,
        expectedDueTodayCents: offer.preview.dueTodayCents,
      });
      if (!changed.ok) {
        setError(changed.error.message);
        if (changed.error.code === 'price_changed') {
          const fresh = await previewPlanChangeAction({ selection: offer.selection });
          if (fresh.ok) setOffer({ ...offer, preview: fresh.data });
        }
        return;
      }
      setOffer(null);
      setSeatMessage(null);
      const outcome = await sendInvite(offer.email, offer.role);
      if (outcome === 'sent') setSent(`Seat added. Invite sent to ${offer.email}.`);
    } catch {
      setError('We could not reach KitStak. Check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  if (!emailVerified) {
    return (
      <Notice
        tone="info"
        action={
          <Link href="/verify-email?next=/settings/organization" className="text-sm font-semibold underline underline-offset-2">
            Enter code
          </Link>
        }
      >
        Verify your email first. It takes one minute. Then you can invite people.
      </Notice>
    );
  }

  const paid = seats.paidSelection;
  const period = paid?.interval === 'yearly' ? 'per year' : 'per month';
  const pulseOnly = seatMessage?.startsWith('Pulse covers') ?? false;

  return (
    <div className="flex flex-col gap-3">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Field label="Email" error={error} hint={sent ?? undefined}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                id={inputId}
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                leadingIcon={<Mail aria-hidden />}
                aria-describedby={describedBy}
                invalid={invalid}
              />
            )}
          </Field>
        </div>
        <div className="w-full sm:w-36">
          <Field label="Role">
            {({ inputId }) => (
              <Select id={inputId} value={role} onChange={(event) => setRole(event.target.value as InviteRole)} className="capitalize">
                {INVITE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit" loading={pending === 'invite'} disabled={pending === 'seat'} className="sm:mt-[22px]">
          Send invite
        </Button>
      </form>

      {offer && paid ? (
        <Notice
          tone="warning"
          role="status"
          testId="invite-seat-offer"
          action={
            <>
              <Button size="lg" data-testid="invite-add-seat" loading={pending === 'seat'} onClick={addSeatAndInvite}>
                Add seat and send invite
              </Button>
              <Button variant="ghost" size="lg" disabled={pending === 'seat'} onClick={() => { setOffer(null); setSeatMessage(null); }}>
                Not now
              </Button>
            </>
          }
        >
          {seatsInUse(paid.seats)} Add 1 seat for {formatMoney(offer.preview.recurringDeltaCents)} more {period}.{' '}
          {offer.preview.dueTodayCents > 0
            ? `You pay ${formatMoney(offer.preview.dueTodayCents)} today for the days left.`
            : `You pay ${formatMoney(0)} today.`}
        </Notice>
      ) : seatMessage ? (
        <Notice
          tone="warning"
          role="status"
          testId="invite-seat-limit"
          action={
            pulseOnly ? (
              <a href={`${seats.siteUrl}/contact`} className="text-sm font-semibold underline underline-offset-2">
                Talk to us
              </a>
            ) : seats.canManageBilling ? (
              <Link href="/billing/plan?focus=seats" className="text-sm font-semibold underline underline-offset-2">
                Add a seat
              </Link>
            ) : undefined
          }
        >
          {pulseOnly || seats.canManageBilling || !paid
            ? seatMessage
            : `${seatsInUse(paid.seats)} Ask ${seats.ownerName ?? 'your organization owner'} to add one.`}
        </Notice>
      ) : null}
    </div>
  );
}
