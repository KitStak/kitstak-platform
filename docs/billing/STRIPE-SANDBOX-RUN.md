# The first run against real Stripe

Date: 2026-11-24. This is the record of the first time the signup and billing flow talked to Stripe
itself, and of everything that broke and was fixed. Before this day every payment in the tests and in
the reviews used the built in test gateway or a fake Stripe client.

The short version:

- Every server side flow was run against the real Stripe sandbox, with real Stripe objects, Stripe test
  cards and Stripe test clocks. After each step the Stripe objects and our tables were checked.
- The run found **six defects** that the test gateway could not show. Three of them moved real money the
  wrong way. All six are fixed, with tests, and the fixed code was run against Stripe again.
- **Two flows could not be finished**, because the sandbox key needs a person to approve the Stripe call
  that ends a subscription at once.
- **The pages Stripe hosts were not opened.** The run was made from a container whose network lets
  `api.stripe.com` through and refuses every other Stripe host. The app makes the real sessions and
  links, and the step a person does on each page was done through the Stripe API.

## 1. Where and how

| | |
|:-|:-|
| Stripe account | "KitStak LLC sandbox", `acct_1TYwSo3PaLKIRZri`. Test mode only. Every answer was checked for `livemode: false`. |
| Live account | Never touched. Nothing in the build, the dev scripts or this suite calls it. |
| Key | Not in any file or variable. The container's network proxy adds it to requests to `api.stripe.com`. Code sends the placeholder `sk_test_proxyinjected`. |
| Catalog | 4 products (`kitstak_crm`, `kitstak_wms`, `kitstak_projects`, `kitstak_pulse`), 16 prices by lookup key, Billing Portal configuration `bpc_1UfR5Q3PaLKIRZriUCmhs1PW`, all made by `stripe:setup apply`. |
| Stripe API version | The SDK's own: `2026-11-18.endive` (stripe 23.2.0). Events are read at the account default, `2026-04-22.dahlia`. New subscriptions are in Stripe's "flexible" billing mode. |
| Webhook endpoints | None, in the sandbox or anywhere. Nothing was created, changed or disabled. The sandbox has 0 endpoints. |
| Database | The local dev Postgres. Each flow made its own organization and removed its rows when done. |

**How events reach the handler.** Stripe cannot deliver webhooks into the container. So events are read
from `GET /v1/events`, oldest first, signed the way Stripe signs them with a signing secret that only
exists on this machine, and handed to the real webhook code. The suite hands them to `processWebhook`
(the function the Portal route calls). The browser pass posted them to the Portal route itself with
`deploy/dev/stripe-events.sh`. Both ways the real handler runs on real event bodies.

**How a pay page is paid.** The app makes the real Checkout Session. The pay page (`checkout.stripe.com`)
cannot be opened, so the step a person does there is done through the API: a subscription on the
session's customer, with the session's prices, quantities, trial end and metadata, and a Stripe test
card. The one thing this leaves out is the event `checkout.session.completed`, which Stripe only makes
when the page itself is paid.

**How time moves.** Each flow has its own Stripe test clock. The runtime's clock is the test clock.

## 2. Run it again

```bash
deploy/dev/stripe-env.sh               # once
deploy/dev/stripe-sandbox-test.sh      # all 7 files, about 15 minutes
```

`DEV.md`, "Real Stripe test mode", has the details and the browser pass. The suite is in
`packages/billing/tests/stripe-sandbox/`. It is skipped by every other test command.

Last full run, 2026-11-24 22:32 UTC: **7 files, 37 tests: 33 passed, 1 failed, 3 skipped.** The one
failure was the test's own wait in the dunning flow (it waited for an event that had already come in
with the read before). The wait was fixed and that flow was run again: 2 of 2 passed. The 3 skipped
tests are the two flows that need the approval (section 6) and the check of a refused cancel, which was
run twice earlier in the day. The plain test suites after all fixes: `pnpm -F @kitstak/billing test`
614 passed, 38 skipped (the sandbox files). `pnpm -F kitstak-portal test` 279 passed. Portal browser
tests for the changed code (20 tests, test gateway): 20 passed.

