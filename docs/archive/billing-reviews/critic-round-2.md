# Critic review, round 2: head to head scorecard

Date: 2026-11-24. Reviewer: the harsh critic (a buyer who has used Stripe, Linear, Shopify, Notion, Slack,
HubSpot and Vercel). Build: branch `mike/amazing-bell-llk3rq` at `8afe346`.

**Verdict: not passed.** Score 22 of 30 with no zero. The bar in `research/COMPETITORS.md` section 6 is 24
or more with no zero. Round 1 was 20 with one zero. The money screens now tell the truth: the promo code and
the account credit show on every screen and match the charge to the cent. That was the hard part and it is
done well. What is left is not about wrong money. It is about the first minutes (a password with four rules,
a WMS that opens on an 8 field form, a launcher that hides the app you came for), three screens to reach a
card field, two sentences about plan changes that do not say what really happens, and real Stripe still
unrun. I am impressed by billing. I am not wowed by the way in.

## How I tested

Real Chromium (Playwright) against the shared dev stack, with `ENTITLEMENTS_DEV_ALLOW_ALL=0`, so plan states,
lock screens and banners were real this time. I looked at every screenshot named here. Scripts and
screenshots are in `docs/billing/.review/critic2/` (not committed). I did not edit product code and did not
restart any server. I ran `deploy/dev/rate-limit-reset.sh` once after the signup limit stopped me.

Three fresh buyers, all made by signing up:

| Buyer | Path | What I did |
|:-|:-|:-|
| Riley, Carter Supply Co | Home page "Start free", then the `/pricing` cart, 1280 and 1440, light and dark | Every signup mistake, picker, refresh, change email, wrong code, verify, welcome, launcher, all four apps, billing home, picker, review, pay page mistakes, promo, two declines, bank approval, success, trial end, invoice and PDF, remove seats, add a seat, yearly preview, billing details and tax ID, pause, undo, cancel, keep, failed renewal, email, pay now, invite at the seat limit, add Projects from inside Projects |
| Jo, Harbor Freight Co | Pulse "Start free" card, 360 px phone, dark | Signup, picker with 8 people on Pulse, skip verify, skip welcome, launcher, billing, tap targets, sideways scroll, then trial end with no card and view only in Pulse |
| Sam, Fernleaf Goods | "Help me choose" wizard, handoff link, keyboard from the password on | Prefill, focus, Enter to submit, Tab to the trial button, welcome plan, day 3 banner in the CRM, "Pick a plan" from the banner, WMS first screen |

Limits, stated plainly:

- No Stripe keys exist. Every payment here went through the test gateway. See blocker 8.
- No Google or Microsoft keys exist, so the social buttons were never on screen. Not verified.
- Competitor facts come from `research/COMPETITORS.md`, where most signup details are tagged as working
  knowledge, not verified.
- The portal's Terms, Privacy and "Talk to us" links point at `https://kitstak.com`, which this machine cannot
  reach. I read the same pages on the local site (`localhost:3600`).
- My first phone tap target numbers were taken right after a full page capture and were wrong. I measured
  again without the capture: every target on the launcher, billing, picker and organization pages is 44 px or
  more at 360 px, with no sideways scroll.

## What round 1 asked for, and what happened

| # | Round 1 blocker | Now |
|:-|:-|:-|
| 1 | Promo taken but screens show the full first charge | Fixed. Pay page, success page, banner, billing home and invoice all say $355.68 with the promo as its own line. |
| 2 | Credit invisible, next charge wrong | Fixed. "Credit: $51.04. It comes off your next bill." Next charge "$274.56, after $51.04 credit". The renewal charged $274.56. Dialogs say "Paid from your credit". The cancel page says what happens to credit. |
| 3 | "Pick a plan" led to a page with no way to pick a plan | Fixed. One name, one filled button, "Continue to review". |
| 4 | Home page sent everyone down the long road | Fixed. "Start free" opens the 4 field signup. "Help me choose" is the second link. |
| 5 | Email typo cost the whole signup | Fixed. "Change email" keeps the account, the organization and the trial. A taken address gets a clear message. |
| 6 | Password hint named one rule of four | Half fixed. All four rules show before typing. There are still four rules. See blocker 6. |
| 7 | Setup guide said 5, then 8, then 12 | Fixed. 5 steps and 9 minutes on welcome, the launcher and settings. "Show all steps" holds the rest. |
| 8 | Invoice did not match the picker | Fixed. Same lines, subtotal adds up, promo once, seller and buyer blocks, address and tax ID, a clean PDF. |
| 9 | No trust signals | Mostly fixed. Stripe line under the button, refund answer in the FAQ and on the cancel page, Terms with billing sections on the site, a help line on every billing page. Support is still a form that opens your email app. See blocker 11. |
| 10 | Real Stripe never run | Open. See blocker 8. |
| 11 | Small untrue lines | Fixed, all six. |

