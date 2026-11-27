# Critic review, round 3: head to head scorecard

Date: 2026-11-24. Reviewer: the harsh critic (a buyer who has used Stripe, Linear, Shopify, Notion, Slack,
HubSpot and Vercel). Build: branch `mike/amazing-bell-llk3rq` at `6a0885c`.

**Verdict: not passed.** Score 23 of 30 with no zero. The bar in `research/COMPETITORS.md` section 6 is 24
or more with no zero. Round 1 was 20, round 2 was 22. Nine of the eleven round 2 blockers are closed, and
closed well: the WMS opens in one click, the launcher puts my apps first, a card field is two clicks from
"Pick a plan", the yearly sentence is right, guests and several invites work, and a bookkeeper can join for
free. Billing is the best I have used. What is left is smaller, and it is real: one confirm screen still gives
the wrong reason for its amount, the new long password rule lets in "passwordpassword" and calls it Good, the
billing only person meets a code wall and a dead end, and real Stripe has still never run. I am impressed. I
am not yet wowed from the first screen to the last, so this does not pass.

## How I tested

Real Chromium (Playwright) against the shared dev stack. Every server ran with
`ENTITLEMENTS_DEV_ALLOW_ALL=0` (I checked each process). I looked at every screenshot named here. Scripts and
screenshots are in `docs/billing/.review/critic3/` (not committed). I did not edit product code and did not
restart any server. I ran `deploy/dev/rate-limit-reset.sh` once, after the signup limit stopped my second
buyer (other reviewers were signing up from the same machine).

Three people, all made by signing up or by invite:

| Person | Path | What I did |
|:-|:-|:-|
| Dana, Whitlock Supply Co | Home "Start free", then the CRM card on `/pricing`, 1280 by 800 and 1440 by 900, light and dark | Every signup mistake, five weak long passwords, picker, refresh, wrong code, verify, welcome wizard, launcher, first WMS screen, CRM, billing home, picker in pay mode, pay page mistakes, promo, decline, bank approval, success, trial end, invoice, five plan change previews, invites (two at once, a guest, over the seat limit), billing team, failed renewal, email, pay now, update card, Projects lock screen, cancel, keep |
| Jo, Harborline Freight | Pulse card, 360 px phone, dark | Signup, picker, skip verify, skip welcome, launcher, tap targets, sideways scroll, Pulse first screen, trial end with no card, view only, verify, pay, how fast Pulse opens again |
| Priya, a bookkeeper | The "billing only" invite from Dana | Invite page, join, where she lands, what she can open, what blocks her |

Limits, stated plainly:

- No Stripe keys exist. Every payment went through the test gateway. See blocker 1.
- No Google or Microsoft keys exist, so those buttons were never on screen. See blocker 2.
- Competitor facts come from `research/COMPETITORS.md`, where most signup details are tagged as working
  knowledge, not verified.
- My first phone tap target numbers were taken after a full page capture and were wrong, the same trap as in
  round 2. Measured again without the capture: every button on the launcher, billing home and the picker is
  44 px or more at 360 px, with no sideways scroll.

## What round 2 asked for, and what happened