## 3. What passed

"Stripe" means the objects were read back from Stripe. "Ours" means `core.billing_subscriptions`,
`core.entitlements`, `core.billing_invoices`, `core.billing_emails` and the activity log were read back.
The ids are from the last run and are still in the sandbox.

| Flow | Result | What was checked | Stripe objects |
|:-|:-|:-|:-|
| Trial with no card | **Passed** | Ours: one `trialing` row per app, source `trial`, ends in exactly 14 days, welcome email. Stripe: no customer exists for the organization. | none, by design |
| Card added during the trial | **Passed** | The app's real Checkout Session: test mode, our organization, promo codes on, our return address. Stripe: subscription `trialing`, trial ends on the same second as our trial. Ours: plan row with Visa 4242 and Stripe's own number for the first bill, access rows now from Stripe, the $0.00 trial invoice stored and not shown as a bill, "plan started" email with $0.00 due today. | `cs_test_b027wQbEgtOmhNscpBJJgH00QQmjWwGl41LEZb6ZJAGTlcdE1k5n4VKcNz`, `sub_1UfSU63PaLKIRZri3bBPegtH`, `cus_VgqAMDLH7a4sG2` |
| First charge when the trial ends | **Passed** | Test clock moved past the trial end. Stripe: active, invoice paid $58.00. Ours: active, new period end on the access row, invoice with number and card, one receipt, phase `active`. | `in_1UfSUN3PaLKIRZrixFRhZNs2` |
| First payment with no trial, pay page open | **Passed** | Stripe: `incomplete`. Ours: no access row, no email, phase `none`. | `sub_1UfSUg3PaLKIRZriucNoebnU`, `pi_3UfSUg3PaLKIRZri14MAh82r` |
| Declined card (`pm_card_chargeDeclined`) | **Passed** | Stripe refused with `card_declined`. Ours: nothing granted, no "payment is late" email. | same |
| 3D Secure required (`pm_card_authenticationRequired`) | **Passed** as far as it can go | Stripe: `requires_action`, `invoice.payment_action_required` sent. Ours: nothing granted, no bank approval email (defect 1). The bank step itself needs `hooks.stripe.com`: not run. | same |
| Good card after that | **Passed** | Stripe: active, invoice paid $87.00. Ours: active, 3 seats, access row, invoice in the list, "plan started" and one receipt, exactly one payment line. | `in_1UfSUg3PaLKIRZriOSnWmezm` |
| Add seats (2 to 5), 10 days into the month | **Passed** | Preview $58.00 for the 20 days left. Stripe charged $58.00. Ours: 5 seats, invoice with prorated lines, receipt, activity line with the amount. | `in_1UfSOR3PaLKIRZriNv9jY8qY` |
| Remove seats (5 to 3) | **Passed** after defect 2 | Preview: $38.67 credit, nothing to pay. Stripe: an invoice of minus $38.67, customer balance minus $38.67, no invoice line left waiting. Ours: credit $38.67, next charge $48.33. No receipt. | `in_1UfSOf3PaLKIRZriMidD1Wha` |
| Bundle discount on (add WMS, 2 warehouses) | **Passed** after defect 2 | Stripe: both items on bundle prices ($23.20 and $279.20, 20% off). Invoice $360.67, $38.67 paid from credit, **card charged $322.00, the amount confirmed**. Ours: both apps active. | `in_1UfSOt3PaLKIRZriiwq7qWw5` |
| Warehouses up (2 to 3) and down (3 to 1) | **Passed** | Up: charged the preview. Down: credit on the balance at once. | `in_1UfSP93PaLKIRZriiON0UMcu` |
| Bundle discount off (remove WMS) | **Passed** | Stripe: CRM back on $29.00, WMS item gone. Ours: WMS row `canceled` (view only), CRM active. | `sub_1UfSO63PaLKIRZriYbC9zCYq` |
| Monthly to yearly | **Passed** after defect 3 | Stripe: a new year from today, 365 days, invoice $829.40 ($887.40 for the year less $58.00 for the 20 days left of the month), $546.80 paid from credit, card charged $282.60, the amount confirmed. Ours: yearly, period dates as Stripe has them, next charge $887.40. The sentence shown: "$887.40 for the next year. Less $58.00 for the 20 full days left on your monthly plan. Less $546.80 from your credit." | `in_1UfSPo3PaLKIRZrilly5E6oi` |
| Invoice list and PDF links | **Passed** as far as it can go | Our list equals Stripe's list for all 8 invoices (number, status, total, paid). For each, `getInvoicePdf` answers a redirect to Stripe's PDF on `pay.stripe.com`. An invoice of another organization is refused. Opening the PDF needs `pay.stripe.com`: not run. | customer `cus_Vgq4IWgxoeL9ju` |
| Pause set, then taken back | **Passed** | Stripe: `pause_collection` set, then cleared. Ours: dates, "paused" email, full access until the month ends. | `sub_1UfSQC3PaLKIRZriwmSoM3ID` |
| Paid month ends while paused | **Passed** | Stripe: the invoice of the new month is void, no charge was tried. Ours: view only, phase `paused`, no "payment failed" email. | `in_1UfSQg3PaLKIRZriNnXG7cXC` |
| "Start again now" with a failing card | **Passed** after defect 4 | Answer `card_declined`. Stripe: still paused, no open invoice, nothing waiting. Ours: still paused. | same |
| "Start again now" with a good card | **Passed** after defect 4 | Stripe: one invoice of $58.00, paid, for one month from today. Pause lifted, new period from today, the next renewal bills one month and no more. Ours: active, receipt. | `in_1UfSRH3PaLKIRZrilbAKmlKk` (number `L7CAGI2Z-0004`) |
| A pause that runs its full time | **Passed** | Stripe: collection starts again by itself and the next renewal is charged ($29.00). Ours: active again, "plan resumed" line, receipt. | `sub_1UfSRY3PaLKIRZriYESmSOxB`, `in_1UfSS03PaLKIRZrijuCqNWsA` |
| Cancel at period end, then "Keep my plan" | **Passed** | Stripe: set to end, then not. Ours: no next charge while it is set to end, the email names the end day, full access. | `sub_1UfSTF3PaLKIRZriUumIOCXp` |
| The paid period runs out after a cancel | **Passed** | Stripe: `canceled`, ended exactly at the period end, no new invoice. Ours: ended, both apps view only, one "plan ended" email. | same |
| A renewal fails | **Passed** | Card `pm_card_chargeCustomerFail`. Stripe: `past_due`, invoice open, next try in 2 days. Ours: late, full access, the email with amount, card 0341, retry date and the access date 7 days on. | `sub_1UfSW23PaLKIRZria4NVnuHu`, `in_1UfSWN3PaLKIRZriP5tcGqVh` |
| All of Stripe's retries, then Stripe gives up | **Passed** | 9 tries in 15 days (about one every 2 days). Then Stripe canceled the subscription. Ours: ended, reason "could not collect", $58.00, 9 tries, one "plan ended" email, view only. One email and one activity line per failed try, never two for the same try (see section 5, note 4). | same |
| "Pay now" with the same bad card | **Passed** | Answer `card_declined`. Still late. | `sub_1UfSLa3PaLKIRZriETjzy4JI` |
| Card update link | **Passed** as far as it can go | The app's link is a real Billing Portal session: our customer, our configuration, the "update payment method" flow, back to billing home. Opening it needs `billing.stripe.com`: not run. | `bps_1UfSMO3PaLKIRZritui1XzfM` |
| A card saved the way the Billing Portal saves it | **Passed** | A Mastercard attached and made the customer's default through the API. The adapter moved it onto the subscription. Ours: "Mastercard ending 4444", one activity line. | same |
| "Pay now" with the new card | **Passed** | Stripe: invoice paid $58.00, active. Ours: active, the late fields cleared, one receipt with card 4444. | `in_1UfSLw3PaLKIRZrikPG1Xyqk` |
| A renewal the bank wants approved | **Passed** after defect 5 | Card `pm_card_authenticationRequired`. Stripe: `past_due`. Ours: the bank approval email, once. "Pay now" answers `payment_needs_approval` with Stripe's own page for that invoice (`invoice.stripe.com`). Nothing charged. Another card and "Pay now" clears it. Approving on Stripe's page needs `invoice.stripe.com`: not run. | `sub_1UfSMr3PaLKIRZri7a2b6sYZ`, `in_1UfSNE3PaLKIRZriXM5rJXzU` |
| Every event twice, then a third time newest first | **Passed** | 23 real events. Every repeat answers `duplicate`. All six tables are equal, row for row, before and after. One ledger row per event. | `cus_Vgq8Olha9dVGQL` |
| A bad signature | **Passed** | Wrong secret, an hour old timestamp, no signature: 400, nothing written. | |
| Events newest first (out of order) | **Passed** | 25 real events of a purchase, a seat change, a new card and a cancel that only happened at Stripe, delivered in reverse. No failure. Ours ends in exactly the state Stripe has (5 seats, Mastercard, set to end). One "plan started", two receipts, no line twice. Then the same events in order: all duplicates. | `sub_1UfSSs3PaLKIRZriZ1PO0Sve` |
| Cancel with a bill open | **Not run** | Stripe refused the call with "This action requires human approval". The refusal was checked: nothing changed anywhere (section 6). | `sub_1UfRz63PaLKIRZriByObPatm`, `in_1UfRzU3PaLKIRZriABV8RaB2` |
| A second payment is canceled and refunded | **Not run** | Needs the same Stripe call. | |