## Clicks and fields to first value

| Path | Screens | Fields typed | Clicks | Notes |
|:-|:-|:-|:-|:-|
| KitStak, home page "Start free" | 5: signup, picker, verify, welcome, launcher | 4 | 5 (start, create, start trial, later, skip) | Account made in 0.7 seconds on the dev box |
| KitStak, to a first WMS screen | 6: the five above, then "Set up your warehouse" | 12 (4, then 8 more) | 7 | The 8 are required. One is a phone number. |
| KitStak, from "Pick a plan" to a card field | 3: picker, review, pay page | 0 | 3 | The same price lines show three times |
| Linear | about 5 | 3, no password | about 5 | Login link is the verification |
| Slack | about 5 | 4, no password | about 5 | One question per screen |
| Stripe | 1, then the dashboard | 4 | 1 | |
| Stripe Checkout, to a card field | 1 | 0 | 1 | |
| HubSpot | 8 to 10 | 8 or more | 10 or more | |

## Scorecard

0 is worse than most, 1 is on par with the best, 2 is better than the best.

| # | Question | Best in class | Round 1 | Round 2 | Why |
|:-|:-|:-|:-|:-|:-|
| 1 | Time from signup to inside the product | Linear, Slack | 1 | 1 | The home page now takes the short road. A password with four rules is still in the way. |
| 2 | Things asked before value | Linear (3) | 1 | 1 | 4 fields for the Portal, CRM and Pulse. The WMS asks 8 more before it shows anything. |
| 3 | Price obvious and the same everywhere | Slack, Linear | 1 | 2 | Site, signup panel, picker, review, pay page, success, banner, billing home, invoice and PDF agree to the cent, promo and credit included. |
| 4 | Can I work out my bill in my head | Slack | 2 | 2 | Still the best I have seen. |
| 5 | Do I know what I pay today and next | Stripe Checkout | 1 | 1 | True for the first payment and for seats. The yearly switch names an amount and then explains it with the wrong sentence. |
| 6 | Does checkout feel safe and fast | Stripe Checkout | 1 | 1 | The test page is kind and clear. Real Stripe is unrun, and it takes three screens to reach a card field. |
| 7 | How fair are seat changes | Slack | 2 | 1 | Still better than Notion, Linear and Atlassian. But the same seat on the same day costs $17.79 to add and gives $17.01 back, and no screen says why. Slack gives back what it takes. |
| 8 | Could a charge ever surprise me | Slack | 0 | 1 | Every amount I was shown is the amount I was charged. The two sentences in blockers 1 and 2 keep it from a 2. |
| 9 | How clear is the billing page | Vercel | 2 | 2 | Five answers on first paint, usage against paid, credit named. |
| 10 | Invoices and tax details alone | Stripe Portal | 1 | 2 | The invoice reads like the picker, adds up, prints my address and tax ID, and the PDF matches the screen. Clearer than a Stripe invoice. |
| 11 | What happens when a card fails | Stripe, Shopify | 2 | 2 | Banner in the Portal and the CRM, email with four facts, "Pay now" fixed it in one click. |
| 12 | Leave, pause, come back | Stripe Portal | 2 | 2 | Two clicks, pause with real dates, one click undo, the refund rule said out loud. |
| 13 | Can finance pay without being admin | Atlassian | 1 | 1 | The role is there. The bookkeeper still has to hold a paid seat. Atlassian and Slack billing contacts are free. |
| 14 | One account for the whole suite | HubSpot, Atlassian | 2 | 2 | Add Projects from inside Projects in 3 clicks with the price first, then "Back to Projects". One banner, one invoice. |
| 15 | Would an 8th grader understand every screen | Slack | 1 | 1 | Nearly all of it. "Guests are free" with no way to invite a guest, and the yearly sentence, would stop one. |