| # | Round 2 blocker | Now |
|:-|:-|:-|
| 1 | Yearly switch explained with the wrong sentence | Fixed. "$4,031.04 for the next year. Less $289.82 for the 22 full days left on your monthly plan." Then "$4,031.04 per year, starting Nov 24, 2027." The math lines add up to the cent. |
| 2 | A seat costs more to add than it gives back, unsaid | Fixed by saying it. Add: "For the 23 days left in this period." Remove: "That is for the 22 full days left in this period. A day that has started counts as used." The pricing page says the same rule. |
| 3 | WMS opens on 8 required fields | Fixed. Name and short code are filled in. One click to the WMS dashboard. Address and phone are optional. "Back to Portal" is there. |
| 4 | Launcher puts my app last | Fixed. Jo's "Open Pulse" tile is first, at 245 px down on a 360 px phone. The rest sit under "More apps" with the true added cost ("Then adds $17.40 per month with the bundle discount"). |
| 5 | Three screens before a card field | Fixed. "Pick a plan", "Continue to test checkout", card field. Two clicks, zero fields. The picker shows due today and the first charge. |
| 6 | Four password rules, no other way in | Half fixed. 15 characters or more now pass alone. That opened a new hole, see blocker 4. "Email me a code instead" was not built, and Google and Microsoft are still unseen, see blocker 2. |
| 7 | Guests have no door, roles have no price, one invite at a time | Fixed, and better than I asked. Guest is a role. Commas work. "Uses 2 of your 4 open seats. Your bill stays the same." Over the limit it sends the ones that fit and offers "Add 2 seats for $46.40 more per month. You pay $35.57 today for the days left." |
| 8 | Real Stripe never run | Open. See blocker 1. |
| 9 | Signup page gives no reason to sign up | Fixed. A real product screenshot, the four prices or my cart, three true promises, and "14 days free. No card needed." under the hero button. |
| 10 | The bookkeeper must hold a paid seat | Mostly fixed. "Invite someone for billing only. Free. No access to your apps." works by email and she lands in Billing. Her first minutes have two rough spots, see blocker 6. |
| 11 | Small true things | Mostly fixed: the success page fits, the support address is on every billing page, local links work, focus lands on the picker heading. The one minute lag in the apps is still there, see "Seen, not blockers". |

## Clicks and fields to first value

| Path | Screens | Fields typed | Clicks | Notes |
|:-|:-|:-|:-|:-|
| KitStak, home "Start free" to the launcher | 5: signup, picker, verify, welcome, launcher | 4 | 5 (start, create, start trial, later, skip) | Account made in 0.8 seconds, trial started in 0.8 seconds, on the dev box. No trip to the inbox. |
| KitStak, to a real WMS screen | 7 | 4 | 7 (the five above, "Open WMS", "Create warehouse") | Round 2 was 12 fields. Now 0 extra. |
| KitStak, "Pick a plan" to a card field | 2 | 0 | 2 | Round 2 was 3 |
| Linear | about 5 | 3, no password | about 5 | Needs a trip to the inbox first |
| Slack | about 5 | 4, no password | about 5 | Needs a trip to the inbox first |
| Stripe | 1, then the dashboard | 4, with a password | 1 | |
| Stripe Checkout, to a card field | 1 | 0 | 1 | |
| HubSpot | 8 to 10 | 8 or more | 10 or more | |

## Scorecard

0 is worse than most, 1 is on par with the best, 2 is better than the best.

