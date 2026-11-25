# Security and billing correctness review, round 4

Reviewed at commit `61081d9` on branch `mike/amazing-bell-llk3rq`. Verdict: not a pass. Three backend
blockers, each reproduced on the running dev portal (port 3300) with throwaway accounts that were removed
afterwards. The round 3 blocker is fixed.

The probe scripts are in `docs/billing/.review/sec4/` (ignored by git). Run one with
`node docs/billing/.review/sec4/<name>.mjs`. Each needs the dev portal and the dev database, and cleans up
after itself.

## Round 3 blocker, rechecked: fixed

`billing-role.mjs`. As a plain admin, at the Portal and at the CRM: giving the billing role to yourself
(four spellings of the role and a trailing slash on the path), inviting an outsider with the billing role,
taking the role from a bookkeeper, removing the bookkeeper by id and by email, and canceling the owner's
open billing invite all answer 403 `BILLING_ROLE_OWNER_ONLY`, and the database is unchanged. The owner can
still invite a bookkeeper.

## Blocker 1. "Email me a code instead" works once, then locks the person out

Probe: `lockout.mjs`. Real output:

```
1. sign up with a password, email code skipped: 200 accounts: [{"provider_id":"credential","has_password":true}]
2. first sign in by code worked. landed on /signup/company
   user: {"email_verified":true} accounts now: []
3. second time, the screen says: "If ... has a KitStak account, a code is on its way. It works for 10 minutes."
   a second sign in code was mailed: NO (nothing in core.billing_emails after 15 seconds)
4. sign in with the password chosen at signup: 401 Invalid email or password
```

Why: Better Auth 1.7.21 protects an account whose email was never proven. When such an account signs in
with a code, `revokeUnprovenAccountAccess` deletes every row in `core.account` (the password) and every
session, then marks the email verified. That part is right. But `maySignInWithCode` in
`apps/portal/src/server/auth.ts` only mails a code to a person who still has a credential row with a
password. After the first code sign in that row is gone, so no second code is ever mailed, while the
screen still says one is on its way. The password is gone too, and nothing told the person.

Who it hits: every account that skipped the email code ("I will do this later"), every "no password"
signup that skipped it, and every older account that was never asked to verify. "Forgot password" is the
only way back in, and the screen does not say so.

Great looks like: a person who signed in by code can always do it again. The second and the tenth code
arrive. If the old password is removed, the person is told in one plain sentence and offered "Set a
password". A browser test signs in by code twice in a row for an account that never verified, and for a
"no password" signup.

## Blocker 2. A person who was switched off can switch themselves back on with "Forgot password"

Probe: `deactivated-reset.mjs`. Real output:

```
2. switched off (credential row deleted). sign in with the old password: 401
3. the switched off person asks for a reset code: 200
   a reset code was mailed: yes
4. reset with the code: 200 {"success":true}
   credential rows now: [{"provider_id":"credential"}]
5. sign in with the new password: 200
```

Why: `docs/security/auth-review-2026-11-11.md` H3 is binding. A person is switched off by deleting their
credential row in `core.account` (WMS `setUsersActive`, and `migrate-wms-identity.ts` for inactive
users), because their `core.member` row stays. The comment on `maySignInWithCode` knows this rule. The
reset by code path does not: `requestPasswordResetAction`, `resetPasswordAction` and the raw
`/api/auth/email-otp/request-password-reset` and `/api/auth/email-otp/reset-password` endpoints mail a
code to any address with a user row, and Better Auth's `resetCredentialPassword` makes a new credential
row when none exists. `origin/main` had no self service reset at all, so this door is new on this branch.
By reading the code, Google and Microsoft sign in open the same door (the provider links to the user row
by email); that part was not run because no client keys are set.

Great looks like: being switched off is a fact the shared auth layer can read (a flag or a table in
`core`, checked in `createAuth` on every instance), not "has no password row". No reset code, no sign in
code and no social sign in works for a switched off person, at the server actions and at the raw
endpoints. This also untangles blocker 1, because "has no password row" then stops meaning two different
things. Tests: one unit test per door, and one browser test that a switched off person gets no code and
cannot reset.