## 4. What broke, and the fix

### Defect 1. A "your bank needs you to approve" email for a payment that is on the pay page

**What happened.** A first payment with a 3D Secure card makes Stripe send `invoice.payment_action_required`
while the person is still on the pay page, with the bank step in front of them. The handler queued the
email "Your bank needs you to approve a KitStak payment" every time it saw that event. The plan had not
started, so the button in the email led to a Billing page with nothing to approve. The same email also
went out when the event arrived after the bill was already paid.

**Fix.** `packages/billing/src/server/webhook.ts`: the handler reads the subscription and the invoice from
the gateway first. The email goes out only for an invoice that is still open on a plan that is running.

**Tests.** `stripe-sandbox-fixes.test.ts` (three cases), sandbox flows 2 and 6.

### Defect 2. After seats came off, the next change charged more than the person confirmed

**What happened.** A decrease was sent to Stripe with `create_prorations`. Stripe then keeps the credit
as invoice lines that wait for the next renewal. Stripe's preview of a later change lists those waiting
lines, so the confirm panel took the credit off. But the invoice that a change makes holds only the lines
of that change. Real numbers from the first run (customer `cus_VgozCGn0KqLnVz`):

| Change | The panel said | Stripe charged | Difference |
|:-|:-|:-|:-|
| Add WMS after removing 2 seats | $322.00 | $360.67 | $38.67 too much |
| Add a warehouse | $147.46 | $186.13 | $38.67 too much |
| Monthly to yearly | $219.62 | $805.09 | $585.47 too much |