| # | Question | Best in class | R1 | R2 | R3 | Why |
|:-|:-|:-|:-|:-|:-|:-|
| 1 | Time from signup to inside the product | Linear, Slack | 1 | 1 | 1 | Under a minute with no inbox trip. Still a password, and no Google or Microsoft button on screen. |
| 2 | Things asked before value | Linear (3) | 1 | 1 | 1 | 4 fields, and now 0 more for the WMS. One more than Linear. |
| 3 | Price obvious and the same everywhere | Slack, Linear | 1 | 2 | 2 | Site, signup panel, picker, pay page, success, billing home, invoice: the same to the cent, promo included. |
| 4 | Can I work out my bill in my head | Slack | 2 | 2 | 2 | "CRM: 5 users x $29 = $145 per month." Still the best I have seen. |
| 5 | Do I know what I pay today and next | Stripe Checkout | 1 | 1 | 2 | Due today, first charge with its date, then the amount, on the picker and the pay page. The yearly switch now reads right. |
| 6 | Does checkout feel safe and fast | Stripe Checkout | 1 | 1 | 1 | Two clicks, kind errors, typed values kept. Real Stripe is unseen. |
| 7 | How fair are seat changes | Slack | 2 | 1 | 1 | The rule is fair and now said out loud. Slack also finds idle seats for you. On par. |
| 8 | Could a charge ever surprise me | Slack | 0 | 1 | 1 | Every amount shown is the amount charged. But dropping to one app raises the price of the app I keep by 25%, and the screen calls that "what you add". |
| 9 | How clear is the billing page | Vercel | 2 | 2 | 2 | Five answers on first paint. One small contradiction in the seat line. |
| 10 | Invoices and tax details alone | Stripe Portal | 1 | 2 | 2 | Reads like the picker, adds up, one PDF. |
| 11 | What happens when a card fails | Stripe, Shopify | 2 | 2 | 2 | Banner with amount, last 4, retry date and access date. Email to the owner and the bookkeeper. "Pay now" fixed it in one click. |
| 12 | Leave, pause, come back | Stripe Portal | 2 | 2 | 2 | One page, end date first, pause, one click undo, the refund rule in plain words. |
| 13 | Can finance pay without being admin | Atlassian | 1 | 1 | 1 | Free, by email, no app access. On par now. The code wall and the dead end keep it from a 2. |
| 14 | One account for the whole suite | HubSpot, Atlassian | 2 | 2 | 2 | Projects lock screen names my price, 1 click to the picker with it switched on. One banner, one bill. |
| 15 | Would an 8th grader understand every screen | Slack | 1 | 1 | 1 | Nearly all. "Less $106.33 for what you add" when I add nothing, four green ticks for rules my password does not meet, and "1 of 5 used. Every seat is in use." would each stop one. |

Total: 23 of 30. No zero.

## Step by step against the best

| Step | KitStak today | Best in class | Who wins |
|:-|:-|:-|:-|
| Public price | Four cards, live calculator, 4 rules with the day rule said, FAQ | Slack and Linear tables | KitStak |
| Home page button | "Start free", "14 days free. No card needed." | Linear, Slack | Tie |
| Signup form | 4 fields, right autofill hints, focus on the first field, nothing cleared on error | Stripe 4 fields, Linear email only | Tie with Stripe. Loses to Linear, Notion, Slack, HubSpot, Shopify and Vercel on "Continue with Google". |
| Reasons to sign up on that page | Real screenshot, prices or my cart, three true promises | Shopify, HubSpot | Tie. No customer proof yet, and none should be invented. |
| Password | 15 or more characters pass alone | Stripe | Loses. Stripe refuses "passwordpassword". KitStak calls it Good. |
| Picker | Live math, trial end date, bundle price per app, survives a refresh | Atlassian calculator | KitStak |
| Verify email | 6 boxes, skip, change email, wrong code message | Slack code step | KitStak |
| First screen | 5 steps, my apps first | Shopify setup guide | Tie |
| First screen of the WMS | One click, everything filled in | Shopify admin | KitStak. The WMS rivals make you book a call. |
| Pay page | Summary beside the card, promo line, decline text, values kept | Stripe Checkout | Tie in test mode. Real Stripe unseen. |
| Seat change | Dialog names the days, the card and the date | Stripe preview API | KitStak |
| Monthly to yearly | Right total, right sentence, math adds up | Stripe preview API | KitStak |
| Remove an app | Right total, wrong reason, no word about the discount ending | Stripe preview API | Loses until blockers 3 and 8 are fixed |
| Invite the team | Several at once, guest free, seat cost before sending, sends what fits | Slack | KitStak |
| Bookkeeper | Free, by email, lands in Billing | Atlassian billing contact | Tie, once blocker 6 is fixed |
| Failed payment | Calm banner in every app, email with four facts, one click fix | Stripe, Shopify | KitStak |
| Cancel and pause | See line 12 | Stripe Portal | KitStak |
| Invoice | See line 10 | Stripe hosted invoice | KitStak |

## Blockers

Each one is something I saw. "Great" is what would make me drop it.

### 1. Real Stripe has never been run (backend)