Total: 22 of 30. No zero.

## Step by step against the best

| Step | KitStak today | Best in class | Who wins |
|:-|:-|:-|:-|
| Public price | Four cards, live calculator, 4 billing rules, 12 questions with a refund answer | Slack and Linear tables | KitStak |
| Home page button | "Start free" to a 4 field form | Linear, Slack | Tie. No "No card needed" line under the hero button. |
| Signup form | 4 fields, right autofill hints, busy state in 120 ms, nothing cleared on error, cart kept | Stripe 4 fields, Linear email only | Tie with Stripe. Loses to Linear, Slack and Notion on the password. |
| Reasons to sign up on that page | A drawing of four tiles and "One login" | Shopify and HubSpot show the product and proof | Loses |
| Picker | Live math, trial end date, three trust lines, survives a refresh | Atlassian calculator | KitStak |
| Verify email | 6 boxes, skip, change email, wrong code message | Slack code step | KitStak now |
| First screen | 5 steps that stay 5, four tiles | Shopify setup guide | Tie on desktop. Loses on a phone for a one app buyer. |
| First screen of the WMS | A form with 8 required fields | Shopify drops you in the admin | Loses |
| Review before paying | Due today, first charge, date, "then each month" | Stripe Checkout | Tie on clarity. Loses on speed, 3 screens to 1. |
| Pay page | Summary beside the card, promo line, kind decline text, typed values kept | Stripe Checkout | Tie in test mode. Real Stripe unseen. |
| Seat change | Dialog names credit, card and date | Stripe preview API | KitStak, but see blocker 2 |
| Monthly to yearly | Right total, wrong sentence | Stripe preview API | Loses until blocker 1 is fixed |
| Failed payment | Calm banner in every app, email with four facts, one click fix | Stripe emails, Shopify banner | KitStak |
| Cancel and pause | See line 12 | Stripe Portal | KitStak |
| Invoice | See line 10 | Stripe hosted invoice | KitStak |
| Invite the team | One email at a time, roles with no price | Slack takes a pasted list | Loses |

## Blockers

Each one is something I saw. "Great" is what would make me drop it.

### 1. Switching to yearly explains $3,082.34 with the wrong sentence (ui)

- Where: confirm panel on `/billing/plan`, monthly to yearly.
- Saw: "Due today. $3,082.34 for the 23 days left in this period, less $51.04 paid from your credit. Charged
  to your Visa ending 3184. $3,031.30". An 8th grader reads that as three thousand dollars for 23 days. The
  amount is really one year at the new price, less the unused part of this month. "See the math" shows that,
  and its unused time lines are worked out on 22 days, not 23.
- Great: "Due today $3,031.30. One year at your new price is $3,321.12. You get $238.78 back for the unused
  part of this month, and $51.04 from your credit." Then "Then $3,321.12 per year, starting Nov 24, 2027." No
  "days left" wording on a change of billing period. The spec's own example in 6.3 reads this way.

### 2. A seat costs more to add than it gives back on the same day, and no screen says so (backend)

- Where: `packages/billing/src/proration.ts` (a charge rounds the days left up, a credit rounds them down)
  and the words on the confirm panel, the pricing page rule 2 and Terms section 4.
- Saw: on one day, "Add 1 seat" was "$17.79 for the 23 days left in this period". "Remove 1 seat" was "You
  get $17.01 credit on your next bill", with no day count. $17.01 is 22 days. The site says "You pay only for
  the days left" and "the unused part becomes credit". Slack's fair billing example gives back exactly what
  it takes.
- Great: one of two things. Either both directions use the same number of days (stop the free credit trick
  another way, such as no credit for a seat added in the last 24 hours). Or keep the rule and say it
  everywhere it applies: the panel reads "Credit for the 22 full days left", and the pricing page and the
  Terms say "A day that has started counts as used." A buyer who checks the math must get the same number we
  show.

### 3. The WMS opens on a wall of 8 required fields (ui)

- Where: WMS `/setup-warehouse`, the first screen a trial owner sees after "Open WMS".
- Saw: Warehouse name, Short code, Contact name, Street address, City, State, Postal code and Contact phone
  are all required. There is no trial line, no skip, no link back to the Portal and no app switcher. The
  signup promised 4 fields and "No phone". Sam chose "Start fresh" and Riley was offered "Explore sample
  data", and both met the same form. The WMS is the $349 app and the one where rivals make people wait for a
  sales call. This is where we should feel fastest.