The credit was not lost. It would have come off the next renewal, which after a switch to yearly is a
year away.

**Fix.** `packages/billing/src/gateway/stripe.ts`, two parts.

1. Every change that prorates anything is invoiced at once (`always_invoice`). For a decrease Stripe makes
   an invoice with a total below zero and puts the amount on the customer's credit balance in the same
   call. Stripe takes that balance off every later invoice, and its preview does the same. Nothing is left
   waiting.
2. `changeFromPreview` leaves out invoice lines that waited before the change (asked for with
   `invoiceItems.list`) and works the amounts out again from the lines that remain. So the amount is right
   even for a customer who has old waiting lines, or one a person added in the Stripe dashboard. If Stripe
   cannot say which lines wait, the preview fails and no amount is shown.

`moneyOfChange` in `server/changes.ts` reads the credit from the new invoice, so the activity line still
says "$38.67 credit was added".

**Tests.** `stripe.test.ts` (the preview cases use the line shapes and amounts Stripe answered),
sandbox flow 3. After the fix the same three steps charge $322.00, $186.13 and $282.60, each equal to the
panel to the cent. (The credit of $38.67 now pays part of the first step, so nothing is left of it for the
second. The third is a full new year, see defect 3.) After every change the suite checks that Stripe has
no waiting line.