- Where: `packages/billing` Stripe adapter, `stripe:setup`, `/api/billing/webhooks/stripe`, `GO-LIVE.md`
  "Open item 1".
- Saw: unchanged from rounds 1 and 2. Every payment in three reviews and in the e2e suite used the test
  gateway. Hosted Checkout, wallets, the Billing Portal card update, live signed webhooks, Stripe's invoice
  PDF and the future proration date are all unseen. `GO-LIVE.md` says so honestly, which is right. It is
  still the largest gap between "built" and "production ready".
- Great: the one hour run in `GO-LIVE.md` "Open item 1", recorded, in Stripe test mode, every line pass.
  This needs two values from the owner (`sk_test_...` and `whsec_...`). The team cannot close it alone, so
  say that to the owner in one line and ask for the keys.

### 2. The signup page still has only one door, and it needs a password (backend)

- Where: `/signup`, `/login`, `apps/portal/src/features/signup/social.ts`, the code flow in
  `apps/portal/src/server/auth.ts`.
- Saw: no "Continue with Google", no "Continue with Microsoft", no "Email me a code instead". The social
  buttons exist in code and hide with no keys, which is the right rule. But nobody has ever seen them work.
  Linear, Notion, Slack, HubSpot, Shopify and Vercel all show a Google button on the first screen. The
  fixers said plainly that "Email me a code instead" was not done.
- Great: one of two things, either is enough. A link under the password field, "Email me a code instead",
  that uses the 6 digit code we already send, so the code is both the sign in and the verification. Or a
  recorded run with Google and Microsoft test client keys that shows both buttons on `/signup` and `/login`,
  a new account made with each, and the same person signing in again.

### 3. Removing an app gives the wrong reason for its credit (backend)

- Where: `packages/billing` `change-words` (`creditNote`), shown in the confirm dialog on `/billing/plan`.
- Saw: Dana has CRM (5 users) and WMS (1 warehouse). "Remove WMS" says: "You get $183.49 credit on your next
  bill. That is $289.82 for the 22 full days left of what you take off, less $106.33 for what you add." She
  adds nothing. The $106.33 is her CRM going back to list price, because the 20% bundle discount needs two
  apps. "See the math" shows "KitStak CRM (5 users) for the 22 days left in this period $106.33" with no
  reason. Every number is right. The sentence is not.
- Great: "You get $183.49 credit on your next bill. $204.75 back for WMS, for the 22 full days left. Your
  CRM goes from $23.20 to $29 per user, because the bundle discount needs 2 apps. That takes $21.26 off the
  credit." Any wording works if it names the discount and every number adds up to $183.49. Never "what you
  add" when nothing is added. Add a unit test for a change that ends the bundle and one that starts it.

### 4. The 15 character rule lets in passwords every rival refuses (backend)

- Where: `packages/auth/src/password-policy-plugin.ts` (`passwordIssues`, the `passphrase` branch).
- Saw: the server accepts `passwordpassword`, `aaaaaaaaaaaaaaaa`, `123456789012345` and `qwertyuiopasdfgh`.
  Past 15 characters the only checks left are the length and "not your email name". I asked for the long
  password rule in round 2, so this hole is partly mine. It is still a hole. Stripe refuses these.
- Great: keep "15 or more characters is enough by itself". Add a small list of the things people really
  type: one character repeated, a short word repeated, straight runs like 1234 and qwerty, the 1,000 most
  common passwords, and the company name. Answer with one kind line: "That one is too easy to guess. Try a
  few words that do not go together." Tests for each case, and for "correct horse battery staple" passing.

### 5. The password meter says things that are not true (ui)

- Where: `/signup`, `/invite/...`, `/reset-password` (the strength meter and the four rule list).
- Saw: with "correct horse battery staple" the list shows four green ticks: "A capital and a small letter,
  done", "A number, done", "A symbol, done". None of those is in the password. With `passwordpassword` and
  `123456789012345` the meter says "Good". The form does not warn about the email name until I submit.