## Blocker 3. An admin can take an owner's open billing invite and become a billing manager

Probe: `invite-takeover-admin.mjs`. Real output:

```
1. owner invites a bookkeeper with the billing role: 200
2. an ADMIN lists the open invites: 200 sees id ae71e25e... role billing
   the same through get-full-organization: 200 sees id ae71e25e...
3. the member signs up with the invited address: 200
4. and accepts the invite: 200
   roles in the organization now: [owner ... , admin ..., {"email":"...-bookkeeper@...","role":"billing","email_verified":false}]
5. /billing/team as that account: 200 page lists "Not The Bookkeeper"
```

Why: accepting an invite asks for the invitation id and a signed in account with the invited address. It
does not ask for proof of the mailbox: signup needs none, and `requireEmailVerificationOnInvitation` is
off. Admins can read the ids of open invites (`/api/auth/organization/list-invitations` and
`get-full-organization`). So when an owner invites a bookkeeper who has no KitStak account yet, any admin
can make that account and accept. The Portal's own `/invite/<id>` page and `joinInviteAction` do it in one
step. The admin then holds a billing manager account and can cancel or pause the plan, change billing
details and open the card page. SPEC P15 says only an owner can add a billing manager, and that admins
cannot pay, change or cancel. A plain member cannot do this (their list call answers 403), and Better
Auth hides owner invites from admins, so the hole is the billing role.

Great looks like: an invite that gives the billing role can only be accepted by a person who proved the
mailbox: the proof from the emailed link, or a verified email. The rule sits in
`billingOrganizationOptions` (`beforeAcceptInvitation`), so it holds at every app. Better still, turn on
verified email for every invite accept, since the Portal already marks the email verified when the link's
proof checks out. Tests: an admin who signs up with the invited address is refused at the raw endpoint and
in `joinInviteAction`; the real invited person with the emailed link still joins with no code.

## Checked and sound this round

- Webhooks: signature on the raw body first, ledger row and state change in one transaction, state read
  fresh from the gateway. Unsigned test webhook on dev answers 400.
- Production with no keys (port 3310): `/test-gateway/...` 404, `/dev/outbox` 404, test webhook 404,
  Stripe webhook 503, job tick 503. No test gateway in production.
- No price or amount from the browser. Catalog cents checked by hand (yearly and bundle amounts are whole
  cents). Plan change still needs the basis and the exact amount.
- Invoices, PDFs and the activity export are scoped to the session's organization.
- Redirect helpers take same origin paths only. The proxy overwrites the return header.
- Pre account hijack by code sign in is closed by Better Auth (probe `prehijack.mjs`: the first person's
  password stops working and their sessions are deleted). A plain member cannot list invites.
- Migrations 0007 to 0010 are additive and safe to run again.
- `packages/billing`: 29 files, 537 tests pass with the database up. No key shaped string in the tree.

## Not blockers, worth fixing

1. Real Stripe is still unrun. This stays the largest open risk.
2. Anyone can use up another address's code budget. The 5 per 10 minutes and 20 per day send limits count
   anonymous requests for any address, and one budget covers verify, reset and sign in codes. Twenty
   requests a day keep a chosen person from resetting a password, signing in by code or verifying.
3. About 100 guesses a day per address on a 6 digit code (20 codes, 5 tries each). Consider a longer code
   or a lock after several used up codes.
4. Outside Vercel, a single made up `x-forwarded-for` value gives a caller their own rate limit bucket
   (I used this to keep my probes out of the shared sign up counter). Set `TRUST_PROXY` on any other host.
5. Database tests still skip silently when Postgres is not reachable.
6. Cancel, pause and undo write the plan row without the organization lock that webhooks take.
7. A first payment that Stripe leaves `incomplete` and then expires would be stored as an ended plan and
   could mail "Your plan has ended" for a plan that never started. Check against real Stripe.
8. With WMS and Pulse and no per user app, the Pulse limit of 5 seats caps the whole organization.