### Defect 3. Monthly to yearly did not start a new year

**What happened.** The screens, the emails, the test gateway and `SPEC.md` all say: a change of billing
period starts a new period today, billed in full, and the unused part of the old one comes off. Stripe's
"flexible" billing mode, which new subscriptions get, keeps the old renewal day when the price interval
changes. A switch to yearly on day 10 was billed as "the rest of a year that began 10 days ago" (355 of
365 days), the next charge was 10 days earlier than the panel said, and the sentence under the amount
would have read "$0.00 for the next year. Plus $863.09 for the change."

**Fix.** `stripe.ts`: for a change of billing period on a paid plan, the preview and the update send
`billing_cycle_anchor: now`. Stripe then starts the new period today and bills it in full. Stripe takes
no proration date together with that, so the unused time is counted from the moment of the call. Three
things keep the amount honest:

- `applyChange` previews once more right before the update and compares with the amount the person
  confirmed (`expectedDueTodayCents`, new in the gateway contract, version 5). If it moved, nothing is
  charged and the panel shows the new amount (`price_changed`).
- After the update, `refundAnyExcess` sends back with a credit note whatever the invoice asked above the
  confirmed amount. That can only be a cent or two, in the second between the preview and the charge.
  Stripe accepts a one cent refund (credit note `cn_1UfSQ13PaLKIRZriVIIfV0r5`).
- The words "for the 20 full days left" are only used when the gateway priced from the whole day date.
  Otherwise the sentence says "for the time left".

Inside a free trial nothing restarts: the first charge stays on the day the trial ends.

**Tests.** `stripe.test.ts` (six cases), `stripe-sandbox-fixes.test.ts`, sandbox flow 3.

### Defect 4. "Start again now" in a pause gave the month away

**What happened.** In the middle of a pause, "Start again now" asked Stripe for a new period with no
proration. In flexible mode Stripe then starts the period and makes **no invoice at all**. The plan was
active again, with full access, and nothing was charged until the month after. Asking Stripe to invoice
did not help: while collection is paused Stripe still makes each period's invoice and drops it, and from
then on it counts that period as billed. It charged 16 cents for a month of $58.00.

**Fix.** `stripe.ts`, `billRestart`: the invoice for the new period is made by the adapter, from the
subscription's own prices and quantities, bound to one draft, finalized and paid. Only when it is paid is
the pause lifted. A card that cannot be charged gets a plain "card declined", the invoice is voided and
the plan stays paused. The invoice carries a mark, so a second try after a failure between the two steps
does not bill again. A promo code on the plan and Stripe Tax (when on) are passed along.

**Tests.** `stripe.test.ts` (seven cases), `stripe-sandbox-fixes.test.ts`, sandbox flow 4.

### Defect 5. "Pay now" could not do the bank step, and said "Something went wrong on our side"

**What happened.** When a renewal needs 3D Secure, the email says "Open Billing and choose Pay now. Your
bank will ask you to confirm." On real Stripe, "Pay now" asks Stripe to pay the invoice from the server,
Stripe answers that the bank step is needed, and the person saw the message for an outage. There was no
way to approve the payment.

**Fix.** `stripe.ts`, `server/payment.ts`, `apps/portal/src/features/billing/home/home-actions.tsx`: the
adapter reads Stripe's own page for that invoice (the hosted invoice page, where the bank step works).
"Pay now" answers `payment_needs_approval` with that link and the button sends the browser there. Only an
https address on `stripe.com` is ever handed out. With no link the answer is "That card was declined. Try
another card or call your bank."