- Great: when the long rule is met, the four short rules fold away or read "Not needed". One green line
  stays: "15 or more characters. That is enough." The meter never says Good or Strong for a password the
  server would refuse or for a repeated or run password. The email name rule shows as I type.

### 6. The billing only person hits a code wall and a dead end (backend)

- Where: invite accept for the `billing` role (`/invite/[id]`, the verified email rule in
  `packages/billing/src/server/auth-hooks.ts`), Portal `/settings/organization`, CRM not found page.
- Saw: Priya opened the invite that was emailed to her, set a password and landed in Billing. Good. Then:
  a blue bar says "Enter the 6 digit code we emailed you", and `/billing/plan` is locked with "Verify your
  email first". She just proved the address by opening the invite. `core.user.email_verified` is false. So
  she gets two emails and types a code to do the one job she was invited for.
- Great: opening an invite link and joining with the invited address marks that address as verified, for
  every role. No second email, no blue bar. Slack and Linear treat an accepted invite this way. Keep the
  rule that the address cannot be changed on that page.

### 7. The billing only person is shown app setup she cannot do (ui)

- Where: Portal `/settings/organization` (setup guide), the app switcher, CRM `/[org]` not found page.
- Saw: Priya's Organization page shows "Set up Whitlock Supply Co, 4 of 5 done" with "Create your CRM
  workspace, Open CRM". She clicks it and the CRM says "This page doesn't exist. Check the address, or head
  back to your workspace." The invite page beside her password field shows "Prices after your 14 free days"
  for four apps she will never open.
- Great: a billing only person sees no setup guide and no app links in the Portal. If she reaches an app
  anyway, it says "You have billing access only. Ask an owner if you need this app." with "Back to Billing".
  Her invite page panel says what she is joining: "Whitlock Supply Co. Billing only. Free. You can pay
  bills, change the card and download invoices."

### 8. Nothing warns that the bundle discount ends (ui)

- Where: `/billing/plan` in change mode, the "Your new plan" panel and the confirm dialog title area.
- Saw: with two apps the panel says "The bundle discount stays as long as you have 2 or more apps." When I
  switch WMS off, that line just goes away. The panel shows "CRM: 5 users x $29 = $145" and nothing tells me
  my CRM price per user went up from $23.20 to $29. The same holds in the trial picker when a buyer drops
  to one app.
- Great: the moment the cart drops to one app, a calm line in the panel: "With 1 app the 20% bundle
  discount ends. CRM goes from $23.20 to $29 per user." The confirm dialog repeats it above the amounts.
  Adding a second app shows the mirror line, which the launcher tiles already do well.

### 9. The side panel on sign in pages sells a trial to people who are not buying (ui)

- Where: `apps/portal/src/app/(auth)/layout.tsx` and its panel, seen on `/login`, `/forgot-password`,
  `/verify-email`, `/invite/...`.
- Saw: "Prices after your 14 free days" with the four list prices shows beside "Welcome back" for a customer
  of two years, beside "Reset your password", beside the invite form for a teammate who will never pay, and
  on `/verify-email` after I had already picked CRM and WMS (my cart was gone from the panel and the list
  prices were back). On `/signup` the panel is right.
- Great: the panel fits the page. `/login` and `/forgot-password`: the screenshot and "One sign in for every
  KitStak app", no prices. `/verify-email`: my cart and "Your free trial ends on Dec 8, 2026." `/invite`:
  the name of the organization, who invited me and my role in plain words.

### 10. Small true things that add up (ui)

- Billing home, usage: "Seats: 1 of 5 used", a bar filled to one fifth, then "4 invites are waiting and
  each holds a seat. Every seat is in use." The headline and the bar say the opposite of the sentence.
  Great: "Seats: 5 of 5 in use. 1 person and 4 open invites." with the bar full, the invite part in a
  lighter shade.
