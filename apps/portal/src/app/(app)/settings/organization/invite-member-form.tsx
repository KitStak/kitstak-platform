'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { formatMoney, type PlanSelection } from '@kitstak/billing/catalog';
import type { ChangePreview } from '@kitstak/billing/server';
import { Button, Field, Input, LinkButton, Notice, Select } from '@/components/ui';
import { clearInviteDraft, clearInviteWaiting, readInviteDraft, readInviteWaiting, saveInviteDraft, saveInviteWaiting } from '@/lib/invite-draft';
import { inviteMemberAction } from '@/server/auth-relay-actions';
import { confirmPlanChangeAction, previewPlanChangeAction } from '@/features/billing/actions';
import { INVITE_ROLES, ROLE_LABEL, countTyped, findOnTeam, inviteErrorWords, invitePlanLine, notInvitedYet, parseInviteEmails, seatOfferPayLine, type InviteRole, type TeamPerson } from './invite-model';

export interface InviteSeatInfo {
  /** The viewer may pay and change the plan (owner or billing manager). */
  readonly canManageBilling: boolean;
  /** The paid plan when it is priced per seat. null in a trial, with no plan, and on plans with no seat price. */
  readonly paidSelection: PlanSelection | null;
  /** A paid plan is live (with or without a seat price). */
  readonly paid: boolean;
  /** With no paid plan: a running free trial, one that ended, or no plan at all. */
  readonly unpaid?: 'trial' | 'trial_ended' | 'no_plan';
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
  team = [],
}: {
  /** Passed explicitly: portal sessions do not always carry an active organization. */
  readonly orgId: string;
  readonly emailVerified: boolean;
  readonly seats: InviteSeatInfo;
  /** The people already in the organization, so "already on your team" can use their name. */
  readonly team?: readonly TeamPerson[];
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
  /** The people a reload found still waiting for a seat. The notice names them. */
  const [restored, setRestored] = useState<readonly string[] | null>(null);
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

  // After a reload: the people who still wait for a seat are back in the field, with the reason
  // and, for a person who may pay, the price of the missing seats. Nothing is sent by itself.
  useEffect(() => {
    const waiting = readInviteWaiting(orgId);
    if (!waiting || readInviteDraft()) return;
    let live = true;
    const frame = window.requestAnimationFrame(() => {
      const waitingRole = (INVITE_ROLES as readonly string[]).includes(waiting.role) ? (waiting.role as InviteRole) : 'member';
      setEmail(waiting.emails.join(', '));
      setRole(waitingRole);
      setRestored(waiting.emails);
      const open = seats.limit === null ? waiting.emails.length : Math.max(0, seats.limit - seats.used);
      const short = waiting.emails.length - open;
      // Seats opened up since then (someone left, seats were added): nothing to buy, only to send.
      if (short <= 0) return;
      setSeatMessage(waiting.message);
      if (seats.canManageBilling && seats.paidSelection) {
        const selection = { ...seats.paidSelection, seats: seats.paidSelection.seats + short };
        void previewPlanChangeAction({ selection })
          .then((preview) => {
            if (live && preview.ok) setOffer({ emails: waiting.emails, role: waitingRole, selection, preview: preview.data });
          })
          .catch(() => undefined);
      }
    });
    return () => {
      live = false;
      window.cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, when the form opens
  }, []);

  /** Addresses whose invite email is still waiting to go out. Read by `sentWords`. */
  const slowMail = useRef<Set<string>>(new Set());

  /** Sends one invite. "All seats are in use" is an answer, not a failed request in the console. */
  const sendOne = async (to: string, as: InviteRole): Promise<SendOutcome> => {
    // A teammate: say so by name, with no request at all.
    const onTeam = findOnTeam(to, team);
    if (onTeam) return { kind: 'failed', message: inviteErrorWords({ code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION' }, to, team) };
    const result = await inviteMemberAction({ email: to, role: as, organizationId: orgId });
    if (!result.error) {
      // "Sent" is only said for an email that has left (review round 4). When the mail provider
      // was down, the invite waits for the one minute job, and the line says so.
      if (result.delivery === 'queued') slowMail.current.add(to);
      else slowMail.current.delete(to);
      return { kind: 'sent' };
    }
    if (result.error.code === 'SEAT_LIMIT_REACHED') return { kind: 'seat_limit', message: result.error.message ?? 'All your seats are in use. Add a seat first.' };
    return { kind: 'failed', message: inviteErrorWords(result.error, to, team) };
  };

  /** Keeps the people who wait for a seat for this tab, or forgets them once none is left. */
  const rememberWaiting = (left: readonly string[], as: InviteRole, stop: SendOutcome | null) => {
    if (stop?.kind === 'seat_limit' && left.length > 0) saveInviteWaiting({ orgId, emails: left, role: as, message: stop.message });
    else clearInviteWaiting();
  };

  /** "Not now": the offer closes and the people are no longer kept for a reload. */
  const dismissOffer = () => {
    setOffer(null);
    setSeatMessage(null);
    setOfferError(null);
    setRestored(null);
    clearInviteWaiting();
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

  const sentWords = (sentTo: readonly string[], lead = ''): string | null => {
    if (sentTo.length === 0) return null;
    const out = sentTo.filter((to) => !slowMail.current.has(to));
    const waiting = sentTo.filter((to) => slowMail.current.has(to));
    const parts: string[] = [];
    if (out.length > 0) parts.push(`${out.length === 1 ? 'Invite' : 'Invites'} sent to ${listOf(out)}.`);
    if (waiting.length > 0) parts.push(`The ${waiting.length === 1 ? 'invite' : 'invites'} for ${listOf(waiting)} will go out in about a minute.`);
    return `${lead}${parts.join(' ')}`;
  };

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
    setRestored(null);
    setPending('invite');
    try {
      const { sentTo, left, stop } = await sendAll(parsed.emails, role);
      rememberWaiting(left, role, stop);
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
      const added = offer.selection.seats - (seats.paidSelection?.seats ?? offer.selection.seats - offer.emails.length);
      setOffer(null);
      setSeatMessage(null);
      setRestored(null);
      const { sentTo, left, stop } = await sendAll(offer.emails, offer.role);
      rememberWaiting(left, offer.role, stop);
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
  // Seats the offer adds. After a reload some seats may have opened up, so it can be fewer than the people.
  const offerCount = offer ? Math.max(1, offer.selection.seats - (paid?.seats ?? 0)) : 0;
  const offerPeople = offer?.emails.length ?? 0;
  const restoredLine = restored ? `${notInvitedYet(restored)} ` : '';
  const planLine = invitePlanLine(
    { paid: seats.paid, limit: seats.limit, used: seats.used, canManageBilling: seats.canManageBilling, pulseOnly: seats.paid && seats.paidSelection === null && seats.limit !== null, unpaid: seats.unpaid },
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
                {offerCount === 1 ? `Add seat and send ${offerPeople === 1 ? 'invite' : 'invites'}` : `Add ${offerCount} seats and send invites`}
              </Button>
              <Button variant="ghost" size="lg" disabled={pending === 'seat'} onClick={dismissOffer} data-testid="invite-offer-dismiss">
                Not now
              </Button>
            </>
          }
        >
          {restored ? <span data-testid="invite-waiting">{restoredLine}</span> : null}
          {seatsInUse(paid.seats)} Add {offerCount === 1 ? '1 seat' : `${offerCount} seats`} for {formatMoney(offer.preview.recurringDeltaCents)} more {period}.{' '}
          {/* The amount and its real reason: the days left, less any credit (review round 4). */}
          <span data-testid="invite-seat-pay">{seatOfferPayLine(offer.preview)}</span>
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
          {restored ? <span data-testid="invite-waiting">{restoredLine}</span> : null}
          {pulseOnly || seats.canManageBilling || !paid
            ? seatMessage
            : `${seatsInUse(paid.seats)} Ask ${seats.ownerName ?? 'your organization owner'} to add one.`}
        </Notice>
      ) : restored ? (
        // Seats opened up since the reload: nothing to buy. The people are back in the field.
        <Notice
          tone="info"
          role="status"
          testId="invite-waiting-open"
          action={
            <Button variant="ghost" size="sm" onClick={dismissOffer}>
              Dismiss
            </Button>
          }
        >
          <span data-testid="invite-waiting">{restoredLine}</span>There is room for them now. Press Send invite.
        </Notice>
      ) : null}
    </div>
  );
}