**Tests.** `stripe-sandbox-fixes.test.ts`, sandbox flow 6. Approving on Stripe's page was not run (section 6).

### Defect 6. A credit invoice read "Paid with the card ending 4242"

**What happened.** This came with the fix for defect 2: a decrease now makes an invoice with a total below
zero. The invoice list showed it as "Paid", and its page said "Paid $0.00" and "Paid on Nov 24, 2026 with
the card ending 4242." No card was charged.

**Fix.** `apps/portal/src/features/billing/invoices/invoice-words.ts` and the invoice page: the label is
"Credit", the row reads "Added to your credit $28.03", and the sentence is "This is a credit of $28.03 for
a plan change. Nothing was charged. It comes off your next bills."

**Tests.** `billing-words.test.ts`, and the browser pass below (desktop and phone, no sideways scroll).

## 5. What Stripe does that is good to know

1. **Billing mode.** New subscriptions are in "flexible" mode. It differs from what Stripe did for years in
   exactly the three places of defects 2, 3 and 4. Nothing has to be set in the dashboard.
2. **A proration date up to one day ahead is accepted.** The server prorates a credit from full days only,
   which can be a date up to a day ahead. Stripe took it ("Unused time ... after 25 Nov 2026" on Nov 24).
   The fallback to the start of the hour was never needed.
3. **Retries in the sandbox.** A failed renewal is tried again about every 2 days, 9 tries in 15 days. Then
   the subscription is canceled and the invoice is **left open**. Our screens say the plan ended and why,
   but the invoice list still shows that bill as "Due". `GO-LIVE.md` step 2 asks for "marked uncollectible"
   in the live account.
4. **One email per failed try, when events are on time.** The handler reads the invoice as it is now, and
   writes one line and one email per try number. With test clocks, Stripe sometimes made the event of try 4
   only after try 5 had run. That event then counted as try 5, so no email said "try 4". In real life tries
   are 2 days apart and events arrive in seconds.
5. **Event order is not promised.** `invoice.paid` arrived before `customer.subscription.created` in every
   purchase. The handler does not care, because it reads the current object each time.
6. **A renewal invoice is charged about an hour after it is made.** The suite moves the clock 2 hours past
   each renewal.
7. **This key needs approval to end a subscription.** See section 6.

## 6. What could not be run, and exactly why

### Hosts the container refuses

The container's proxy answers `CONNECT` with HTTP 403 for every Stripe host but `api.stripe.com`. Chromium
shows `net::ERR_TUNNEL_CONNECTION_FAILED`. Checked on 2026-11-24:

| Host | Needed for | What was done instead |
|:-|:-|:-|
| `checkout.stripe.com`, `js.stripe.com` | The hosted pay page: typing a card, the decline message, the bank step, a promo code, wallets, two tabs | The Portal made the real session and sent the browser to it (refused there). The pay step was done through the API. |
| `billing.stripe.com` | The Billing Portal: saving a new card | The Portal made the real session. The card was attached and made the default through the API. |
| `pay.stripe.com` | Downloading an invoice PDF | The Portal answers 307 to the right address. Not downloaded. |
| `invoice.stripe.com` | Approving a payment on the hosted invoice page | "Pay now" answers with the right address. Not opened. |
| `hooks.stripe.com` | The 3D Secure bank step | A card that needs it stays at `requires_action`. Approve and fail were not run. |

This is the container, not the product. `GO-LIVE.md`, Open item 1, lists the 30 minute pass a person does
on a normal machine.

### The Stripe call that ends a subscription at once

`DELETE /v1/subscriptions/:id` was answered with: "This action requires human approval before it can be
completed. An approval request has been created and is awaiting review. If approved, it will
automatically execute." The key (or the account) puts that call behind a person. So two flows stopped:

