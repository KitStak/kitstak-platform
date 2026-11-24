# Signup and billing: product and build spec

This is what we are building: one signup, one free trial, one bill, for every KitStak app. Read
`DECISIONS.md` first (owner decisions, binding). `CONTRACTS.md` holds the exact names, types, routes, tables
and who owns which files. `research/COMPETITORS.md` is the bar we are scored against.
`research/CODEMAP.md` is the map of the code as it was before this work. `DEV.md` is how to run it.

## 0. Rules for every screen and every word

1. **Copy.** Plain words. Short sentences, 20 words at most. An 8th grader must understand every screen. No
   em dash and no double dash, in UI copy, emails or docs. No raw emoji in headings. No lorem ipsum. No
   "coming soon". Every number on screen is real and comes from the catalog or the gateway.
2. **Theme.** Only `@kitstak/ui` tokens and the portal's existing components. Light and dark both. No hard
   coded colors. Text contrast 4.5 to 1 or better.
3. **One price.** Every amount comes from `@kitstak/billing` (`quote`) or from the gateway. No screen does its
   own math.
4. **Never invent success.** A screen says "paid" only when the gateway said so. A decline never gives access.
5. **No dead ends.** Every state has a next step that works: a button, a link, or a plain sentence that says
   who can help.
6. **Nothing is ever deleted** by a trial ending, a failed payment, a pause or a cancel.

Words we use on screen (use these, not the code words):

| On screen | Means | Code word |
|:-|:-|:-|
| app | CRM, WMS, Projects or Pulse | product, module |
| plan | the apps you pay for, with how many seats and warehouses | subscription |
| free trial | 14 days with full access and no card | trial |
| seat | one person on your team who can sign in | seats |
| warehouse | one building in the WMS | warehouses |
| monthly, yearly | how often you pay | interval |
| bundle discount | 20% off every app when you have 2 or more | bundle |
| view only | you can open and read everything, but not change it | read_only |
| not in your plan | an app you have not added | locked |
| payment due | a payment failed and we are trying again | past_due |
| billing manager | a person who can pay and change the plan | billing manager |
| Test mode | no real money moves | stripe_test, test_gateway |

Dates read "Dec 7, 2026". Money reads "$395.20". List prices with no cents may read "$29".

## 1. The bar

`research/COMPETITORS.md` section 5 ranks 30 must haves and section 6 gives the critic scorecard (15 lines,
0 to 2 each; ready at 24 of 30 with no zero). Section 16 of this spec maps every must have to where it is
built and how it is tested. The short version of how we win:

- **Faster in:** 4 fields, then one click on a prefilled picker, then you are in. No card, no phone, no wall.
- **Clearer money:** the math is written out in words, discounts are their own dollar lines, and the same
  total shows on the marketing site, the picker, checkout and the invoice, to the cent.
- **Fairer changes:** one rule for every change. Start now, pay only for the days left, get credit for what
  you give back. You always see the amount before you say yes.
- **Easier out:** cancel in two clicks, keep access to the end, undo in one click, or pause for 1 to 3 months.
- **One suite:** one account, one trial, one invoice, and the same banner and lock screen in every app.

## 2. The plan, in plain rules

These rules are the product. Every screen and every test follows them.

**P1. Prices.** Per app, from the one catalog (`CONTRACTS.md` 4.1):

| App | Price | You pay for |
|:-|:-|:-|
| CRM | $29 per user each month | seats |
| Projects | $12 per user each month | seats (the same count as CRM) |
| WMS | $349 per warehouse each month | warehouses |
| Pulse | $29 each month for your whole team | one flat price, up to 5 seats |

**P2. Bundle discount.** 2 or more apps: 20% off every app. It starts the moment the second app is added and
stops the moment you are back to one.

**P3. Yearly discount.** Pay yearly: 15% off. Both discounts can apply together.

**P4. Free trial.** 14 days. No card. Full access to the apps you pick. You can add more apps during the trial
and they share the same end date. One free trial per organization, and one per person who starts it.

**P5. Adding a card early never costs trial days.** If you add a card during the trial, the first charge is on
the day the trial ends. If that day is less than 2 days away, the first charge is 2 days from now.

**P6. Seats.** A seat is one person who can sign in. Guests are free. During a trial there is no seat limit.
On a paid plan you choose the number of seats, and it can never be lower than the people you have.

**P7. Warehouses.** On a paid plan you choose the number of warehouses, and it can never be lower than the
warehouses you have in the WMS. During a trial there is no limit.

**P8. Pulse covers up to 5 seats.** With Pulse alone, the team can have 5 people. With CRM or Projects in the
plan, the seat count comes from those apps, and a note says Pulse covers 5. For more Pulse seats the screen
links to "Talk to us" on the marketing site. There is no price above 5 to show.

**P9. One rule for every change.** More seats, fewer seats, more warehouses, a new app, one app less, monthly
to yearly or back: the change starts right away. If it costs more, you pay now for the days left in the
period. If it costs less, the unused part becomes credit on your next bill. The amount is shown before you
confirm. Same rule for monthly and yearly plans.

**P10. Nothing raises the bill by itself.** No auto upgrade, no surprise seat. If an invite or a new warehouse
needs a bigger plan, the person sees the price and says yes first, or is told who can.

**P11. Cancel.** Two clicks. The plan runs to the end of the paid period, then the apps become view only. One
click undoes it before that day. One optional question asks why.

**P12. Pause.** Monthly plans can pause for 1, 2 or 3 months. The pause starts at the end of the paid period.
No bills during the pause. Apps are view only. It starts again by itself on the date shown, or sooner with one
click.

**P13. Failed payment.** Full access continues for 7 days (`GRACE_DAYS`) while we retry. Owners and billing
managers get an email and a banner in every app. After 7 days the apps are view only. Paying turns everything
back on at once.

**P14. Three levels of access per app.** Full. View only (trial over, payment late, paused, plan ended).
Not in your plan (never added). View only is never a wall: people can still open, read and export.

**P15. Who can do what.** Owners and billing managers can do everything in billing. Admins can see billing
and can start the free trial. Other members see only a small card that says who to ask. Only an owner can add
or remove a billing manager. A billing manager needs no admin rights over data.

**P16. Manual grants still work.** An app KitStak staff granted by hand shows as "Included" and is never
billed, changed or removed by trials, checkout or webhooks. The dev switch `ENTITLEMENTS_DEV_ALLOW_ALL` still
opens everything.

**P17. Test mode.** With Stripe test keys, or with no keys outside production, every billing screen wears a
"Test mode" label and no real money moves. In production with no keys, billing is off and says so.

## 3. Journey map

| Step | Where | What happens | Lane |
|:-|:-|:-|:-|
| See prices | marketing `/pricing`, `/products`, app pages | Live calculator from the catalog | web |
| Build a stack | marketing `/get-started` wizard | Picks apps, seats, warehouses, period, business answers | web |
| Hand off | link to portal `/signup?...#...` | Cart and answers ride in the link; name, email, company ride after the `#` | web, signup |
| Create account | portal `/signup` | 4 fields, account and organization made | signup |
| Pick apps | portal `/signup/plan` | Prefilled picker with live price; "Start my free trial" | signup, billing-ui |
| Verify email | portal `/verify-email` | 6 digit code; can skip for now | signup |
| Welcome | portal `/welcome` then `/` | Wizard already answered, setup guide with 3 to 5 steps | signup |
| Use the apps | CRM, WMS, Projects, Pulse | Trial banner with the end date and one button | apps |
| Pick a plan | portal `/billing/plan`, then `/billing/checkout`, then Stripe Checkout | The picker to pay (one filled button), the review step with three facts, then the pay page | billing-ui, foundation |
| Come back | portal `/billing/checkout/success` | Access confirmed in seconds | billing-ui |
| Run the plan | portal `/billing` | Plan, cost, next charge, card, invoices, usage | billing-ui |
| Change it | portal `/billing/plan` | Preview, confirm, done | billing-ui |
| Hit a limit | any app | Price shown, confirm in the portal, back to work | apps, billing-ui |
| Payment fails | every app and email | Banner with amount, card, retry date, access date; one click fix | all |
| Leave or pause | portal `/billing/cancel` | Two clicks, undo any time before the end | billing-ui |
| Look back | portal `/billing/activity`, `/billing/invoices` | Every billing event in plain words; every invoice as a PDF | lifecycle, billing-ui |

## 4. Marketing site (`apps/web`)

### 4.1 One catalog