- Welcome wizard, last step: it shows "1 of 5 done" and a green "Tell us about your business, Done". I left
  without pressing "Looks good". The launcher then said "0 of 5 done" and asked the three questions again.
  Great: save the answers when I answer them, or do not show Done before they are saved.
- Over the seat limit on the invite form: after "Invites sent to team1 and team2" the offer for the other
  two is there, but after a reload both the offer and the two addresses are gone, with no word that two
  people were not invited. Great: say it in the message ("2 people were not invited yet: ...") and keep
  them listed until I add seats or dismiss.
- Phone signup at 360 px: the rule list under the password pushes "Company or team" and "Create account"
  below the first screen. Great: one line of hint until I type, then the meter.
- Phone picker for a Pulse only buyer: CRM and WMS fill the first screen and Pulse, the app I chose, is
  fourth. The sticky total is right. Great: chosen apps first, as the launcher now does.
- "Too many tries. Wait a few minutes and try again." Great: say how long, "Try again in 4 minutes."
- The email field takes `dana@gmial.com` with no hint. Great: "Did you mean gmail.com?" as a one tap fix.

## Waiting on the owner (not counted against the team)

- Stripe test keys, and Google and Microsoft test client keys (blockers 1 and 2).
- `BILLING_SELLER_ADDRESS`: the invoice "From" block has a name and a site, no address.
- `BILLING_SUPPORT_REPLY_TIME`: no reply time is promised on the help line until it is set.
- The price flag. `PRICING_IS_PLACEHOLDER` is `false`, and its comment points to `DECISIONS.md` section 1,
  which says the owner chose the per product model. The brief for this review says only the Pulse price is
  owner confirmed. One of the two is out of date. Add one line to the `GO-LIVE.md` launch checklist: "The
  owner has confirmed the CRM, WMS and Projects prices in `catalog.ts`."

## Seen, not blockers

- The apps lag the Portal by about a minute. Three seconds after Jo's trial ended, Pulse showed no banner
  and opened the New job form. A few minutes later the banner and the view only dialog were there and were
  good. The same lag showed for the failed payment banner in the CRM. The direction that matters is fast:
  Pulse was fully open 2.5 seconds after Jo paid. In real use a trial ends by the clock, so nobody will see
  this. I asked for it in round 2 and I am letting it go.
- The test tool "Skip ahead" moves stored dates back instead of moving today forward. So an invoice reads
  "Nov 17, 2026" for an account made on Nov 24, and "Next charge" jumps from Dec 24 to Dec 17. One line
  under the test tools would save the next tester a puzzle. Test mode only.
- The home page hero card builds up one row a second. For the first second it is a white box with one row.
  With reduced motion it shows all six at once, which is right.
- Yearly plans still have no refund window. Notion gives 30 days. The rule is stated honestly. The owner
  decides.
- The Projects lock screen names the price per user ($9.60) and the launcher names the total ($48.00 per
  month). Both are true. One of them on both screens would be cleaner.
- The integrator reports 5 failing WMS unit tests that this work does not touch. Not scored. The gate is
  still not fully green.

## What is already better than the best

Keep these exactly as they are.

- The price math in words on the site, the picker, the pay page, the invoice and the PDF.
- The first WMS screen: a name already typed, one button, in.
- The launcher: my apps first, then "More apps" with the true added cost after the bundle discount.
- The invite form: several addresses, guest free, "Uses 2 of your 4 open seats", sends the ones that fit and
  asks before it adds seats, with the price for today and for each month.
- The confirm dialog for seats and for yearly: the days, the card, the date, and math that adds up.
- "Invite someone for billing only. Free. No access to your apps. Good for a bookkeeper."
- The failed payment banner and email, and "Pay now".
- The cancel page and the one click undo.
- The view only dialog in the apps: "You can still open, read and export everything."
- Paying after a trial ended: Pulse fully open 2.5 seconds later.
- Light and dark, 360 px with no sideways scroll, 44 px targets, the sticky total on the phone picker.