- **Cancel with a bill open.** The app left a note on the plan, asked Stripe, was refused, took the note
  off again and answered "Something went wrong on our side. Nothing was charged." Checked after the
  refusal: Stripe still `past_due` with the invoice open, our plan row `past_due` with no ended reason,
  access unchanged, no "plan ended" email, no activity line. That is the safe outcome. The flow itself is
  proven on the test gateway (`round3-cancel.test.ts`, `cancel-late.spec.ts`) and not on Stripe.
- **A second payment for one organization** (cancel and refund). Not tried, so no further approval
  request was made. The refund call (`creditNotes.create` with a refund) was run for one cent.

Two approval requests are waiting in the sandbox from the two tries:

| Stripe request | Approval request | Test subscription it would cancel |
|:-|:-|:-|
| `req_KeWSZlOz3ru7eL` | `apreq_test_61Vopo8I9N9BEY6h616UiKQACNSQJtRbQmwKcNA2yBdI` | `sub_1UfRqH3PaLKIRZriRQ7NdUcb` (customer `cus_VgpVUNrRWXco6S`) |
| `req_W5ntGITjRbx5KA` | `apreq_test_61Vopx86AzC02xitV16UiKQACNSQJtRbQmwKcNA2y9sG` | `sub_1UfRz63PaLKIRZriByObPatm` (customer `cus_Vgpe3RB9BbKstp`) |

Approving them cancels those two test subscriptions and nothing else. Declining them is fine too.

To run the two flows: use a sandbox key that may end a subscription with no approval step, take the line
`STRIPE_SANDBOX_CANCEL_NEEDS_APPROVAL=1` out of `deploy/dev/.run/stripe.env`, and run
`deploy/dev/stripe-sandbox-test.sh 06-failed 07-webhook`.

### Not covered by this run

- `checkout.session.completed`. Stripe only makes it when the pay page is paid. Its handler is proven with
  the test gateway only.
- A promo code and Stripe Tax on real Stripe. None was made in the sandbox.
- Stripe's own customer emails. Not looked at.
- The Billing Portal page and Stripe's pay page showing our prices and our sentences.
- A live key. By rule.

## 7. The browser pass, Portal in real Stripe mode

The shared Portal was switched to real Stripe mode for about 6 minutes (22:25 to 22:31 UTC) and then
switched back to the test gateway. Driven with Playwright as the seeded owner, in a new organization made
for this pass and removed afterwards. Screenshots: `deploy/dev/.run/stripe-sandbox/ui/` (untracked).

| Step | Result |
|:-|:-|
| Billing home with no plan, light and dark | 200, "Test mode. No real money moves." banner and badge, no console error. |
| Start a trial from the plan picker | "Free trial", `?notice=trial_started`. |
| Review and pay | "Due today $0.00", first charge "$58.00 on Dec 8, 2026", tax note shown. |
| Press pay | The server made session `cs_test_b0cqdAp2qsG7NMnzlgi3GfB8i15raZqZ9buuUcKvcYQ9zO757KMX2tlKRE` and the browser was sent to `https://checkout.stripe.com/g/pay/...`. **Refused by the container** (`net::ERR_TUNNEL_CONNECTION_FAILED`). |
| Pay step through the API, then `deploy/dev/stripe-events.sh since 5` | The Portal route answered 200 for every event: `processed` for this customer (`cus_Vgpq59SSa4EGFl`, `sub_1UfSBX3PaLKIRZrigIRzNqxs`), `ignored` for events of customers this database does not know. |
| Billing home after that | "CRM, 2 seats, Monthly. Free trial. Your first payment is on Dec 8, 2026." "Visa ending 4242, expires 11/27." |
| "Update card" | The server made a Billing Portal session and the browser was sent to `https://billing.stripe.com/p/session/flow...`. **Refused by the container.** |
| First charge (trial ended at Stripe), events forwarded | Plan active, invoice `ZGYHVVNC-0002` $58.00 in the list and on its page, receipt in the dev outbox. |
| "Download PDF" | The route answers 307 to `pay.stripe.com/invoice/acct_1TYwSo3PaLKIRZri/.../pdf`. Not downloaded (host refused). |
| Add 1 seat on the plan page | Panel: "Due today $29.00. $87.00 for the 30 days left in this period at your new prices. Less $58.00 for the same days at your old prices." Stripe charged $29.00 (`ZGYHVVNC-0003`). Billing home: 3 seats. |
| Remove 1 seat | Panel: "You get $28.03 credit on your next bill." Stripe made credit invoice `ZGYHVVNC-0004`. Billing home: "Next charge $29.97, after $28.03 credit." Invoice list: "-$28.03, Credit" (defect 6 found and fixed here). |
| Every event of the last 6 minutes again, newest first, each twice | 82 deliveries, all `duplicate`. Event, activity, email and invoice counts and the plan row unchanged. |
| A forged signature at the route | 400 `bad_signature`, nothing written. |
| The billing job (`deploy/dev/billing-tick.sh`) in Stripe mode | `ok`, 4 emails sent to the dev outbox, no error. |

