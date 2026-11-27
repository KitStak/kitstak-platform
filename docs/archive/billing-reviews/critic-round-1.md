# Critic review, round 1: head to head scorecard

Date: 2026-11-23. Reviewer: the harsh critic (a buyer who has used Stripe, Linear, Shopify, Notion, Slack,
HubSpot and Vercel). Build: branch `mike/amazing-bell-llk3rq` at `894d2aa`.

**Verdict: not passed.** Score 20 of 30 with one zero. The bar in `research/COMPETITORS.md` section 6 is 24
or more with no zero. The flow is close. Cancel, pause, failed payment and the price math are already better
than every product on the list. But two screens state a charge amount that is not the amount charged, and a
buyer cannot pass a product that does that.

## How I tested

I used the product in a real browser (Playwright, Chromium) against the shared dev stack and looked at every
screenshot named here. Scripts and screenshots are in `docs/billing/.review/critic1/` (not committed).

Three fresh buyers, all made by signing up:

| Buyer | Path | What I did |
|:-|:-|:-|
| Riley, Carter Supply Co | Site `/pricing`, "Start my free trial", desktop light | Every signup mistake, picker, verify, welcome, launcher, billing home, review, pay page mistakes, decline, promo, bank approval, success, trial end, invoice and PDF, add and remove seats, yearly preview, add an app, pause, undo, cancel, keep, failed renewal, pay now, update card, invite at the seat limit |
| Jo, Harbor Freight Co | Pulse "Start free" card, 360 px phone, dark | Signup with a passphrase password, picker on a phone, tap target sizes, sideways scroll |
| Sam, Fernleaf Goods | Home page, 5 step wizard, handoff link, keyboard only from the password on | Prefill, focus, keyboard path to the trial, skip verify, welcome plan, trial end |

Limits, stated plainly:

- The shared servers run with `ENTITLEMENTS_DEV_ALLOW_ALL=1` and I was told not to restart them. So I could
  not open lock screens or view only apps myself. I looked at the visual reviewer's captures from the same
  build (`.review/visual/shots/k20`, `v01`). Line 14 below leans on those and on the passing e2e spec.
- No Stripe keys exist. Everything I paid with was the test gateway. See blocker 10.
- Competitor facts come from `research/COMPETITORS.md`, where most signup details are tagged as working
  knowledge, not verified.
- My paste test on the 6 digit code used a made up clipboard event and proved nothing. Not verified.

## Clicks and fields to first value

| Path | Screens | Fields typed | Clicks | Notes |
|:-|:-|:-|:-|:-|
| KitStak fast path (pricing card or calculator) | 5: signup, picker, verify, welcome, launcher | 4 | 5 (start, create, start trial, later, skip) | Account made in under 1 second on the dev box |
| KitStak default path (home page, header button) | 10: 5 wizard steps, signup, picker, verify, welcome, launcher | 4, plus about 8 choices | about 12 | The site says "About five minutes" |
| Linear | about 5 | 3, no password | about 5 | Login link is the verification |
| Slack | about 5 | 4, no password | about 5 | One question per screen |
| Stripe | 1, then the dashboard | 4 | 1 | |
| HubSpot | 8 to 10 | 8 or more | 10 or more | The one buyers complain about |

The fast path is on par with the best. The default path is HubSpot length. See blocker 4.

## Scorecard

0 is worse than most, 1 is on par with the best, 2 is better than the best.