The site reads prices from `@kitstak/billing/catalog` and `@kitstak/billing/quote`. The notes that said
"Preliminary pricing" are removed (DECISIONS.md section 1). Pulse is open for signup (`PULSE_IS_LIVE` is
true). Every figure that is not a whole dollar shows its cents; nothing is rounded.

### 4.2 Pricing page `/pricing` (new)

Parts, top to bottom:

1. Heading "Simple prices. Pay only for the apps you use." with a Monthly and Yearly switch. Yearly reads
   "Yearly, save 15%".
2. Four app cards: icon, name, one line, the price in words ("$29 per user each month"), and "Start free".
   The Pulse card reads "$29 each month for your whole team. Up to 5 seats."
3. The calculator (the existing bundle calculator component): toggles for apps, steppers for seats and
   warehouses. It shows the same lines as the portal picker: one math line per app, the yearly discount and
   the bundle discount as their own dollar lines, the total, and for yearly the per month view.
4. Under the total: "14 days free. No card needed." and the button "Start my free trial". It goes straight to
   the portal signup with the cart (source `pricing`). A second link, "Help me choose", opens the wizard with
   the same cart.
5. "How billing works" in four short lines: the trial, the one rule for changes with a worked example ("Add 1
   CRM seat halfway through the month and you pay $14.50 today, then $29 more each month."), cancel any time,
   your data stays yours.
6. Questions: What happens when my trial ends? Can I change seats later? Can I cancel? Do I need a demo to buy
   the WMS? (No. Start the trial and add warehouses yourself.)

`ROUTES.pricing` points to `/pricing`. The header, footer and sitemap list it. The old `#pricing` anchor on
`/products` stays and links to the new page.

### 4.3 Wizard and handoff

- The last wizard step keeps asking for name, work email and company. The button reads "Create my account".
- The link is `signupUrl(LINKS.portal, handoff, identity)`: apps, seats, warehouses, period, business type,
  team size, start mode and the guided setup flag in the query; name, email and company after the `#`, where
  no server and no log can see them.
- The portal reads the link, checks every value against the catalog limits, and drops what it does not know.
  The link holds no price. A changed link can only change a cart the person could build by hand anyway.
- `LINKS.portal` follows `NEXT_PUBLIC_PORTAL_URL`, so a local site hands off to a local portal. The site's dev
  port moves to 3600.

## 5. Signup (portal)

One focused flow. Each screen asks for one thing. Every answer is used at once.

### 5.1 `/signup`: create your account

Layout: the existing split auth layout. The hero panel on the right shows all four apps. When the link
carried a cart, the hero shows the card "Your free trial" with the app chips, the line "Then $395.20 per month
if you add a card.", and "14 days free. No card needed."

- Heading: "Start your free trial". Under it: "14 days free. No card needed."
- When Google or Microsoft keys are set: "Continue with Google", "Continue with Microsoft", then a divider
  "or use your email". With no keys, the buttons are not rendered at all.
- Four fields, in this order, all required:

| Field | Label | Rules | Browser hints |
|:-|:-|:-|:-|
| name | Full name | 2 to 100 characters | `autocomplete="name"`, `enterkeyhint="next"` |
| email | Work email | valid email | `type="email"`, `autocomplete="email"`, `inputmode="email"`, no auto capitals, no spell check |
| password | Password | 10 to 72 characters, plus the shared password policy | `autocomplete="new-password"`, show and hide button, strength meter, hint "At least 10 characters." |
| company | Company or team | 2 to 80 characters | `autocomplete="organization"`, `enterkeyhint="go"` |

- Name, email and company are prefilled from the link fragment, and the fragment is then removed from the
  address bar. The first empty field gets focus on desktop only (no keyboard pop up on phones).
- Checks run when a field loses focus and again on submit. An error sits under its field, is tied to it with
  `aria-describedby`, and focus moves to the first bad field. Nothing the person typed is ever cleared.
- Button: "Create account". While it works it reads "Creating your account…" then "Setting up your
  workspace…". It shows the busy state within 100 ms and cannot be sent twice.
- Under the button: "By creating an account you agree to the Terms and the Privacy Policy." (two links).
- Footer: "Already have an account? Sign in". The link keeps the cart.

What happens on submit: the account is made with Better Auth in the browser (so password managers offer to
save), then the server action `createWorkspaceAction` makes the organization (with one retry on a taken
slug), makes it active, and stores the signup intent with the cart and answers. Then the person goes to
`/signup/plan`.

Errors (exact copy):

| Case | Message |
|:-|:-|
| Name too short | Enter your full name. |
| Bad email | Enter a valid work email. |
| Password too short | Use at least 10 characters. |
| Password too long | Use 72 characters or fewer. |
| Password policy | The message from the shared password policy, shown as is (it is already plain). |
| Company missing | Enter your company or team name. |
| Email already used | An account with this email already exists. Sign in to keep going. (with a "Sign in" link that keeps the cart) |
| Too many tries | Too many tries. Wait a few minutes and try again. |
| No network | We could not reach KitStak. Check your connection and try again. |
| Organization step failed | Your account is ready, but we could not set up your workspace. Try again. (the form becomes the one field company step) |

A signed in visitor who opens `/signup` is never bounced to the launcher with the cart lost. The cart from
the link is merged into their open signup intent and they go to the step in 5.6.

### 5.2 `/signup/company`

For a person who has an account but no organization (signed up with Google or Microsoft, or the workspace
step failed). One field "Company or team" and the button "Continue". Same rules and errors as above.

### 5.3 `/signup/plan`: pick your apps

The shared `PlanPicker` in `trial` mode, prefilled from the cart. With no cart, nothing is selected and the
four apps are shown as equal choices.

- Heading: "Pick your apps". Under it: "Try them free for 14 days. No card needed."
- Four app rows: icon, name, one line, price in words, a switch. Tap anywhere on the row to toggle.
- "People on your team" stepper (shown when CRM, Projects or Pulse is on). "Warehouses" stepper (shown when
  WMS is on). Each has minus and plus buttons of 44 px, a number field, and arrow key support.
- "Pay monthly" and "Pay yearly, save 15%" switch.
- With exactly one app on: "Add a second app and save 20% on both."
- With Pulse on and more than 5 people: "The Pulse price covers up to 5 seats. For a bigger team, talk to us."
  ("talk to us" links to the marketing contact page.)
- Summary (updates on every change in under 100 ms, with no page load):

```
CRM: 5 users x $29 = $145 per month
WMS: 1 warehouse x $349 = $349 per month
List price                         $494.00
Bundle discount (20%)              -$98.80
After your trial                   $395.20 per month
Due today                          $0.00
Your free trial ends on Dec 7, 2026.
```

  Yearly adds the lines "12 months" and "Yearly discount (15%)" and ends with "After your trial: $4,031.04
  per year. That is $335.92 per month."
- Button: "Start my free trial". Disabled with the hint "Pick at least one app." when nothing is on.
- Under the button, three short lines: "No charge today." "Cancel any time in Billing." "Your data stays
  yours."
- Three questions, closed by default: What happens when my trial ends? (Your apps become view only. Nothing
  is deleted. Pick a plan to keep working.) Can I change seats later? (Yes. Any time. You pay only for the
  days left.) Can I cancel? (Yes. Two clicks in Billing. You keep access until the end of the period.)
- If this person already used a free trial on another organization: the summary drops the trial lines, the
  button reads "Continue to payment" and goes to `/billing/checkout`, with the line "You already used your
  free trial. You can still pick a plan."

Pressing the button runs `startTrialAction`: the trial rows are written to `core.entitlements` (source
`trial`, end date 14 days out), the cart is saved, the welcome email is queued. Then: `/verify-email` if the
email is not verified yet, else `/welcome`.

### 5.4 `/verify-email`

- Heading: "Check your email". Text: "We sent a 6 digit code to maya@northwind.example. It works for 10
  minutes."
- One input: `autocomplete="one-time-code"`, `inputmode="numeric"`, 6 digits, large type. Pasting a code with
  spaces works. The form sends itself when 6 digits are in.
- "Send a new code" (waits 30 seconds between sends). "I will do this later" skips to where the person was
  going. Verification never blocks the first session.
- Errors: "That code is not right. Check it and try again." "That code is too old. Send a new one." "Too many
  tries. Wait a few minutes and try again."
- Outside production with the dev outbox: a "Test mode" line says "Open the email outbox to see your code."
  and links to `/dev/outbox`.
- A verified email is needed before paying, before changing a paid plan and before inviting people. Those
  screens send an unverified person here with `?next=` and bring them straight back.
- The portal shell shows a quiet banner until the email is verified: "Check your email for a 6 digit code to
  verify your address." with the action "Enter code".

### 5.5 Invitations, sign in, and passwords

- **Invite email.** Every invite, from the portal or from any app, now sends an email: "Maya Chen invited you
  to Northwind Robotics on KitStak", one button "Accept invite" to `/invite/<id>`, and the date it expires.
- **`/invite/[invitationId]`.** Shows the organization name, who invited you and your role.
  Signed out and new: a short form (full name, password; the email is fixed and shown) and "Join Northwind
  Robotics". Signed out with an account: "Sign in to accept". Signed in with the invited email: one button
  "Accept invite". Signed in with another email: "This invite is for sam@northwind.example. Sign out and open
  the link again." Expired or used: "This invite is no longer active. Ask Maya Chen to send a new one."
  No free seat: "The team has no free seat. Ask Maya Chen to add one." After accepting, the organization
  becomes active and the person lands on the launcher. Invited people never see the picker or a price.
- **Sign in.** `/login` gains the social buttons (when keys are set), "Forgot password?", and the legal links.
- **Forgot password.** `/forgot-password` asks for the email and always answers "If that email has an account,
  we sent a 6 digit code." `/reset-password` takes the code and a new password (same rules and meter). After
  a reset, every old session is signed out (already the shared setting).
- **Password rules** stay the ones in `packages/auth` (10 to 72 characters, the policy plugin, lockout).

### 5.6 Resume where you left off

`getSignupResume` decides the step from real data, so closing the tab at any point loses nothing.

| What is true | Go to |
|:-|:-|
| Signed out | `/signup` (the cart stays in the link) |
| Signed in, no organization | `/signup/company` |
| Organization, owner or admin, no trial and no plan yet, open signup intent | `/signup/plan` (cart from the intent) |
| Trial started, email not verified, not skipped yet | `/verify-email?next=/welcome` |
| Setup profile not saved yet | `/welcome` |
| Otherwise | `/` (the launcher) |

The same check runs when a signed in person opens `/login`, `/signup` or `/welcome`.

### 5.7 Welcome wizard and setup guide

- The wizard learns the four apps. Its first step shows the apps in the trial instead of the old CRM or WMS
  question. `SetupProfile` gains an optional `products` list; `focus` is still written (derived from CRM and
  WMS) so stored profiles and the CRM and WMS guides keep working.
- Answers from the marketing wizard (business type, team size, start mode) are prefilled from the signup
  intent. If all three are there, the wizard opens on its last step, the plan, with one button "Looks good".
  Nobody answers the same question twice.
- Saving the profile closes the signup intent.
- The setup guide gains one step at the end, key `billing_plan`, title "Pick your plan". It is `ready` during
  a free trial with the text "Pick a plan any time before Dec 7. No charge until then." and the button "Pick a
  plan". It is `done` when a card is on file or the plan is paid. It is not shown for organizations on a
  manual grant or with no trial, and not to a person who cannot pay (not an owner, not a billing manager).
  `docs/integration/ONBOARDING.md` lists the new key (signup lane).
- The guide on the launcher and in Organization settings is the QUICK START: the same 3 to 5 steps, the same
  count and the same minutes the welcome screen showed (`pickGuideSteps` in `apps/portal/src/lib/setup-model.ts`).
  It is "Tell us about your business", then the first step of each area in turn, then "Pick your plan". The
  pick does not change as steps are done. The next step is open with the one filled button. The other rows
  are one line each. Every other step sits behind "Show all steps" and does not move the count.
- Answers given on the marketing site count as done even when the person presses "Skip for now" on the
  welcome screen.
- The guide still lists 3 to 5 steps tied to the chosen apps and still follows ONBOARDING.md.

## 6. Billing in the portal

### 6.1 Billing home `/billing`

Answers five questions on first paint at 1280 by 800, with no scrolling: What am I on? What does it cost?
When is the next charge? What card? Where are my invoices?

Layout (desktop): a page title "Billing" with the phase badge and, in test modes, the "Test mode" label. Then
one row of four cards, then two columns.

| Card | Shows | Action |
|:-|:-|:-|
| Plan | App chips, seats and warehouses, monthly or yearly, the phase line from the table below | Change plan |
| Cost | "$395.20 per month" (or per year with the per month view), "Includes your 20% bundle discount." when true | See the math (opens the lines) |
| Next charge | "Dec 7, 2026" and what the card will really be charged (the price, less a promo code, less credit, each named); in a trial with no card: "No charge planned. Pick a plan to keep your apps after Dec 7." | none |
| Payment method | "Visa ending 4242, expires 08/28" or "No card yet. You add it when you pick a plan." | Update card (when a card is on file) |

One name for the paying step everywhere: "Pick a plan" (the banner, the emails, the setup guide, billing home).
The card row has one filled button, on the Plan card.

Left column: **Usage** ("Seats: 5 of 5 used", "Warehouses: 1 of 1 used", each with a bar and a hint such as
"You pay for 6 seats and use 5. Remove a seat to save $23.20 per month."), then **Your apps** (one row per app
with its badge: Trial, Active, Payment due, View only, Not in your plan, Included; apps not in the plan show
"Add" with the price it would add). Right column: **Invoices** (the latest three with date, amount, status and
a PDF link, then "See all invoices"), **Billing details** (company, billing email, tax ID, "Edit"), **Billing
team** ("Maya Chen and 1 other can manage billing", "Manage"; when only one person holds billing: "Add a
second person so billing never gets stuck."), and the link "Billing activity".

On a phone the four cards stack in the same order, then usage, apps, invoices, details, team.

What the Plan card and the main button say in each phase:

| Phase | Line on the Plan card | Main button | Other actions |
|:-|:-|:-|:-|
| `none` | You have no plan yet. Try any app free for 14 days. | Start free trial | |
| `trial` | Free trial. 9 days left. Ends Dec 7, 2026. | Pick a plan | Change trial apps |
| `active`, first charge still ahead | Free trial. Your first payment is on Dec 7, 2026. | Change plan | Update card, Cancel plan |
| `trial_ended` | Your free trial ended on Dec 7, 2026. Your apps are view only. Your data is safe. | Pick a plan | |
| `active` | Your plan is active. | Change plan | Update card, Cancel plan |
| `past_due` | We could not charge your Visa ending 4242 for $395.20. We will try again on Dec 10. | Update card | Pay now |
| `unpaid` | Your payment is late, so your apps are view only. | Update card | Pay now, Cancel plan |
| `cancel_scheduled` | Your plan ends on Dec 23, 2026. You keep everything until then. | Keep my plan | |
| `pause_scheduled` | Your plan pauses on Dec 23, 2026 and starts again on Feb 23, 2027. | Undo pause | |
| `paused` | Your plan is paused. It starts again on Feb 23, 2027. | Start again now | Cancel plan |
| `ended` | Your plan ended on Dec 23, 2026. Your apps are view only. Your data is safe. | Pick a plan | |

Other states of the page:

- **Billing is off** (production with no keys): a calm notice at the top, "Billing is not available right
  now. Nothing will be charged. Please try again later." All money buttons are disabled with the same line as
  their hint. Trial start still works. Reading still works.
- **Member without billing rights:** one card. "Northwind Robotics is on a free trial that ends Dec 7, 2026."
  (or the phase line) and "Ask Maya Chen to manage billing." No amounts, no invoices, no buttons.
- **Loading:** skeleton cards in the final layout (no layout jump). **Read error:** "We could not load
  billing. Try again." with a retry button; the rest of the portal keeps working.
- **Arriving with `?fix=payment`:** the page scrolls to and highlights the Payment method card.
- **Arriving with `?updated=card`:** the page retries the open invoice at once, then shows "Card updated. Your
  payment went through." or the decline message.
- **Manual grants:** the Plan card lists them as "Included" and the Cost card leaves them out.
- **Test mode tools** (only in `test_gateway` mode, only for billing managers): a small panel "Test tools.
  No real money moves." with "Skip ahead 7 days", "Skip to the end of the trial", "Run renewals now" and "Make
  the next payment fail".

### 6.2 Picker `/billing/plan`

The same `PlanPicker` as signup, inside the billing shell. It opens in the right mode by itself:

| Situation | Mode | Main button |
|:-|:-|:-|
| No trial yet and eligible | `trial` | Start my free trial |
| In a free trial, no card, opened from "Pick a plan" | `checkout` | Continue to review (and a quiet link: Change your trial apps) |
| In a free trial, no card, opened from "Change trial apps" (`?apps=1`) or "Add <app>" (`?add=`), or by a person who cannot pay | `trial_change` | Save my apps (and a quiet link: Pick a plan) |
| Trial over, or plan ended | `checkout` | Continue to review |
| Paid plan | `change` | Review change |

Links can prefill it: `?add=wms` turns WMS on, `?seats=6`, `?warehouses=2`, `?interval=yearly`,
`?focus=seats`. Values are clamped. On a paid plan the picker shows the current plan beside the new one ("Now:
$145.00 per month. New: $395.20 per month.").

Floors: the seat stepper cannot go below the people you have, the warehouse stepper cannot go below the
warehouses you have. The hint says why: "You have 6 people. Remove someone first to go lower."

### 6.3 Confirm a change (paid plans)

"Review change" asks the gateway for a preview and shows a confirm panel. Nothing is charged until "Confirm
change".

```
Add 1 seat
Due today                $14.50    for the 15 days left in this period
Then                     $174.00 per month, starting Dec 23, 2026
[ Confirm change ]  [ Go back ]
```

For a decrease the first line reads "You get $14.50 credit on your next bill." For monthly to yearly: "Due
today $3,636.84 after $394.20 credit for the unused part of this month." (numbers from the gateway). Tax,
when it applies, is its own line. If the amount moved since the preview (another change landed), the panel
reloads with "The amount changed while you were looking. Check the new amount and confirm again." If the card
is declined nothing changes: "That card was declined. Try another card or call your bank." with "Update
card". On success: back to billing home with "Your plan is updated."

### 6.4 Review before paying `/billing/checkout`

One screen, three facts, one button. It never shows a card field (the pay page does).

- The plan lines and discount lines (same block as the picker).
- **Due today:** "$0.00" during the trial, else the amount.
- **First charge:** "$395.20 on Dec 7, 2026" during the trial; else "Next charge: $395.20 on Dec 23, 2026".
- "Then $395.20 each month until you change or cancel." When tax may apply: "Sales tax is added at checkout
  if it applies."
- "Have a promo code? Enter it on the next screen."
- Button: "Continue to secure checkout" (test gateway: "Continue to test checkout").
- Three short lines under it: "No charge today." (or "You pay $395.20 today."), "Cancel any time in Billing.",
  "Your data stays yours."
- "Change my plan" link back to the picker. The cart is saved on every change, so closing the tab and coming
  back shows the same cart.

### 6.5 Coming back from the pay page

- **Success** `/billing/checkout/success?session_id=`: the server checks the session with the gateway and
  applies it (the same code the webhook runs). The page shows "You are all set." with the plan summary, the
  first charge date, the receipt note ("We emailed a receipt to billing@northwind.example."), and the button
  "Open my apps". A small confetti burst plays (not under reduced motion). If the gateway has not confirmed
  yet, the page says "Finishing up. This takes a few seconds." and checks again each second for up to 10
  seconds, then offers "Refresh". A visit with a session that is not paid never grants anything.
- **Back or closed** `/billing/checkout/canceled`: "No charge was made. Your cart is saved." with "Go back to
  checkout" and "Change my plan".
- **Expired session:** the review page makes a new one. Nobody sees a dead link.

### 6.6 Invoices

`/billing/invoices`: a table with date, number, what it was for ("Monthly plan", "Added 1 seat"), amount,
status (Paid, Due, Void) and "PDF". Empty state: "No invoices yet. Your first one arrives when your trial
ends." `/billing/invoices/<id>` shows one invoice on screen: lines, discounts, tax as its own line, total,
paid date, the card's last 4, the billing details and tax ID. The PDF link works without support: Stripe's PDF
in Stripe modes, a built in PDF in the test gateway. A receipt email goes out on every payment.

### 6.7 Billing details `/billing/details` and team `/billing/team`

Details: company name, billing email (where receipts go, as well as to owners and billing managers), address,
tax ID type and number. Saved values appear on the next invoice. Team: owners are listed and fixed; an owner
can add any member as a billing manager and remove them. The page says what a billing manager can do: "Pay
bills, change the plan and download invoices. No extra access to your data."

### 6.8 Cancel and pause `/billing/cancel`

Click one: "Cancel plan" on billing home. Click two: "Cancel my plan" on this page.

1. Top: "Your plan will end on Dec 23, 2026. You keep everything until then. After that your apps are view
   only. Nothing is deleted."
2. Monthly plans see an offer first: "Need a break? Pause for 1, 2 or 3 months. No bills while paused." with
   three buttons. Picking one shows "Paused from Dec 23, 2026. Starts again on Feb 23, 2027." and "Pause my
   plan". Plans with 2 or more apps also see "Or remove an app you do not use." (to the picker).
3. One optional question, "Why are you leaving?": Too expensive. Missing something I need. Switching to
   another tool. Not using it enough. Our work is seasonal. Something else. Plus an optional text box. Skipping
   it never blocks.
4. Buttons: "Cancel my plan" and "Keep my plan".

After cancel: billing home shows the end date and "Keep my plan" (one click, no confirm). After the end date
the phase is `ended`: view only, "Pick a plan" starts a new checkout with the old cart. Yearly plans see no
pause offer and the line "You are paid up until Nov 23, 2027."

### 6.9 Hitting a limit (seats and warehouses)

- **Inviting from the portal** when all paid seats are used: the invite form shows, before anything is sent,
  "All 5 seats are in use. Add 1 seat for $29 more per month. You pay $14.50 today for the days left." with
  "Add seat and send invite" and "Not now". Yes changes the plan, then sends the invite.
- **Inviting from another app** (for example CRM admin): the server refuses with "All 5 seats are in use. Add
  a seat in Billing, then invite again." and a link to the picker with the seat stepper focused.
- **A member who cannot manage billing** sees "All 5 seats are in use. Ask Maya Chen to add one."
- **Pulse only plans** at 5 people: "Pulse covers up to 5 seats. For a bigger team, talk to us."
- **Creating a warehouse in the WMS** beyond the plan: "Your plan covers 1 warehouse. Add a second one for
  $279.20 more per month." with "Add to my plan" (to the picker with `warehouses=2`, confirm there, then back
  to the WMS).
- During a free trial none of these appear. At checkout the plan simply cannot be smaller than what is in use.

## 7. Checkout and gateways

### 7.1 Stripe

- **First payment:** hosted Stripe Checkout by redirect, in subscription mode, with the prices from the
  catalog's lookup keys, promo codes allowed, tax ID collection on, and automatic tax when it is switched on.
  Wallets, saved cards, 3D Secure and declines are handled on Stripe's page. A decline keeps the person on
  that page to try again; "back" lands on our canceled page.
- **Later changes** go through the API with a preview first (6.3). The first payment is the only time a
  person leaves the portal to pay.
- **Card updates:** the Stripe Billing Portal, deep linked to "update payment method", returning to billing
  home. Plan changes, cancel and pause are turned off there, because KitStak has one rule for them.
- **Discounts** live inside the Stripe prices (yearly prices and bundle prices), so Stripe's pages show the
  discounted unit price and one line of text says so. The total matches ours to the cent by construction.
  `CONTRACTS.md` section 5 has every product id, lookup key and amount.
- **Webhooks:** signed, verified on the raw body, recorded once in `core.billing_events`, applied by fetching
  the current object from Stripe (so order and repeats do not matter).

### 7.2 Test gateway

Outside production with no Stripe key, the built in test gateway stands in. It has its own checkout page and
card page in the portal, styled like the rest of the portal and marked "Test mode. No real money moves."

- The test checkout page shows the same lines and the same three facts, a card form, and one tap chips for
  test cards: "Works", "Declined", "Not enough money", "Needs bank approval", "Fails at next renewal".
- "Needs bank approval" opens a pretend bank step with "Approve" and "Fail".
- A declined card shows "That card was declined. Try another card or call your bank." and stays on the page
  with the typed values kept.
- A promo field accepts `TEST10`.
- Every result is sent through the same signed webhook path and the same sync code as Stripe. The test gateway
  never writes access rows itself.
- Test tools (6.1) move time forward so trial end, renewal and failed payment can be seen in seconds.

### 7.3 Fail closed

In production with no Stripe key (or a key with no webhook secret): no test gateway, no checkout, no plan
change. Screens say "Billing is not available right now. Nothing will be charged. Please try again later."
Trials and reading still work. No access row is ever written without a verified gateway event.

## 8. Lifecycle

### 8.1 Phases

```
none -> trial -> active                      (card added during the trial; first charge at trial end)
        trial -> trial_ended -> active       (paid later; charged that day)
active -> past_due -> active                 (payment fixed)
          past_due -> unpaid -> active       (fixed after the 7 days)
                      unpaid -> ended        (the gateway gave up and closed the plan)
active -> cancel_scheduled -> ended          (or back to active with "Keep my plan")
active -> pause_scheduled -> paused -> active
ended -> active                              (a new checkout, no second trial)
```

Access per phase: `trial`, `active`, `past_due`, `cancel_scheduled`, `pause_scheduled` are full access.
`trial_ended`, `unpaid`, `paused`, `ended` are view only for the apps that were in the trial or the plan. Apps
that were never in it are "not in your plan".

### 8.2 The free trial, day by day

| Day | What happens |
|:-|:-|
| 0 | Trial starts. Welcome email. Banner in every app: "Free trial. 14 days left. Ends Dec 7." |
| 7 | Email "Your KitStak trial ends in 7 days" with the price and "Pick a plan". |
| 11 | Email "3 days". The banner turns to the warning color: "Your free trial ends in 3 days, on Dec 7." |
| 13 | Email "tomorrow". |
| 14 | Trial ends at the same time of day it began. With a card: the first charge runs and the plan is active. With no card: email "Your trial has ended. Your data is safe." and the apps are view only. |
| any later day | "Pick a plan" pays and turns full access back on at once. |

Trial end needs no cron: access is worked out from the end date every time it is read. The emails come from
the one minute job.

### 8.3 A failed payment

| When | What happens |
|:-|:-|
| The renewal charge fails | Phase `past_due`. Email and banner for owners and billing managers: the amount, the card's last 4, the next retry date, and the date access changes (7 days after the invoice). Full access continues. |
| Each retry that fails | A new email (one per attempt). The banner updates the retry date. |
| The bank asks for approval | Email "Your bank needs you to approve a KitStak payment" with a link to billing home and "Pay now". |
| 1 day before the 7 days end | Email "Last day to fix your KitStak payment". |
| Day 7 | Phase `unpaid`. Apps are view only. Banner: "Your payment is late, so your apps are view only. Pay now to turn them back on." |
| Card updated, or "Pay now" | The open invoice is paid at once. Access is full again within 5 seconds. The banner goes away. Receipt email. |
| The gateway closes the plan after its last retry | Phase `ended`. Still view only. "Pick a plan" starts fresh. |

Stripe's Smart Retries decide the retry dates. We show the date Stripe gives us.

### 8.4 Webhook driven sync

Every change of plan state enters through one function (`processWebhook`) or through a direct gateway answer
that is applied with the same snapshot code. Access rows in `core.entitlements` are written only there and in
`startTrial`. A replayed event changes nothing and adds no row. A bad signature gets 400 and changes nothing.
After a write, the entitlement cache is cleared, and the other apps see good news on their next request
because a "not full" answer is always read fresh.

### 8.5 Seats and warehouses from real counts

Seats used are counted from `core.member` (active, not guest only). Warehouses used are counted from the
organization's own WMS schema (active warehouses). Both show on billing home and in the picker, set the
floors, and drive the limit checks in 6.9. Nothing syncs a count into a charge by itself (P10).

### 8.6 Billing activity `/billing/activity`

A list, newest first, of everything that happened to the plan, in plain sentences: "Maya Chen started a free
trial for CRM and WMS." "Payment of $395.20 succeeded." "Daniel Ortiz added 1 seat. The plan is now 6 seats."
"We emailed a receipt to billing@northwind.example." Each row has the date and time, who did it (a person or
"KitStak"), and for payments a link to the invoice. Filters: All, Payments, Plan changes, Emails. Owners,
admins and billing managers can read it. Empty state: "Nothing here yet. Billing events will show up as they
happen."

## 9. In every app (CRM, WMS, Projects, Pulse)

### 9.1 One banner, one lock screen

The apps render `PlanBanner` and `PlanLockScreen` from `@kitstak/ui` with words from `planNoticeFor` and
`planLockFor` in `@kitstak/billing`. So the four apps and the portal always say the same thing, in the same
words, with the same button.

### 9.2 Banner copy (owners, admins, billing managers)

Shown at the top of the app shell, above the page, never over content.

| Kind | Tone | Text | Button |
|:-|:-|:-|:-|
| `trial` (more than 3 days left, from the second day on) | info | Free trial. 9 days left. Ends Dec 7. | Pick a plan |
| `trial_ending` (3 days or less) | warning | Your free trial ends in 2 days, on Dec 7. | Pick a plan |
| `trial_ending` (last day) | warning | Your free trial ends today. | Pick a plan |
| `trial_with_card` | info | Free trial. Your first payment of $395.20 is on Dec 7. | See my plan |
| `trial_ended` | danger | Your free trial ended on Dec 7. Your data is safe. Pick a plan to keep working. | Pick a plan |
| `payment_failed` | warning | We could not charge your Visa ending 4242 for $395.20. We will try again on Dec 10. Update your card by Dec 14 to keep full access. | Update card |
| `unpaid` | danger | Your payment is late, so your apps are view only. Pay now to turn them back on. | Update card |
| `cancel_scheduled` | info | Your plan ends on Dec 23. You keep everything until then. | Keep my plan |
| `pause_scheduled` | info | Your plan pauses on Dec 23 and starts again on Feb 23. | Undo pause |
| `paused` | danger | Your plan is paused, so your apps are view only. It starts again on Feb 23. | Start again now |
| `ended` | danger | Your plan ended on Dec 23. Your data is safe. Pick a plan to keep working. | Pick a plan |

Other members see a banner only when the app is view only, with no button: "This app is view only right now.
Ask Maya Chen to pick a plan." Info banners can be hidden for the day. Warning and danger banners cannot.
"Update card" goes to billing home with the payment card in focus. "Keep my plan" and "Undo pause" go to
billing home, where the one click action is. In an app, the banner shows only when that app is part of the
trial or plan.

### 9.3 Lock screen (an app that is not in the plan)

Inside the app frame, with the app's icon. Example for CRM:

| Viewer and state | Title | Text | Main button | Second button |
|:-|:-|:-|:-|:-|
| Can manage, free trial still open to them | CRM is not in your plan yet | Try it free for 14 days. No card needed. | Start free trial | Back to Portal |
| Can manage, in a free trial | CRM is not in your trial yet | Add it now. It is free until Dec 7. | Add CRM to my trial | Back to Portal |
| Can manage, paid plan | CRM is not in your plan yet | Add CRM for $23.20 per user each month. That price includes your bundle discount. | Add CRM to my plan | Back to Portal |
| Cannot manage | CRM is not in your plan yet | Ask Maya Chen to add it. | Back to Portal | |

The main button is `billingLink(portal, { to: 'add', product: 'crm' }, 'crm')`. Adding WMS from inside the
CRM is 3 clicks: the WMS row in the app switcher, "Add WMS to my plan", "Confirm change". The price line shows
the bundle discount on both apps.

No app shows the `trial` banner on the first day of a trial: nobody is asked to pick a plan a minute after
starting a "no card needed" trial. The Portal shows one notice at a time (an urgent plan notice, else "verify
your email", else a calm plan notice), never the calm one on the welcome screen, and no banner button on the
picker and review screens. On phones a notice is one row: the words and the button side by side.

### 9.4 View only

In view only the app opens and reads as usual, with the danger banner on top. Every write is refused at the
app's server choke point with one plain message: "Your plan is view only right now. Pick a plan in the Portal
to make changes." Exports and downloads keep working. The person is told BEFORE a form opens: `ViewOnlyGuard`
from `@kitstak/ui/view-only` sits in every app shell. A press on a control marked `data-plan-write`, a link to
a create screen (`/jobs/new`, `/log`, `/projects/new`, the CRM import), or a create dialog opened through an
app's store (CRM boards and invites, Projects quick add) opens one small dialog with the banner's words and
the banner's button. A create screen opened by its address shows the same message over the page. `CONTRACTS.md` section 18 lists the choke points and
error codes per app. If a path cannot be made view only safely, it is locked, never left open.

### 9.5 Other integration points

- **App switcher.** Each row shows its badge: Trial, Active, Payment due, View only, Not in your plan,
  Included. A row that is not in the plan opens the picker with that app turned on.
- **Launcher tiles (portal).** Same badges. A trial tile adds "9 days left". A tile not in the plan shows the
  price it would add and "Add to plan" or "Start free trial". A view only tile opens the app.
- **Admin pages.** CRM admin, WMS settings (labeled "Plan" there), Projects settings and Pulse settings each
  get a "Plan and payment" row with the badge, the next charge line and a link to billing home.
- **Pulse.** Flat price. Its settings row and the picker show "Up to 5 seats" and the note in P8.
- **WMS.** Warehouse count from the real warehouses. A brand new trial organization still goes through the
  existing "set up your warehouse" step first.
- **CRM `/signup`.** When billing is enforced, it sends people to the portal signup with CRM preselected, so
  there is one front door. The CRM invite page stays.
- **Old deep links** (`/billing?module=`, `/billing/upgrade?module=`) keep working and land on the picker.

## 10. Emails

All come from the small sender in `@kitstak/billing/emails`: Resend when its key is set, a dev outbox page
(`/dev/outbox`) outside production when it is not. In production with no mail key, mail stays queued and the
go live checklist catches it. Every email is plain, short, has one button, and has a text version. Billing
mail goes to the billing email (if set), every owner and every billing manager.

| Template | When | Subject | Says | Button |
|:-|:-|:-|:-|:-|
| `verify_email` | Signup, or "Send a new code" | Your KitStak code: 123456 | The code and "It works for 10 minutes." | none |
| `reset_password` | Forgot password | Reset your KitStak password | The code and "If you did not ask for this, ignore this email." | none |
| `invitation` | Any invite, from any app | Maya Chen invited you to Northwind Robotics on KitStak | Who invited you, when it expires | Accept invite |
| `welcome` | Trial started | Welcome to KitStak. Your free trial has started. | Your apps, the end date, "No card needed." | Open KitStak |
| `trial_ending` | 7, 3 and 1 days before the end, only with no card | Your KitStak trial ends in 3 days | The end date, the price after it, "Nothing is deleted if you wait." | Pick a plan |
| `trial_ended` | The trial ended with no card | Your KitStak trial has ended. Your data is safe. | Apps are view only, how to get back | Pick a plan |
| `plan_started` | First checkout finished | Your KitStak plan is set | The plan, the amount, the first charge date | See my plan |
| `receipt` | Every payment above $0 | Your KitStak receipt for $395.20 | Lines, tax line, total, card last 4, next charge date | View invoice |
| `payment_failed` | Each failed attempt | We could not charge your card for KitStak | Amount, card last 4, next retry date, the date access changes | Update card |
| `payment_action_required` | The bank wants approval | Your bank needs you to approve a KitStak payment | Amount, what to do | Approve payment |
| `grace_ending` | 1 day before view only | Last day to fix your KitStak payment | Amount, tomorrow's date, "Nothing is deleted." | Update card |
| `cancel_scheduled` | Cancel confirmed | Your KitStak plan will end on Dec 23 | Keep access until then, how to undo | Keep my plan |
| `paused` | Pause confirmed (it is planned, not running yet) | Your KitStak plan will pause on Dec 23 | Pause start, the date it starts again | See my plan |
| `plan_ended` | The plan's last day passed | Your KitStak plan has ended. Your data is safe. | Apps are view only, how to come back | Pick a plan |

Each email is sent once (a unique key per email in the outbox table). The dev outbox page lists every email
with its rendered HTML and text, newest first, so a person can read the code or click the button locally.

## 11. Data model

`CONTRACTS.md` section 9 has the SQL. In short, migration `0007_core_billing`:

| Table | Holds |
|:-|:-|
| `core.entitlements` (existing) | The gate every app reads. Now written with period end, seats and gateway ids. The module CHECK is set to all four apps again and the Drizzle mirror is fixed. |
| `core.stripe_customers` (existing) | Organization to gateway customer. |
| `core.billing_events` (existing, widened) | The webhook ledger: one row per event id, with organization, gateway, status and error. |
| `core.billing_accounts` (new) | One per organization: the saved cart, the trial dates and who started it, and the billing profile (email, company, address, tax ID). |
| `core.billing_subscriptions` (new) | One per organization: the current plan as the gateway sees it (status, period, items, card summary, cancel, pause and late payment dates). |
| `core.billing_invoices` (new) | A cache of invoices for the list and the receipts. |
| `core.billing_audit_log` (new) | The activity page. |
| `core.billing_managers` (new) | Who holds the billing role. |
| `core.billing_cancel_feedback` (new) | The optional "why" answers. |
| `core.billing_emails` (new) | The email outbox and send log. |
| `core.billing_test_objects` (new) | The test gateway's own state. Never used in production. |
| `core.signup_intents` (new) | The cart and answers from the marketing site, and the signup step, per person. |

## 12. Security and correctness

1. **Webhooks.** Signature checked on the raw body before anything else. Bad or missing signature: 400, no
   write. Secrets only from env.
2. **Idempotency.** `core.billing_events.id` is the event id. A processed event is skipped. State comes from
   a fresh gateway read, not from the event body, so replays and out of order events are safe. The ledger row
   and the state change commit together.
3. **Authorization.** Every action works on the session's active organization, never on an id from the
   browser, and checks the role rule in P15 on the server. Invoice PDFs check the organization before asking
   the gateway. Test gateway pages and test tools do not exist in production.
4. **No price from the client.** Actions take a cart. The server clamps it, prices it from the catalog and
   asks the gateway. A plan change is confirmed only if the fresh preview equals the amount the person saw.
5. **CSRF.** All mutations are server actions (Next checks the origin). The only POST routes are the two
   webhooks (signature) and the job tick (bearer secret). This matches the portal's posture in CODEMAP 7.
6. **Rate limits.** Better Auth rules for signup, sign in, codes and invites (stored in `core.rate_limit`).
   Billing: 10 checkout sessions per organization per 10 minutes, 20 plan changes per hour, 5 code sends per
   10 minutes.
7. **Money.** Integer cents everywhere. The catalog test proves every derived amount is a whole cent. The
   parity test proves the quote equals the gateway total for 9 carts.
8. **Secrets.** Stripe and mail keys are read lazily from env, never logged, never in the repo. The marketing
   handoff carries no secret, no price and no identity in the query.
9. **Personal data.** Name, email and company from the wizard travel only in the URL fragment. Codes in the
   outbox are wiped after sending. Webhook payloads are stored as sent by the gateway (no card numbers; Stripe
   never sends them).
10. **Audit.** Every billing write records who did it and a plain sentence in `core.billing_audit_log`.
11. **Trial farming.** One trial per organization and per starting person, the signup rate limit, and a
    verified email before paying.
12. **Deleting an organization** with a live plan is refused with "Cancel your plan before you delete this
    organization."
13. **Auth review themes** (`docs/security/auth-review-2026-11-11.md`): rules for shared `core` tables live
    in packages, so every app that mounts Better Auth passes the same billing organization hooks (seat checks,
    invite email, delete guard). Accepted risk A1 (signup reveals that an email exists) is unchanged.

### 12.6 Error copy (the text of `BILLING_ERROR_COPY`)

| Code | Message |
|:-|:-|
| `not_signed_in` | Please sign in again. |
| `no_org` | Create your organization first. |
| `forbidden` | Only an owner or a billing manager can do this. |
| `email_unverified` | Verify your email first. It takes one minute. |
| `billing_unavailable` | Billing is not available right now. Nothing was charged. Please try again later. |
| `invalid_selection` | Pick at least one app. |
| `below_usage` | You use more than that today. Pick a bigger number, or remove people or warehouses first. |
| `trial_used` | You already used your free trial. You can still pick a plan. |
| `already_subscribed` | You already have a plan. You can change it on the plan page. |
| `no_subscription` | You do not have a paid plan yet. |
| `card_declined` | That card was declined. Try another card or call your bank. |
| `payment_failed` | The payment did not go through. Nothing changed. Try again or use another card. |
| `price_changed` | The amount changed while you were looking. Check the new amount and confirm again. |
| `rate_limited` | Too many tries. Wait a few minutes and try again. |
| `seat_limit` | All your seats are in use. Add a seat first. |
| `warehouse_limit` | Your plan covers the warehouses you have now. Add one to your plan first. |
| `yearly_no_pause` | Yearly plans cannot be paused. You are paid up until your renewal date. |
| `gateway_error` | Something went wrong on our side. Nothing was charged. Please try again. |
| `not_found` | We could not find that. |

Functions may return a more exact sentence for a case (for example with the real numbers), following the same
rules.

## 13. Accessibility, phones, themes, states

- **Keyboard.** The whole path, signup to paid to cancel, works with the keyboard alone. Visible focus ring
  (`outline-focus`) on every control. App rows in the picker are real switches. Steppers take arrow keys.
  Dialogs trap focus and return it on close. The confirm panel puts focus on its heading, not on the pay
  button.
- **Screen readers.** The summary total is a live region (polite), so changes are spoken once. Errors use
  `role="alert"` and are tied to their fields. Banners use `role="status"` (info) or `role="alert"`. Badges
  have text, never color alone. Money lines are a real table or a definition list.
- **Phones.** At 360 px wide there is no sideways scroll. Tap targets are at least 44 px. The picker summary
  sticks to the bottom of the screen with the total and the button. The portal's phone menu gains "Billing".
- **Browser help.** The right `autocomplete` on every field, `one-time-code` on the code field, real `<form>`
  elements, a real URL change after signup and login so password managers offer to save and fill.
- **Slow networks.** Every button shows a busy state within 100 ms and cannot be sent twice. Server actions
  are safe to retry. Pages render skeletons that match the final layout.
- **Reduced motion.** With `prefers-reduced-motion`, no confetti, no slide or pop animations; changes still
  show, without movement.
- **Themes.** Light and dark, with the theme handoff between apps as today. Tokens only.
- **Empty, loading and error states** are listed with each screen above. No screen is ever blank.
- **Analytics.** The repo has no analytics library (checked: none in the portal, the site or `packages/ui`).
  None is added. The billing audit log and the server logs are the record. If a tracker is added later, the
  audit actions are the event names to use.

## 14. Test plan

### 14.1 Unit tests (vitest)

| Area | File | Asserts |
|:-|:-|:-|
| Catalog | `packages/billing/src/catalog.test.ts` | The four price columns relate as in CONTRACTS 4.1. `formatMoney` never rounds. `normalizeSelection` clamps and drops junk. `seatLimitFor` cases. Grace days equal `GRACE_DAYS`. |
| Quote | `packages/billing/src/quote.test.ts` | The 9 reference carts to the cent. The identity list minus discounts equals total. Math lines read as specified. |
| Handoff | `packages/billing/src/handoff.test.ts` | Round trip for every valid input. Junk, huge numbers and unknown apps are dropped. Legacy `focus` and `annual` are read. |
| Plan state | `packages/billing/src/plan-state.test.ts` | Every phase from table driven rows. Notice text and buttons per kind and viewer. Every sentence is 20 words or fewer. |
| Access rule | `packages/entitlements/src/read.test.ts` | The `moduleAccess` table, row by row. A trial past its end is not entitled. A "not full" cache entry is read again. |
| Writer | `packages/entitlements/src/write.test.ts` | Writes every column. Never overwrites a live manual grant. |
| Sync | `packages/billing/src/server/sync.test.ts` | Each gateway status writes the rows in CONTRACTS section 8. `incomplete` grants nothing. Removed apps are canceled. Manual grants are untouched. |
| Webhook | `packages/billing/src/server/webhook.test.ts` | Bad signature: 400 and zero writes. Same event twice: one ledger row, second answer `duplicate`. Handler error: rolled back, row `failed`, a retry then succeeds. Unknown customer: `ignored`. |
| Test gateway | `packages/billing/src/gateway/test.test.ts` | Each test card outcome. Proration to the cent (1 CRM seat at the half way point of a 30 day period is 1450). Renewal and failed renewal events. |
| Stripe adapter | `packages/billing/src/gateway/stripe.test.ts` | With a mocked SDK: Checkout params (lookup key prices, quantities, trial end rule, promo codes on), item list for bundle swaps, pause and cancel params. No network. |
| Trial and usage | `packages/billing/src/server/trial.test.ts`, `usage.test.ts` | One trial per organization and per person. Seat counting ignores guests and deactivated members. Limit checks. |
| Emails | `packages/billing/src/emails/render.test.ts` | Every template renders with a sample payload, has a subject, a text version and at most one button, and passes the copy rules. |
| Parity | `packages/billing/tests/price-parity.test.ts` | Quote total equals Stripe mapping total equals first test gateway invoice total for the 9 carts. |
| Copy rules | `packages/billing/tests/copy-rules.test.ts`, `apps/portal/src/lib/copy-rules.test.ts` | No em dash, en dash, double dash, "coming soon" or lorem in UI strings. |
| Web | `apps/web/src/lib/pricing.test.ts`, `stak.test.ts` | The site uses the shared catalog. The handoff link round trips. |

Database tests run against the local Postgres from DEV.md, like the bridge packages' `*.db.test.ts` files.

### 14.2 Route tests

`/api/billing/webhooks/test`: a signed event gives 200; the same body again gives 200 and one row; a changed
body with the old signature gives 400 and no row; no signature gives 400. `/api/billing/webhooks/stripe` with
no Stripe key gives 503. `/api/billing/jobs/tick` without the bearer secret gives 401 when the secret is set.
`/billing/invoices/<id>/pdf` gives 404 for another organization's invoice.

### 14.3 End to end (Playwright, portal, test gateway)

Run with `ENTITLEMENTS_DEV_ALLOW_ALL=0` in the portal and the product apps. Each spec makes a fresh account
(the signup rate limit is reset with the script in DEV.md).

| Spec | Journey |
|:-|:-|
| `signup-trial.spec.ts` | Open a handoff link for CRM (5 seats) and WMS (1 warehouse), monthly. Name, email and company are prefilled. Create the account. The picker shows $395.20. Start the trial. Skip verification. Land on the welcome plan, then the launcher. The database has two trial rows that end 14 days out. Count of required fields is 4. |
| `signup-resume.spec.ts` | Create the account, close the page at the picker, sign in again: back at the picker with the same cart. |
| `verify-email.spec.ts` | Read the code from `/dev/outbox`, enter it, banner gone. Wrong code shows the message. |
| `checkout-success.spec.ts` | From a trial: review shows "Due today $0.00" and the first charge date. Pay with the working test card. Success page within 5 seconds. Billing home shows the card and the next charge. Launcher tiles say Trial with a first payment date. One invoice count as expected. |
| `checkout-decline.spec.ts` | Declined card: message shown, still on the pay page, no access row changed. Back: the canceled page, the cart is kept. |
| `checkout-3ds.spec.ts` | "Needs bank approval": approve gives success; fail gives the decline message. |
| `plan-change.spec.ts` | On a paid plan (after shifting past the trial): add 1 seat, the preview amount equals the new invoice line to the cent. Remove it: credit shown. Add Projects: bundle prices apply to every line. Switch to yearly. |
| `seat-limit.spec.ts` | With 2 seats paid and 2 people: inviting a third shows the price and asks. Yes adds the seat and sends the invite (the invite email is in the outbox). |
| `trial-end.spec.ts` | Shift 14 days with no card: the apps are view only, the banner says so, a write is refused with the plain message, reading works. Pay: full access within 5 seconds. |
| `payment-failed.spec.ts` | Card that fails at renewal, shift to renewal: banner and email with amount, last 4, retry date and access date. Update the card: banner gone, access full, receipt in the outbox. Shift 8 days without fixing: view only. |
| `cancel-undo.spec.ts` | Cancel in two clicks with a reason. Billing home shows the end date. "Keep my plan" restores it. Cancel again, shift past the end: view only, data still there, "Pick a plan" works. |
| `pause.spec.ts` | Pause 2 months: dates shown. Shift past the start: view only, no invoice made. Shift past the end: active again and billed. |
| `roles.spec.ts` | A billing manager who is a plain member can pay, change and download. A member sees the small card only. An admin can read but not change. |
| `webhook-replay.spec.ts` | Post the same signed test event twice and a bad signature once (CONTRACTS 12.2 results). |
| `apps-integration.spec.ts` | In CRM, WMS, Projects and Pulse: the trial banner text matches the portal's; an app not in the plan shows the lock screen with the price; adding WMS from the CRM takes 3 clicks. In a view only CRM, "New board", "Invite" and "Import" open the view only dialog and no form, and nothing is created. |
| `a11y-mobile.spec.ts` | At 360 px: no sideways scroll on signup, picker, review, billing home, cancel. Keyboard only run of signup to trial. Reduced motion: no confetti node. |
| `billing-off.spec.ts` | Portal started in production mode with no key (a second run config): pay buttons are disabled with the plain message; trial start still works. |

Visual checks: `deploy/dev/shot.mjs` for every new route in light and dark, desktop and phone.

## 15. Operations

### 15.1 Env

Portal only (see CONTRACTS 16.1): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PORTAL_CONFIGURATION_ID`, `STRIPE_AUTOMATIC_TAX`, `CRON_SECRET`, `EMAIL_PROVIDER`, `RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_REPLY_TO`, the optional social sign in keys, `NEXT_PUBLIC_SITE_URL`, and the legal link
overrides. Marketing site: `NEXT_PUBLIC_PORTAL_URL` (optional). The product apps need nothing new. No secret
is ever committed.

### 15.2 Stripe setup script

`pnpm -F @kitstak/billing stripe:setup check` compares the live account to the catalog and prints what is
missing or different. `... stripe:setup apply` creates what is missing: 4 products by fixed id, 16 prices by
lookup key, and the Billing Portal configuration. It is safe to run again and again. It never edits a price in
place, never touches the old tier products, and never creates or disables a webhook endpoint. Because the
orchestrating session creates the live products and prices through the Stripe connector from the same table,
`check` should print all `ok` afterward.

### 15.3 `GO-LIVE.md` outline (lifecycle writes the full file)

1. **Stripe objects.** Run `stripe:setup check`. All 4 products and 16 prices `ok`. Create the portal
   configuration; note its id.
2. **Stripe settings.** Smart Retries on. After the last failed retry: cancel the subscription. Turn off
   Stripe's own receipt and failed payment emails (KitStak sends them) or accept doubles on purpose. Set the
   public business name, support address and branding. Decide on Stripe Tax; if on, add registrations first.
3. **Mail.** Verify the sending domain in Resend (SPF, DKIM, DMARC). Set `RESEND_API_KEY` and `EMAIL_FROM`.
   Send one test email from production.
4. **Database.** Run migration 0007 on production with `deploy/with-prod-db.mjs`. Run the module CHECK query
   and confirm it lists four modules.
5. **Backfill.** Run the backfill `check`, then `apply manual` (or `apply trial`), so every existing
   organization has entitlement rows. Confirm the count is zero on a second `check`.
6. **Env.** Push the portal variables. Keep `ENTITLEMENTS_DEV_ALLOW_ALL=1` for now.
7. **Deploy** the portal, the four apps and the site.
8. **Portal webhook.** Create the endpoint `https://kitstak.app/api/billing/webhooks/stripe` with the event
   list in CONTRACTS 5.6. Put its signing secret in `STRIPE_WEBHOOK_SECRET`, redeploy. Send a test event and
   confirm a row in `core.billing_events`.
9. **Live smoke test.** On an internal organization: start a trial, pay for Pulse monthly ($29.00) with a real
   card, see the access row, the invoice, the receipt email. Update the card. Add a seat on a CRM plan and
   compare the preview to the invoice. Cancel, undo, cancel. Refund the charges in the Stripe dashboard.
10. **Old webhook.** Only now disable the Supabase endpoint (`.../functions/v1/stripe-webhook`). Not before
    step 8 and 9 pass (DECISIONS.md section 4).
11. **Turn enforcement on.** Remove `ENTITLEMENTS_DEV_ALLOW_ALL` from production for all five apps and
    redeploy. Open each app as an existing organization and as a brand new signup.
12. **Watch.** Queries for failed events, queued emails older than 5 minutes, and organizations in `unpaid`.
13. **Roll back.** Set `ENTITLEMENTS_DEV_ALLOW_ALL=1` again and redeploy (opens everything). Disable the
    portal endpoint and enable the old one again only if billing state must stop moving.

### 15.4 Local and preview

Local dev uses the test gateway and the dev outbox with no setup. To try real Stripe test mode, put test keys
in `apps/portal/.env.local` and forward webhooks with the Stripe CLI (`stripe listen -f
localhost:3300/api/billing/webhooks/stripe`). Vercel previews run in production mode: with no keys there,
billing is off by design.

## 16. Must haves: where each is built and tested

| # | Must have | Built in | Proved by |
|:-|:-|:-|:-|
| 1 | In the product in 60 seconds, 4 fields | 5.1 to 5.3 | `signup-trial.spec.ts` |
| 2 | Trial starts by itself, no card, real end date in words | 5.3, 8.2, 9.2 | `signup-trial.spec.ts`, `apps-integration.spec.ts` |
| 3 | One price to the cent everywhere | 2, 4.1, CONTRACTS 4 and 5 | quote test, parity test, web pricing test |
| 4 | Math in plain words, discounts as dollar lines, under 100 ms | 5.3, 6.2 | quote test, `signup-trial.spec.ts` |
| 5 | Due today, next charge amount, next charge date | 6.4, 7.2 | `checkout-success.spec.ts` |
| 6 | Checkout never strands anyone | 6.5, 7 | `checkout-decline.spec.ts`, `checkout-3ds.spec.ts` |
| 7 | Access within 5 seconds, signed webhooks, safe replay | 6.5, 8.4 | webhook test, `webhook-replay.spec.ts`, `checkout-success.spec.ts` |
| 8 | Fail closed in production, honest test mode | 7.3, 2 (P17) | config test, `billing-off.spec.ts` |
| 9 | Cancel in two clicks, keep access, undo | 6.8 | `cancel-undo.spec.ts` |
| 10 | Failed payment: email, banner in every app, one click fix, instant restore | 8.3, 9.2 | `payment-failed.spec.ts` |
| 11 | One seat rule, cost before confirm, credit on removal | 2 (P9), 6.3 | gateway test, `plan-change.spec.ts` |
| 12 | Nothing raises the bill without a confirm | 2 (P10), 6.9 | `seat-limit.spec.ts` |
| 13 | Five answers on first paint, usage against paid | 6.1 | screenshot at 1280 by 800, `checkout-success.spec.ts` |
| 14 | Invoices with PDF, receipts, self serve details and tax ID | 6.6, 6.7, 10 | `plan-change.spec.ts`, render test |
| 15 | Billing manager role, two holders | 2 (P15), 6.7 | `roles.spec.ts` |
| 16 | Trial end is a soft landing with reminders | 8.2, 9.4 | `trial-end.spec.ts`, jobs test |
| 17 | Pause for 1, 2 or 3 months | 6.8 | `pause.spec.ts` |
| 18 | One optional cancel question, stored | 6.8 | `cancel-undo.spec.ts` |
| 19 | One account, one trial, one invoice; add WMS from CRM in 3 clicks; shared banner | 9 | `apps-integration.spec.ts` |
| 20 | Self serve WMS purchase with a public price | 4.2, 6.9 | `plan-change.spec.ts` |
| 21 | Google and Microsoft sign in only when keys are set | 5.1, 5.5 | unit test on the provider list |
| 22 | Verification never blocks the first session | 5.4 | `signup-trial.spec.ts`, `verify-email.spec.ts` |
| 23 | Autocomplete, password managers, paste friendly code, keyboard path | 5.1, 5.4, 13 | `a11y-mobile.spec.ts` |
| 24 | Errors name the problem and the fix, input never lost | 5.1, 12.6 | copy test, `checkout-decline.spec.ts` |
| 25 | 360 px, 44 px targets, busy state, reduced motion | 13 | `a11y-mobile.spec.ts` |
| 26 | Light and dark with tokens only | 0, 13 | screenshots in both themes |
| 27 | Setup checklist of 3 to 5 steps tied to the apps | 5.7 | setup model test |
| 28 | Grade 8 reading, 20 word sentences, no dashes or placeholders | 0 | copy rules tests |
| 29 | Trust lines under the pay button, 3 question FAQ | 5.3, 6.4 | `signup-trial.spec.ts` |
| 30 | Promo code and tax as their own lines, tax ID on the invoice | 6.4, 7.1, 7.2 | gateway test (`TEST10`), adapter test |

## 17. Choices made here, and questions for the owner

These follow from the decisions already made. Each sits in one place in the catalog or the code, so changing
it later is a small edit.

1. **Price flag.** DECISIONS.md section 1 says the per product prices are live. The catalog comment says
   exactly that and `PRICING_IS_PLACEHOLDER` is false. (An earlier brief said only Pulse was confirmed.)
2. **Bundle discount is modeled as bundle prices, not a coupon** (CONTRACTS 5.3), so promo codes work at
   Checkout and totals match to the cent with no percent math.
3. **Guests do not use a seat** (`CATALOG.freeRoles`). Every other active member does, including viewers.
4. **One trial per organization and per person** (`CATALOG.trialsPerUser`).
5. **Admins can read billing and start a trial, but not change a paid plan.** Owners and billing managers can.
6. **View only instead of a wall** when a trial ends, a payment is late, or a plan pauses or ends.
7. **Removing an app starts right away with credit**, like every other change. Only a full cancel waits for
   the period end.
8. **Pause is for monthly plans only** and starts at the period end.
9. **Pulse above 5 seats** has no price. The screens link to "Talk to us" on the site. Question: what should
   a 6th Pulse seat cost?
10. **Guided setup** (the founder led add on in the wizard) has no price and no process. The flag is stored
    and logged; no screen promises a call. Question: should the welcome screen promise a contact time?
11. **Terms and Privacy links** point at the pages the CRM already serves. Question: should the marketing
    site host them?
12. **Stripe Tax** is off until the owner turns it on with registrations in place.
13. **The webhook path** is `/api/billing/webhooks/stripe` (BLUEPRINT.md section 3 said `/api/stripe/webhook`;
    that section is replaced by these docs).