The subscription of this pass is set to end by itself on Dec 24, 2026 (an update, not the call that needs
approval).

## 8. What is left in the sandbox

- 38 test clocks named "kitstak sandbox ...", each with one customer and its plan (one is "pause probe",
  made by hand to see how Stripe bills a restart). They cost nothing
  and can be looked at in the dashboard. To remove the ones a run makes: `STRIPE_SANDBOX_CLEANUP=1
  deploy/dev/stripe-sandbox-test.sh`. To remove the old ones, delete the test clocks in the dashboard
  (Billing, Test clocks). Each delete takes its customer and plan with it.
- One customer with no clock, from the browser pass (`cus_Vgpq59SSa4EGFl`). Its plan ends Dec 24, 2026.
- Two approval requests (section 6).
- No webhook endpoint, no coupon, no promo code. The 4 products, 16 prices and the portal configuration
  are unchanged.

## 9. What changed in the repo

| File | Change |
|:-|:-|
| `packages/billing/src/gateway/stripe.ts` | Defects 2, 3, 4, 5: `changeFromPreview`, a decrease invoiced at once, a new period for a change of billing period with the amount guard and `refundAnyExcess`, `billRestart`, the bank approval link. |
| `packages/billing/src/gateway/types.ts` | Contract version 5. `expectedDueTodayCents`, `GatewayAmountChangedError`, `GatewayCardError.approveUrl`. |
| `packages/billing/src/server/webhook.ts` | Defect 1. |
| `packages/billing/src/server/changes.ts`, `cancel.ts`, `payment.ts`, `packages/billing/src/errors.ts` | The confirmed amount passed down, `price_changed` when it moved, the day count only when true, credit read from the credit invoice, `card_declined` for a refused restart, `payment_needs_approval` with `actionUrl`. |
| `apps/portal/src/features/billing/home/home-actions.tsx`, `invoices/invoice-words.ts`, `app/(app)/billing/invoices/[invoiceId]/page.tsx` | "Pay now" opens Stripe's page when the bank wants approval. A credit invoice reads as a credit. |
| `packages/billing/scripts/stripe-events.ts`, `stripe-events-lib.ts` | The dev tool that forwards real events to the local Portal. |
| `deploy/dev/stripe-env.sh`, `stripe-events.sh`, `stripe-sandbox-test.sh`, `app-start.sh`, `status.sh`, `lib.sh` | The real Stripe switch (`KITSTAK_STRIPE=1`), the mode shown by `status.sh`, the three Stripe scripts. |
| `packages/billing/tests/stripe-sandbox/` | The opt in suite: a harness and 7 flow files. |
| `packages/billing/src/gateway/stripe.test.ts`, `src/server/stripe-sandbox-fixes.test.ts`, `tests/stripe-events.test.ts`, `apps/portal/src/features/billing/billing-words.test.ts` | Tests for every fix and for the tool. They run in every normal test pass, with no Stripe. |
| `docs/billing/DEV.md`, `GO-LIVE.md`, `TESTING.md`, `CONTRACTS.md` (section 24), `SPEC.md` (12.6) | How to run it, what is proven, what stays open. |