- Great: one required field, the warehouse name, already filled with "Carter Supply Co warehouse". The short
  code stays filled in. Address, contact and phone are optional with "You can add these later in Settings".
  A "Back to Portal" link and the normal app frame. One click from "Open WMS" to a real WMS screen. Shopify
  asks for the business address when you pick a plan, not before.

### 4. The launcher puts the app you signed up for last (ui)

- Where: Portal launcher `/`.
- Saw: Jo signed up for Pulse only. On a 360 px phone the launcher shows the setup guide, then CRM "Not in
  your plan", WMS "Not in your plan", Projects "Not in your plan", and only then Pulse with "Open Pulse",
  about three screens down. At 1280 by 800 the Pulse tile is below the fold too. The first thing a new buyer
  sees under the guide is three things to buy.
- Great: tiles in the plan or trial come first, in the order the buyer picked them. The others sit below
  under a small heading such as "More apps", with their price as now. On a phone "Open Pulse" is on the first
  screen under the guide.

### 5. Three screens repeat the same math before a card field (ui)

- Where: "Pick a plan" from the banner or billing home, then `/billing/plan`, `/billing/checkout`, the pay
  page.
- Saw: click 1 opens the picker with my saved cart and a summary. Click 2 opens the review screen with the
  same summary. Click 3 opens the pay page with the same summary a third time, and now a card form. Stripe
  Checkout is one click to a card field. Linear and Vercel put the card form in the settings page.
- Great: two clicks at most. When the saved cart has not changed, "Pick a plan" goes straight to the review
  screen, which already has "Change my plan" for anyone who wants the picker. Or the picker in pay mode gains
  the "First charge" fact and its button goes to the pay page. Keep the three facts. Drop the repeat.

### 6. Signup still needs a password with four rules, and there is no other way in (backend)

- Where: `/signup`, `/reset-password`, `/invite/...`, the shared password policy in `packages/auth`.
- Saw: "correct horse battery staple", 28 characters, is rated "Fair" and refused: "Your password still
  needs a capital letter and a number." The four rules are honest now, and they are still four rules. Linear,
  Slack and Notion ask for no password. Stripe asks for one with no make up rules. Google and Microsoft sign
  in could not be seen, because no keys exist.
- Great: any password of 15 characters or more passes with no other rule (the meter can still nudge). Better:
  a link "Email me a code instead" that uses the 6 digit code flow we already have, so the code is both the
  sign in and the verification. And one recorded run with Google and Microsoft test keys that shows both
  buttons working on `/signup` and `/login`.

### 7. "Guests are free" has no door, roles have no price, and invites go one at a time (ui)

- Where: `/settings/organization` "Invite someone", reached from setup guide step 2.
- Saw: the pricing FAQ, the picker and billing home all say "Guests are free". The invite form offers Admin,
  Member and Viewer. All three use a paid seat (`usesSeat('viewer')` is true in `packages/billing`) and the
  form says nothing about that. A read only Viewer costs the same as an Admin. Vercel viewers are free. I
  pasted two addresses with a comma and got "Enter a valid email address."
- Great: a line under Role: "Admin, Member and Viewer each use 1 seat. Guest is free." Guest is in the list,
  or a link says where guests are invited. The field takes several addresses. Before sending, one line says
  what it does to the plan: "Uses 1 of your 3 free seats", or the seat prompt that already exists.

### 8. Real Stripe has never been run (backend)

- Where: `packages/billing` Stripe adapter, `stripe:setup`, `/api/billing/webhooks/stripe`.
- Saw: unchanged from round 1. Every payment in both reviews and in the e2e suite used the test gateway.
  Hosted Checkout, wallets, the Billing Portal card update, live webhooks, Stripe's own invoice PDF, and the
  future proration date the integrator flagged are all unseen.
- Great: the run in `GO-LIVE.md` "Open item 1", recorded, in Stripe test mode. `stripe:setup check` all ok.
  Checkout with the working card, the declined card and the bank approval card. A promo code. A card update
  in the Billing Portal. A replayed webhook. For three carts, Stripe's total equals our quote to the cent.
  This needs test keys from the owner. Until then "production ready" is a claim.