| # | Question | Best in class | Score | Why |
|:-|:-|:-|:-|:-|
| 1 | Time from signup to inside the product | Linear, Slack | 1 | Fast path is quick. The home page only offers the long path. A password is still required. |
| 2 | Things asked before value | Linear (3) | 1 | 4 fields. Welcome adds 3 more questions, with a skip. |
| 3 | Price obvious and the same everywhere | Slack, Linear | 1 | Site, picker, review and pay page agree to the cent. A promo code and account credit break it later. |
| 4 | Can I work out my bill in my head | Slack | 2 | "CRM: 5 users x $29 = $145", discounts as dollar lines, "See the math". Nobody does this better. |
| 5 | Do I know what I pay today and next | Stripe Checkout | 1 | The review screen is excellent. With a promo code the "First charge" stays wrong on every screen. |
| 6 | Does checkout feel safe and fast | Stripe Checkout | 1 | Test gateway page is clean and kind. Real Stripe has never been run. |
| 7 | How fair are seat changes | Slack | 2 | One rule, cost before confirm, credit on removal, same for yearly. Beats Notion, Linear and Atlassian. |
| 8 | Could a charge ever surprise me | Slack | 0 | Twice the screen named an amount and the gateway charged a different one. Both times in my favor. Still wrong. |
| 9 | How clear is the billing page | Vercel | 2 | Five answers on first paint at 1280 by 800, usage against paid, "Remove a seat to save $23.20". |
| 10 | Invoices and tax details alone | Stripe Portal | 1 | List, detail page and PDF all work. The invoice lists the promo twice and hides the bundle discount. |
| 11 | What happens when a card fails | Stripe, Shopify | 2 | Banner in the portal and the CRM with amount, last 4, retry date, access date. Pay now fixed it in one click. |
| 12 | Leave, pause, come back | Stripe Portal | 2 | Two clicks, pause for 1 to 3 months with dates, one click undo, one optional question. Best I have used. |
| 13 | Can finance pay without being admin | Atlassian | 1 | The role is there and the page nudges a second holder. On par. I did not run it as a second person. |
| 14 | One account for the whole suite | HubSpot, Atlassian | 2 | One trial, one invoice, one banner, lock screen with the real bundle price. |
| 15 | Would an 8th grader understand every screen | Slack | 1 | Sentences are short and plain. Three names for one action and three different step counts trip it up. |

Total: 20 of 30. One zero.

## Step by step against the best

| Step | KitStak today | Best in class | Who wins |
|:-|:-|:-|:-|
| Public price | Four cards, live calculator, 4 billing rules, 11 questions | Slack and Linear pricing tables | KitStak. No WMS rival shows a price at all. |
| Signup form | 4 fields, right autocomplete, strength meter, errors under each field, nothing cleared, "email already exists" keeps the cart | Stripe: 4 fields. Linear: email only | Tie with Stripe. Loses to Linear on the password. |
| Reasons to trust | "14 days free. No card needed." and a mock launcher | Shopify and HubSpot show proof and security lines | Loses. See blocker 9. |
| Picker | Live math, trial end date, three trust lines, three questions | Atlassian calculator | KitStak, clearly. |
| Verify email | 6 boxes, skip allowed, never blocks | Slack code step | Tie. Loses on a wrong address. See blocker 5. |
| First screen | Setup guide and four tiles | Shopify setup guide | Tie. Step count is not what was promised. See blocker 7. |
| Review before paying | Due today, first charge, date, "then each month" | Stripe Checkout | Tie, until a promo code is used. |
| Plan change | Dialog with due today and the new price | Stripe preview API (most apps hide it) | KitStak, until account credit is involved. |
| Failed payment | Calm banner in every app, email with four facts | Stripe emails, Shopify banner | KitStak. |
| Cancel and pause | See line 12 | Stripe Portal | KitStak. |

## Blockers

Each one is something I saw. "Great" is what would make me drop it.

### 1. A promo code is taken but every screen still shows the full first charge (backend)

- Where: `/test-gateway/checkout/...`, `/billing/checkout/success`, `/billing` Next charge card, plan banner.
- Saw: I typed `TEST10`. The page said "10% off your first charge". The summary beside it still said "First
  charge $395.20 on Dec 7, 2026". The success page said the same. Billing home said "$395.20 to your Visa
  ending 3184". The banner said "Your first payment of $395.20 is on Dec 7." Invoice TEST-0001 then charged
  **$355.68**.
