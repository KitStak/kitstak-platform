'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { formatMoney, type PlanSelection } from '@kitstak/billing/catalog';
import type { ChangePreview } from '@kitstak/billing/server';
import { Button, Field, Input, LinkButton, Notice, Select } from '@/components/ui';
import { clearInviteDraft, readInviteDraft, saveInviteDraft } from '@/lib/invite-draft';
import { inviteMemberAction } from '@/server/auth-relay-actions';
import { confirmPlanChangeAction, previewPlanChangeAction } from '@/features/billing/actions';
import { INVITE_ROLES, ROLE_LABEL, countTyped, invitePlanLine, parseInviteEmails, type InviteRole } from './invite-model';

export interface InviteSeatInfo {
  /** The viewer may pay and change the plan (owner or billing manager). */
  readonly canManageBilling: boolean;
  /** The paid plan when it is priced per seat. null in a trial, with no plan, and on plans with no seat price. */
  readonly paidSelection: PlanSelection | null;
  /** A paid plan is live (with or without a seat price). */
  readonly paid: boolean;
  /** Seats the paid plan covers. null: no limit (a trial, no plan, or a plan with no seat limit). */
  readonly limit: number | null;
  /** Seats in use now: people with a seat role, and open invites with one. */
  readonly used: number;
  readonly ownerName: string | null;
  readonly siteUrl: string;
}

function seatsInUse(count: number): string {
  return count === 1 ? 'Your 1 seat is in use.' : `All ${count} seats are in use.`;
}

/** 'ana@x.co', 'ana@x.co and bo@x.co', 'ana@x.co, bo@x.co and cy@x.co'. */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

interface SeatOffer {
  /** The people still waiting for a seat. */
  readonly emails: readonly string[];
  readonly role: InviteRole;
  readonly selection: PlanSelection;
  readonly preview: ChangePreview;
}

/** Why adding the seat did not work. A card problem comes with the way to fix the card. */
interface OfferError {
  readonly message: string;
  readonly card: boolean;
}

type SendOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'seat_limit'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Invite teammates. The field takes several addresses. Under the form one line says what sending
 * does to the plan, before anything is sent. When every paid seat is in use, the server refuses the
 * invite before anything is sent (SPEC 6.9). A billing manager then sees the price and says yes
 * first. Anyone else is told who can add a seat. Nothing raises the bill by itself.
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
  const [offerError, setOfferError] = useState<OfferError | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState<'invite' | 'seat' | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Back from "Update card": the addresses and the role are still here (kept for this tab only).
  useEffect(() => {
    const draft = readInviteDraft();
    if (!draft) return;
    const frame = window.requestAnimationFrame(() => {
      // Cleared only once it is back in the field (an effect can run twice in development).
      clearInviteDraft();
      setEmail(draft.emails);
      if ((INVITE_ROLES as readonly string[]).includes(draft.role)) setRole(draft.role as InviteRole);
      inputRef.current?.scrollIntoView({ block: 'center' });
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  /** Sends one invite. "All seats are in use" is an answer, not a failed request in the console. */
  const sendOne = async (to: string, as: InviteRole): Promise<SendOutcome> => {
    const result = await inviteMemberAction({ email: to, role: as, organizationId: orgId });
    if (!result.error) return { kind: 'sent' };
    if (result.error.code === 'SEAT_LIMIT_REACHED') return { kind: 'seat_limit', message: result.error.message ?? 'All your seats are in use. Add a seat first.' };
    return { kind: 'failed', message: result.error.message ?? 'We could not send the invite. Try again.' };
  };

  /**
   * Sends the invites one after another and stops at the first that cannot go. The addresses that
   * were not sent stay in the field, so nothing typed is lost. Returns what is left and why.
   */
  const sendAll = async (emails: readonly string[], as: InviteRole): Promise<{ sentTo: string[]; left: readonly string[]; stop: SendOutcome | null }> => {
    const sentTo: string[] = [];
    for (let index = 0; index < emails.length; index += 1) {
      const to = emails[index] as string;
      const outcome = await sendOne(to, as);
      if (outcome.kind !== 'sent') return { sentTo, left: emails.slice(index), stop: outcome };
      sentTo.push(to);
    }
    return { sentTo, left: [], stop: null };
  };

  const sentWords = (sentTo: readonly string[], lead = ''): string | null =>
    sentTo.length === 0 ? null : `${lead}${sentTo.length === 1 ? 'Invite' : 'Invites'} sent to ${listOf(sentTo)}.`;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const parsed = parseInviteEmails(email);
    if (!parsed.ok) {
      setError(parsed.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setSent(null);
    setSeatMessage(null);
    setOffer(null);
    setOfferError(null);
    setPending('invite');
    try {
      const { sentTo, left, stop } = await sendAll(parsed.emails, role);
      setEmail(left.join(', '));
      setSent(sentWords(sentTo));
      if (sentTo.length > 0) router.refresh();
      if (stop?.kind === 'failed') setError(left.length > 1 || sentTo.length > 0 ? `${left[0]}: ${stop.message}` : stop.message);
      if (stop?.kind === 'seat_limit') {
        setSeatMessage(stop.message);
        if (seats.canManageBilling && seats.paidSelection) {
          // Ask the gateway what the missing seats cost. Nothing is charged by asking.
          const selection = { ...seats.paidSelection, seats: seats.paidSelection.seats + left.length };
          const preview = await previewPlanChangeAction({ selection });
          if (preview.ok) setOffer({ emails: left, role, selection, preview: preview.data });
        }
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
    setOfferError(null);
    setError(null);
    try {
      const changed = await confirmPlanChangeAction({
        selection: offer.selection,
        basis: offer.preview.basis,
        expectedDueTodayCents: offer.preview.dueTodayCents,
      });
      if (!changed.ok) {
        // The reason belongs to the seat, not to the address: it shows in the offer, with the way
        // to fix a card. The address stays in the field.
        const card = changed.error.code === 'card_declined' || changed.error.code === 'payment_failed';
        setOfferError({ message: changed.error.message, card });
        if (changed.error.code === 'price_changed') {
          const fresh = await previewPlanChangeAction({ selection: offer.selection });
          if (fresh.ok) setOffer({ ...offer, preview: fresh.data });
        }
        return;
      }
      const added = offer.emails.length;
      setOffer(null);
      setSeatMessage(null);
      const { sentTo, left, stop } = await sendAll(offer.emails, offer.role);
      setEmail(left.join(', '));
      setSent(sentWords(sentTo, added === 1 ? 'Seat added. ' : `${added} seats added. `));
      if (stop && stop.kind !== 'sent') setError(left.length > 1 ? `${left[0]}: ${stop.message}` : stop.message);
      router.refresh();
    } catch {
      setOfferError({ message: 'We could not reach KitStak. Check your connection and try again.', card: false });
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
  const offerCount = offer?.emails.length ?? 0;
  const planLine = invitePlanLine(
    { paid: seats.paid, limit: seats.limit, used: seats.used, canManageBilling: seats.canManageBilling, pulseOnly: seats.paid && seats.paidSelection === null && seats.limit !== null },
    role,
    countTyped(email),
  );

  return (
    <div id="invite" className="flex scroll-mt-24 flex-col gap-3">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start" data-testid="invite-form">
        <div className="flex-1">
          <Field label="Email" error={error} hint={sent ?? 'To invite several people, put a comma between the addresses.'}>
            {({ inputId, describedBy, invalid }) => (
              <Input
                ref={inputRef}
                id={inputId}
                // `multiple` lets a phone keyboard and a password manager treat this as a list of addresses.
                type="email"
                multiple
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="teammate@company.com"
                leadingIcon={<Mail aria-hidden />}
                aria-describedby={describedBy}
                invalid={invalid}
                data-testid="invite-email"
              />
            )}
          </Field>
        </div>
        <div className="w-full sm:w-36">
          <Field label="Role">
            {({ inputId }) => (
              <Select id={inputId} value={role} onChange={(event) => setRole(event.target.value as InviteRole)} aria-describedby="invite-role-line" data-testid="invite-role">
                {INVITE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {/* While the seat offer is open, its button is the one filled button. This one steps back. */}
        <Button type="submit" variant={offer ? 'secondary' : 'primary'} loading={pending === 'invite'} disabled={pending === 'seat'} className="sm:mt-[22px]" data-testid="invite-submit">
          Send invite
        </Button>
      </form>

      <div className="flex flex-col gap-0.5 text-xs text-fg-muted">
        <p id="invite-role-line" data-testid="invite-role-line">
          Admin, Member and Viewer each use 1 seat. Guest is free. Guests see only what they are added to.
        </p>
        {/* The seat offer and the seat notice below say the same thing with the price, so this line steps aside for them. */}
        {offer || seatMessage ? null : (
          <p data-testid="invite-plan-line" aria-live="polite" className="font-medium text-fg-secondary">
            {planLine}
          </p>
        )}
      </div>

      {offer && paid ? (
        <Notice
          tone="warning"
          role="status"
          testId="invite-seat-offer"
          action={
            <>
              <Button size="lg" data-testid="invite-add-seat" loading={pending === 'seat'} onClick={addSeatAndInvite}>
                {offerCount === 1 ? 'Add seat and send invite' : `Add ${offerCount} seats and send invites`}
              </Button>
              <Button variant="ghost" size="lg" disabled={pending === 'seat'} onClick={() => { setOffer(null); setSeatMessage(null); setOfferError(null); }}>
                Not now
              </Button>
            </>
          }
        >
          {seatsInUse(paid.seats)} Add {offerCount === 1 ? '1 seat' : `${offerCount} seats`} for {formatMoney(offer.preview.recurringDeltaCents)} more {period}.{' '}
          {offer.preview.dueTodayCents > 0
            ? `You pay ${formatMoney(offer.preview.dueTodayCents)} today for the days left.`
            : offer.preview.creditAppliedCents > 0
              ? `You pay ${formatMoney(0)} today. Your credit pays the ${formatMoney(offer.preview.creditAppliedCents)} for the days left.`
              : `You pay ${formatMoney(0)} today.`}
          {offerError ? (
            // The reason the seat was not added. Nothing was charged and no invite was sent.
            <span role="alert" data-testid="invite-seat-error" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-warning/25 pt-2 text-danger-text">
              <span className="min-w-0">
                {offerError.message} {offerError.card ? 'Nothing was charged and no invite was sent.' : null}
              </span>
              {offerError.card ? (
                <LinkButton
                  href="/billing?fix=payment"
                  variant="secondary"
                  size="sm"
                  data-testid="invite-update-card"
                  // The addresses wait in this tab, so "Back to your invite" on Billing finds them.
                  onClick={() => saveInviteDraft(email, role)}
                >
                  Update card
                </LinkButton>
              ) : null}
            </span>
          ) : null}
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