### 9. The signup page does not make me want to sign up (ui)

- Where: site home hero, Portal `/signup` right panel.
- Saw: the form is clean. The panel beside it is a drawing of four tiles with "One login. Every KitStak app
  your team runs on." When I arrive from the home page it shows no price, no product and no reason. The hero
  button on the home page has no "14 days free. No card needed." line near it. The pricing page says it, the
  hero does not.
- Great, with nothing invented: the line under the hero button. On the signup panel, three true promises a
  buyer cares about, each already kept by the product: "See your exact price before you start", "Cancel in
  two clicks. Pause for 1 to 3 months", "Nothing is deleted when a trial ends". A real screenshot of each
  chosen app, not a drawing. With no cart, the four list prices. Real customer proof the day the owner has
  some.

### 10. The person who pays the bills must hold a paid seat (backend)

- Where: `/billing/team`, `/settings/organization`.
- Saw: "Add a billing manager" lists only people already on the team. With one person it says "Invite
  someone new in Organization", and that form offers only paid roles. So giving the bookkeeper the card and
  the invoices costs $23.20 a month and hands them the apps too. The page itself tells me to "Add a second
  person so billing never gets stuck."
- Great: "Add a billing manager" takes an email address right on the Billing team page. That person gets
  Billing and nothing else, uses no seat, and the page says so: "Billing only. Free. No access to your apps."
  Atlassian and Slack billing contacts work this way.

### 11. Small true things that add up (ui)

- `/verify-email` breaks the address in the middle of a word: "carter-su" and "pply.example" on two lines.
- `/billing/checkout/success` at 1280 by 800: two bars stack on top and "Open my apps" is cut by the fold.
- For up to 60 seconds after a trial ends, an app shows no banner and opens its create form as if nothing
  happened (I opened "New job" in Pulse). The server would refuse the save. The screen should not lag the
  truth by a minute: clear the cache when the end date passes, or check the date on each read.
- "Talk to us" on every billing page opens a site form whose button "Opens your email app". No reply time is
  promised. Great: the support address on the billing page itself, and a reply time the owner can keep.
- In local dev the Portal's Terms, Privacy and "Talk to us" links go to `https://kitstak.com`, not to the
  local site as `DEV.md` says. A reviewer cannot follow them.
- Arriving on the picker by keyboard, focus is on the page body. It took 12 Tab presses to reach "Start my
  free trial". Put focus on the heading or the first app row.
- The invoice seller block reads "KitStak LLC, kitstak.com" with no address. The owner must set the legal
  name and address before launch (`BILLING_SELLER_*`).

## Not blockers, but seen

- Yearly plans have no refund window at all. Notion gives 30 days on a yearly plan. The rule is stated
  honestly, which is what I asked for. Whether to match Notion is the owner's call.
- The test tool "Make the next payment fail" followed by "Skip ahead 30 days" fails the charge and then
  retries it with success in the same step, so the page shows nothing wrong. Skipping to the exact renewal
  day shows the failed state. A line under the tool would save the next tester ten minutes.
- The welcome email goes to the first address when the buyer fixes a typo with "Change email". The new
  address gets the code but never the welcome.
- WMS dev console shows two "Could not validate instant" errors on `/dashboard` on the way to the setup
  form.
- The integrator reports 5 failing WMS unit tests and 1 flaky Pulse test outside this work. Not signup or
  billing, so not scored, but the gate is not green.

## What is already better than the best

Keep these exactly as they are.

- The price math in words, on the site, the picker, the review screen, the pay page, the invoice and the PDF.
- The promo code and the credit as named dollar lines on every screen that shows a charge.
- "You pay for 5 seats and use 1. Remove a seat to save $23.20 per month."
- The cancel page: the end date first, what happens to credit, pause with real dates, one optional question,
  one click undo, the refund rule in plain words.
- The failed payment banner and email: amount, last 4, retry date, access date, one button.
- "Change email" on the verify screen, with the trial and the organization kept.
- The lock screen inside an app: the real price with the bundle discount, 3 clicks, then "Back to Projects".
- The view only dialog before a form opens: "You can still open, read and export everything."
- No trial banner on day one. Nobody is asked to pay a minute after a "no card needed" signup.
- Light and dark, 360 px with no sideways scroll, 44 px targets, sticky total on the phone picker.