- Great: the moment the code is accepted, the summary gains "Promo code TEST10 (10% off) -$39.52" and "First
  charge $355.68". Success, billing home and the banner show $355.68, read from the gateway's upcoming
  invoice. Must have 30 in the research file asks for exactly this.

### 2. Account credit is invisible and the next charge amount is wrong (backend)

- Where: `/billing` Cost and Next charge cards, the confirm dialog on `/billing/plan`, the seat prompt on
  `/settings/organization`, `/billing/cancel`.
- Saw: I removed 3 seats and was told "You get $69.59 credit on your next bill." After that the word credit
  appears nowhere. Billing home said "Next charge Dec 23, 2026. $372.00 to your Visa". The renewal the gateway
  then tried was **$325.61**. Adding Pulse, which costs more, showed "Due today $0.00. Nothing to pay now."
  with no reason. The invite prompt said "Add 1 seat for $23.20 more per month. You pay $0.00 today." with no
  reason.
- Great: billing home shows a line "Credit: $46.39. It comes off your next bill." Next charge reads "$325.61
  on Dec 23, after $46.39 credit". The confirm dialog shows the days left amount, then "Paid from your
  credit", then due today. The cancel page says what happens to unused credit. Slack shows its credit balance.
  We promise "no surprises on your bill", so the number on screen has to be the number charged.

### 3. "Pick a plan" leads to a page where you cannot pick a plan (ui)

- Where: plan banner in every app during the trial, `/billing/plan`, `/billing` cards.
- Saw: the trial banner button says "Pick a plan". It opens "Change your trial apps". The main button there
  is "Save my apps" and it is greyed out. The thing I came for is the plain outlined button "Add a card".
  Billing home has three "Add a card" buttons in one row plus the banner's "Pick a plan". An 8th grader will
  ask if picking a plan and adding a card are two different things.
- Great: one name for the paying action everywhere. The banner goes straight to the review screen, or to the
  picker with "Continue to review" as the one filled button. One filled button per screen.

### 4. The site's main button sends everyone down the long road (ui)

- Where: marketing header and home page. All ten start buttons go to `/get-started`.
- Saw: the only fast way in is on `/pricing`. From the home page a buyer clicks through 5 wizard steps, types
  name, email and company, then meets a password screen, then the picker, then the code, then welcome. That is
  the HubSpot pattern the research file calls the most complained about.
- Great: the header and hero button read "Start free" and open the 4 field signup. "Help me choose" stays as
  the second link to the wizard. Linear and Slack put the short path first.

### 5. A typo in the email costs the buyer the whole signup (backend)

- Where: `/verify-email`.
- Saw: "Not your address? Sign out and start again." By then the account, the organization and the one free
  trial are tied to the wrong address.
- Great: a "Change email" link on this screen. One field, save, a new code goes out, and the organization and
  the trial stay. Slack and Notion cannot have this problem because the code comes first.

### 6. The password hint says one rule and the form has four (ui)

- Where: `/signup`, `/reset-password`, `/invite/...`.
- Saw: the hint reads "At least 10 characters." I typed a 28 character passphrase and got "Include a capital
  letter." The other rules appear only after typing starts, and errors arrive one at a time.
- Great: say every rule before the first key press, or accept any long passphrase. Best of all, offer "Email
  me a code" so no password is needed, as Linear, Slack and Notion do.

### 7. The setup guide promises 5 steps and then shows 8, then 12 (ui)

- Where: `/welcome` last step, launcher, `/settings/organization`.
- Saw: welcome said 5 steps and "about 12 min in all". The launcher said "1 of 8 complete, about 15 min
  left". After I added Pulse it said "2 of 12 complete, about 19 min left". The spec says 3 to 5.
- Great: the launcher shows the same 5 steps and the same minutes the welcome screen promised, with "Show
  more steps" for the rest. Shopify's guide never grows after you say yes to it.

### 8. The invoice does not tell the same story as the picker (ui)

- Where: `/billing/invoices/<id>` and the test PDF.
- Saw: "Promo code TEST10" is a line in the table and then again as "Discount". The three lines add up to
  $355.68 but "Subtotal" says $395.20. CRM is "5 at $23.20" with no word that this is $29 less the 20% bundle
  discount the picker showed as its own line. There is no seller name and address, and no place where my own
  address or tax ID would print. The test PDF is plain text with no logo.
- Great: the invoice repeats the picker: "CRM: 5 users x $29", "Bundle discount (20%) -$98.80", promo once,
  subtotal that equals the lines above it, then tax, total, paid. Seller and buyer blocks with address and tax
  ID. The test PDF carries the same header as the emails.

### 9. Nothing on the way in says why I should trust KitStak with my business (ui)

- Where: `/signup`, site `/pricing`, legal links, billing pages.
- Saw: no security line, no word on who runs payments until question 11 of the FAQ, no refund answer anywhere
  (search of the site, portal and billing package finds none). Terms and Privacy are about 300 words each and
  open inside the CRM app with CRM navigation. Billing pages have no "need help" contact.
- Great, with nothing invented: a quiet line under "Create account" such as "Card payments run on Stripe. We
  never see your card number." One FAQ answer and one line on the cancel page that state the refund rule,
  above all for yearly plans. Terms and Privacy on the marketing site with a billing section (renewal, cancel,
  refund, tax). A support address on billing home. Real customer proof when the owner has some.

### 10. Real Stripe has never been run (backend)

- Where: `packages/billing` Stripe adapter, `stripe:setup`, `/api/billing/webhooks/stripe`.
- Saw: every payment in this review and in the e2e suite went through the test gateway and fake clients. The
  decision says payments run on real Stripe. Hosted Checkout, wallets, the Billing Portal, live webhooks,
  Stripe's PDF and how our invoice page maps Stripe's lines are all unseen.
- Great: one recorded run in Stripe test mode. `stripe:setup check` prints all ok. Checkout with the working
  card, the declined card and the bank approval card. A promo code. A card update in the Billing Portal. A
  replayed webhook. For three carts, the Stripe total equals our quote to the cent. This needs test keys from
  the owner. Until then "production ready" is a claim, not a fact.

### 11. Small true things that add up (ui)

- Billing home, trial, no card: "Your first one arrives when your trial ends." No invoice arrives if no card
  is added. Say "with your first payment".
- The email sent when a pause is only planned has the subject "Your KitStak plan is paused". It should say
  the date it will pause.
- Billing activity listed "Riley Carter started checkout for CRM and WMS." four times in a row and logged
  one email out of six sent. Log each checkout once and log the receipts.
- With Pulse on and 8 people, the picker says "talk to us" and lets me go on. It never says which 5 people get
  Pulse. Say it, or let me choose.
- The confirm dialog for a paid change does not name the card that will be charged.
- The review screen for paying still shows the "Pick a plan" banner above it.

## Not blockers, but seen

- Other reviewers' captures show write buttons still looking live in a view only CRM. I could not check the
  refusal message myself. Worth a look by the apps lane: greyed buttons with a hint beat a click that fails.
- The integrator reports 5 failing WMS unit tests outside this work. They are not signup or billing, so I did
  not score them, but the gate is not green.
- Invites go one at a time. Slack takes a pasted list.

## What is already better than the best

Keep these exactly as they are.

- The price math in words, on the site, the picker, the review screen and "See the math".
- "You pay for 5 seats and use 1. Remove a seat to save $23.20 per month."
- The cancel page: the end date first, pause with real dates, one optional question, one click undo.
- The failed payment banner and email: amount, last 4, retry date, access date, one button.
- The seat prompt on invite: price first, then "Add seat and send invite".
- The wizard handoff: name, email and company arrive filled in, focus lands on the password, and the welcome
  plan opens already built from the answers.
- Light and dark, 360 px with no sideways scroll, sticky total on the phone picker.
