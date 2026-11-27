# Critic review, round 5: head to head scorecard

Date: 2026-11-24. Reviewer: the harsh critic (a buyer who has used Stripe, Linear, Shopify, Notion, Slack,
HubSpot and Vercel). Build: branch `mike/amazing-bell-llk3rq` at `d369b03`.

**Verdict: not passed.** Score 25 of 30 with no zero. The bar in `research/COMPETITORS.md` section 6 is 24
or more with no zero, and this is the first round that clears it. Round 1 was 20, round 2 was 22, round 3
and round 4 were 23. Four of the five round 4 blockers are closed, and I checked each one in the browser.
The billing side is the best I have used: I would pick it over the Stripe portal, Slack and Vercel. It is
still not a pass, for two reasons. Real Stripe has never run, so the one screen where money really moves is
unseen. And six gaps are left where a rival is as good or better, or where the product takes a wrong turn.
None is large. All are listed below with what great looks like.

## How I tested

Real Chromium (Playwright) against the shared dev stack, with `ENTITLEMENTS_DEV_ALLOW_ALL=0` in every app,
plus the production build with no keys on port 3310. I looked at the screenshots named here. Scripts, output
and screenshots are in `docs/billing/.review/critic5/` (not committed). I did not edit product code, did
not restart a server and did not reset rate limits.

Four people, all made by signing up or by invite:

| Person | Path | What I did |
|:-|:-|:-|
| Dana, Cedar Point Supply | `/pricing` calculator (CRM and WMS, 5 seats), then a password, 1280 by 800, light | Empty form, typo domain, bad email, 7 weak passwords, company name in the password, an email that exists, picker switches, yearly, start trial, wrong code, pasted code with a space, welcome wizard, launcher, first screen of all four apps, billing home, picker to pay, empty pay form, made up card, bad promo, good promo, decline, success, trial end, invoice and PDF, remove 2 seats and add Pulse, remove WMS (read, not confirmed), all apps off, 3 invites over the seat limit, billing team, details, activity, cancel, undo, a failed renewal, the banner in CRM, WMS and Pulse, view only, a blocked write in the WMS, "Pay now" with a bad card, update card, back to the WMS, add Projects from inside Projects, password sign in to a CRM deep link |
| Lee, Tidewater Crating | "Start with Pulse" link, "Email me a code instead", 360 px phone, dark | Signup with no password, picker, verify, skip welcome, launcher, sign out, a Pulse deep link, sign in with a code, reload on the code step, wrong code, My account, trial end with no card, Pulse view only, pay from inside Pulse with a card that needs bank approval |
| Ana, a teammate | The invite email from Dana | Invite page, join, launcher, Billing, the Projects lock screen |
| Pat, Lakeshore Fixtures | Production build with no keys, port 3310 | Signup, picker, trial, billing home, picker in pay mode, the dev outbox address |
| Nobody | Signed out | Home and pricing at 1280 light and 360 dark, `/signup` in four shapes, `/login`, the sign in and forgot password addresses of the other apps, Terms, Privacy, the 14 email templates, tab order on signup |

Limits, stated plainly:

- No Stripe keys exist. Every payment went through the test gateway. See blocker 1.
- No Google or Microsoft keys exist, so those buttons were never on screen.
- Competitor facts come from `research/COMPETITORS.md`, where most signup details are tagged as working
  knowledge, not verified.
- The test tool "Skip ahead" moves stored dates back, so invoices and activity show dates before the account
  was made. Test mode only.
- I did not walk the bookkeeper path again. Round 4 walked it end to end. This round I read the billing
  team page only. Line 13 keeps its round 4 score on that basis.
- Other reviewers ran on the same machine at the same time. Machine times below are from a busy dev box.

## What round 4 asked for, and what happened

| # | Round 4 blocker | Now |
|:-|:-|:-|
| 1 | Real Stripe never run | Open. See blocker 1. |
| 2 | WMS and Pulse banner button greyed out, dead on the first click | Fixed. In a view only WMS, Pulse and CRM the banner button is a plain link at full strength, with no `data-plan-write`, and one click lands on the Portal. A blocked write ("Add client") opens the calm dialog with the same words and the same button. |
| 3 | Five sign in pages, four with no code door | Fixed. `/login` on the CRM, WMS and Projects and `/forgot-password` on Pulse and the CRM all go to the Portal. A signed out visit to `localhost:3500/jobs?status=open` went to the Portal with the full address in `next`. I signed in with a code and landed on that exact page 2.2 seconds later. A reload on the code step kept the code field and sent no second email. My account exists and says "You have no password. You sign in with a 6 digit code we email you. That keeps working." It opened one small fault, see blocker 3. |
| 4 | Company name in the password refused with no reason | Fixed. `CedarPoint#2026!` shows "Do not use your company name in your password." right under the field, as I type and after I press the button. |
| 5 | Invite emails wait for the one minute job | Fixed. Both invite rows were `sent` with a send time when the page said "Invites sent". |

## Clicks and fields to first value

| Path | Screens | Fields typed | Clicks | Notes |
|:-|:-|:-|:-|:-|
| KitStak with a password, pricing calculator to the launcher | 5: signup, picker, verify, welcome, launcher | 4 | 4 (create, start trial, later or the code, skip) | The cart is already filled in. 0.6 seconds from "Create account" to the picker. |
| KitStak with a code, product link to the launcher, 360 px | 5 | 3, no password | 4 | 6.1 seconds of machine time in total. |
| KitStak, launcher to a real WMS screen | 2 more | 0 | 2 ("Open WMS", "Create warehouse") | 2.9 seconds. The dashboard opens with 2 of 5 setup steps already done. |
| KitStak, "Pick a plan" to a card field | 2 | 0 | 2 | |
| KitStak, sign in again with a code, from a deep link in another app | 1 | 1 plus the code | 1 | Lands on the page I asked for. |
| KitStak, a teammate joins from the invite email | 1 | 2 (name and a password) | 1 | 1.1 seconds. No code door here, see blocker 2. |
| KitStak, view only Pulse to paid and open again | 3 | 0 (test card chip) | 5 | 9.3 seconds with the bank step. |
| Linear | about 5 | 3, no password | about 5 | Needs a trip to the inbox first |
| Slack | about 5 | 4, no password | about 5 | Needs a trip to the inbox first |
| Notion, Vercel with Google | about 3 | 1 or 2 | about 4 | One click sign in. KitStak cannot show this without keys. |
| Stripe Checkout, to a card field | 1 | 0 | 1 | |
| HubSpot | 8 to 10 | 8 or more | 10 or more | |

## Scorecard

0 is worse than most, 1 is on par with the best, 2 is better than the best.

| # | Question | Best in class | R1 | R2 | R3 | R4 | R5 | Why |
|:-|:-|:-|:-|:-|:-|:-|:-|:-|
| 1 | Time from signup to inside the product | Linear, Slack | 1 | 1 | 1 | 1 | 1 | 3 fields and no forced inbox trip beats Linear and Slack. A buyer on Google Workspace is still faster on Notion or Vercel with one click, and nobody has seen ours. |
| 2 | Things asked before value | Linear (3) | 1 | 1 | 1 | 1 | 1 | 3 with a code, 4 with a password. The same as Linear. |
| 3 | Price obvious and the same everywhere | Slack, Linear | 1 | 2 | 2 | 2 | 2 | $395.20 on the pricing page, the signup panel, the picker, the pay page, billing home and the invoice. Promo and yearly agree too. |
| 4 | Can I work out my bill in my head | Slack | 2 | 2 | 2 | 2 | 2 | "CRM: 5 users x $29 = $145 per month." Still the best I have seen. |
| 5 | Do I know what I pay today and next | Stripe Checkout | 1 | 1 | 2 | 2 | 2 | Due today, first charge with its date, then the amount. With a promo: "$355.68 on Dec 8, 2026", then "After that first charge, $395.20 each month". |
| 6 | Does checkout feel safe and fast | Stripe Checkout | 1 | 1 | 1 | 1 | 1 | Two clicks, kind errors, every typed value and the promo kept after a decline. Real Stripe is unseen. |
| 7 | How fair are seat changes | Slack | 2 | 1 | 1 | 1 | 1 | One rule, said out loud, amount first. Slack gives the credit without being asked. |
| 8 | Could a charge ever surprise me | Slack | 0 | 1 | 1 | 2 | 2 | Three invites with two open seats: two went out, the third waited behind "Add 1 seat for $23.20 more per month. You pay $0.78 today". |
| 9 | How clear is the billing page | Vercel | 2 | 2 | 2 | 2 | 2 | Five answers on first paint at 1280 by 800, in every state I put it in. |
| 10 | Invoices and tax details alone | Stripe Portal | 1 | 2 | 2 | 2 | 2 | List, page, PDF, details, all self serve. |
| 11 | What happens when a card fails | Stripe, Shopify | 2 | 2 | 2 | 1 | 2 | The same calm banner with four facts in the Portal, CRM, WMS and Pulse. One click to the Portal from each. Paid and open again 3.8 seconds after I saved a good card, with "Back to WMS". One extra click is left, see blocker 4. |
| 12 | Leave, pause, come back | Stripe Portal | 2 | 2 | 2 | 2 | 2 | Two clicks, end date first, pause with its dates, the credit rule, one click undo. |
| 13 | Can finance pay without being admin | Atlassian | 1 | 1 | 1 | 2 | 2 | Not walked again this round. The team page still offers the free billing only invite. |
| 14 | One account for the whole suite | HubSpot, Atlassian | 2 | 2 | 2 | 1 | 2 | One front door now. One banner, one lock screen, one bill. Projects added from inside Projects in 3 clicks with "Back to Projects". |
| 15 | Would an 8th grader understand every screen | Slack | 1 | 1 | 1 | 1 | 1 | Nearly all. The plan change sentence in blocker 4 and "Ask Dana Whitfield to manage billing" would each stop one. |

Total: 25 of 30. No zero.

## Step by step against the best

| Step | KitStak today | Best in class | Who wins |
|:-|:-|:-|:-|
| Public price | Four cards, live calculator, 4 rules, 12 questions | Slack and Linear tables | KitStak |
| Home page button | "Start free", "14 days free. No card needed." | Linear, Slack | Tie |
| Signup form | 4 fields, or 3 with a code. Right autofill hints, focus on the first field, sane tab order, nothing cleared on error, "Did you mean gmail.com?" | Linear email only, Stripe 4 fields | Beats Stripe. Ties Linear. Loses to Notion, Slack, HubSpot, Shopify and Vercel on "Continue with Google" until keys are set. |
| Does the signup page make me want it | A real screenshot of the app I picked, my cart, three true promises | Shopify, HubSpot | Loses. It makes me feel safe. It does not make me want it. See blocker 6. |
| Mistakes on signup | Four kind lines at once, focus on the first, the reason named for a refused password, a "Sign in" link for a used email | Stripe | KitStak |
| Picker | Live math, trial end date, bundle price per app, sticky total on a phone | Atlassian calculator | KitStak |
| Verify email | 6 boxes, a pasted code with a space works, skip, change email, my cart beside it | Slack code step | KitStak |
| First screen | 5 steps, my apps first, true cost of each extra app | Shopify setup guide | Tie |
| First screen of the WMS | One click, everything filled in, then a dashboard with 2 of 5 steps done | Shopify admin | KitStak |
| Pay page | Summary beside the card, promo line, decline text, values kept | Stripe Checkout | Tie in test mode. Real Stripe unseen. |
| Change the plan | Title built from the change, amount first, credit named, focus goes back to the button | Stripe preview API | KitStak, once the long sentence is fixed |
| Add an app from inside an app | 3 clicks from the lock screen, right amount, "Back to Projects" | HubSpot | KitStak |
| Invite the team | Several at once, guest free, seat cost first, sends what fits, email goes out at once | Slack | KitStak |
| A teammate joins | Name and a password with strict rules | Slack (name and password), Linear and Notion (no password) | Tie with Slack. Loses to Linear and Notion. See blocker 2. |
| A member wants an app | "Ask Dana Whitfield to add it." and a button to a page that says it again | Atlassian "Request access", Notion "Request to upgrade" | Loses. See blocker 5. |
| Failed payment | Calm banner in every app, four facts, grace date, paid and open in seconds | Stripe, Shopify | KitStak |
| Sign in again | One page for the suite, password or code, back to the page I asked for | Linear, Slack, Notion | Tie. Three console errors on the way, see blocker 3. |
| Cancel and pause | One page, pause, reasons, undo, refund rule in plain words | Stripe Portal | KitStak |
| Invoice | List, page, PDF | Stripe hosted invoice | KitStak |
| Billing off in production | "Billing is not available right now. Nothing will be charged." and the pay button is off | none of them say it this plainly | KitStak |

## Blockers

Each one is something I saw. "Great" is what would make me drop it.

### 1. Real Stripe has never been run (backend)

- Where: `packages/billing` Stripe adapter, `stripe:setup`, `/api/billing/webhooks/stripe`, `GO-LIVE.md`
  "Open item 1".
- Saw: unchanged from rounds 1 to 4. `apps/portal/.env.local` has no Stripe value that is switched on.
  Every payment in five reviews and in the 71 browser tests used the test gateway. Hosted Checkout, wallets,
  the tax ID field, the Billing Portal card update, live signed webhooks, Stripe's invoice PDF and the
  proration dates are all unseen. The signup page says "Card payments run on Stripe". Nobody has watched
  one do so.
- Great: the one hour run in `GO-LIVE.md` "Open item 1", recorded, in Stripe test mode, every line pass.
  This needs two values from the owner (`sk_test_...` and the `whsec_...` from `stripe listen`). The team
  cannot close it alone.

### 2. A teammate must invent a password to join, though the invite link already proves the mailbox (backend)

- Where: `/invite/[invitationId]` in the Portal, and the accept path behind it in `packages/billing`
  (`auth-hooks.ts`) and `apps/portal/src/server`.
- Saw: Ana opened the link from her invite email. The page asked for a full name and a password, with the
  full rule list (15 characters, or 10 with a capital, a number and a symbol). There is no "Email me a code
  instead" on this page. The signup page and the sign in page both have it. So the owner can start with no
  password, and every person the owner pays a seat for cannot. In a team of five this is the page four of
  the five people meet first. The link in the email carries a secret (`?t=`), so the mailbox is already
  proven. Linear and Notion let an invited person in with no password. For a warehouse team on phones, a 15
  character password is the hardest thing on the whole path.
- Great: the join form is one field, "Full name", and the button "Join Cedar Point Supply". Under it, one
  quiet row: "Want a password too? Set a password". The emailed link is the proof, so the address is marked
  verified and the person signs in with a code next time, exactly as My account already explains. A browser
  test: invite, open the emailed link, type a name, press Join, land on the launcher, sign out, sign in with
  a code.

### 3. Every sign in that goes back to another app logs three console errors (ui)

- Where: `apps/portal/src/app/(auth)/login/login-form.tsx`, the two `router.replace(destination)` calls
  (lines 161 and 184, the password path and the code path).
- Saw: a signed out visit to `localhost:3100/cedar-point-supply/crm/pipeline` sends me to the Portal sign in
  with the full address in `next`. After a good password, and after a good code, the browser console shows
  "Access to fetch at 'http://localhost:3100/...?_rsc=...' from origin 'http://localhost:3300' has been
  blocked by CORS policy", then "Failed to load resource: net::ERR_FAILED", then "Failed to fetch RSC
  payload ... Falling back to browser navigation." The page does arrive, by the fallback. It happened on
  both tries, to the CRM and to Pulse. The gate's console check did not cover a sign in with another app in
  `next`. This is now the main way into four of the five apps.
- Great: when the place to go is a full address on another origin, the form uses a plain browser move
  (`window.location.assign`), and the router only for Portal paths. The browser test for the one front door
  also fails on any console error.

### 4. Three wrong turns on the money path (ui)

- Where: `planNoticeFor` and `billingLink` in `packages/billing` (the banner button), billing home
  `?fix=payment`, `apps/portal/src/app/(app)/billing/checkout/success/page.tsx`,
  `apps/portal/src/features/billing/plan-picker/change-confirm.tsx`.
- Saw, one: in a view only WMS I pressed "Update card" in the banner. I landed on billing home, where three
  more buttons say "Update card" (the banner, the Plan card and the Payment method card). I had to press one
  of them to see a card field. `COMPETITORS.md` must have 10 says "Update card opens the payment update
  screen directly." The link in a Stripe failed payment email does.
- Saw, two: in a view only Pulse I pressed "Pick a plan" in the banner (`/billing/plan?from=pulse`), paid,
  and the success page offered "Open my apps" and "See my plan". Pulse was one more screen away. After a
  card update the page says "Back to WMS", and after adding an app it says "Back to Projects". Only the
  first payment forgets where I came from.
- Saw, three: the confirm dialog for "Add Pulse and remove 2 seats" explains the credit with "That is $44.85
  for the 29 full days left at your old prices, less $22.43 for the same days at your new prices." That is
  26 words, over the 20 word rule. It is also not what happened: $44.85 is for the 2 seats I gave back, not
  for my old prices.
- Great: the banner's "Update card", in every app and in the email, opens the card form itself and comes
  back to billing home with "Back to WMS". The success page shows "Back to Pulse" as its main button when I
  came from Pulse. The dialog says "$44.85 back for 2 seats. $22.43 for Pulse. Both are for the 29 full
  days left."

### 5. A member is told to ask the owner and is given no way to ask (ui)

- Where: the launcher tile for an app that is not in the plan, the member view of `/billing`, and the lock
  screen in each app (`planLockFor`, the "Cannot manage" row).
- Saw: Ana, a member, sees Projects on the launcher with "Ask Dana Whitfield to add it." and a button "See
  Billing". The button opens a page with one card: "Cedar Point Supply has an active plan. Ask Dana
  Whitfield to manage billing." So the button leads to the same sentence. "Ask Dana Whitfield to manage
  billing" also reads as if Ana should ask Dana to start managing it. The Projects lock screen says "Ask
  Dana Whitfield to add it." with "Back to Portal". Atlassian has "Request access" and Notion has "Request
  to upgrade": one click and the admin gets the ask. Round 4 saw this and let it go. It is the one place in
  the flow where a person who wants to bring the company more business is stopped.
- Great: the tile and the lock screen have one button, "Ask Dana to add Projects". One click sends Dana a
  short email through the existing sender ("Ana Reyes asked for Projects. It adds $28.80 per month." with
  the button "Add Projects" to the picker), at most once a day per app, and the button turns into "Asked
  today". The member's Billing card says "Dana Whitfield manages billing for Cedar Point Supply." and
  nothing leads to a page that repeats the page before it.

### 6. The signup page makes me feel safe, not eager (ui)

- Where: `apps/portal/src/app/(auth)/_components/auth-hero.tsx` and `apps/portal/public/signup/*.webp`.
- Saw: the right half of `/signup` is one static screenshot, about 520 px wide, of a dense dashboard. No
  word in it can be read. There is one set of four images, all light, so in the dark theme a white picture
  sits on a black page (`shots/29-signup-wms-dark.png`). The three small pictures under it look like
  buttons and are not. No line says what I get, only what it costs ("Prices after your 14 free days"). On a
  phone there is no product at all, only the form. The home page has a live pick list, a board that
  switches views and a stack builder. None of that life reaches the page where I decide. Shopify and
  HubSpot sell the outcome beside the form. This page sells the terms.
- Great: one short true line above the picture, tied to the app in my cart ("Your warehouse on screen in
  one click." "Every deal on one board."). A dark set of screenshots for the dark theme. The small pictures
  are buttons that swap the big one, so I can look at all four apps without leaving. The big picture is
  cropped to one part of the screen so its words can be read at 520 px. On a phone, the line and one small
  picture sit above the form. Nothing invented: no logos, no quotes, no counts.

## Waiting on the owner (not counted against the team)

- Stripe test keys (blocker 1), and Google and Microsoft test client keys. The social buttons are the
  fastest door on six of the seven rivals, and nobody has seen ours work.
- The Pulse pricing oddity from round 4 still shows honestly: with Pulse alone, the launcher says Projects
  "adds $3.80 per month with the bundle discount" for one seat, because the 20% comes off Pulse too. The
  owner should decide if that is wanted.
- `BILLING_SELLER_ADDRESS` and `BILLING_SUPPORT_REPLY_TIME` are not set. The invoice shows "KitStak LLC,
  localhost:3600" under "From".
- The owner has confirmed only the Pulse price. The CRM, WMS and Projects prices need a yes before launch.

## Seen, not blockers

- The pay page answers an empty form and a made up card with the same line: "Use one of the test cards on
  this page. Real cards do not work in test mode." Fine for a test page.
- Adding Pulse alone would cost $23.20 for the days left (today counts). Adding Pulse while removing seats
  counted it at $22.43 (29 days). Both favor the customer or follow the stated rule, but the two numbers for
  the same app on the same day differ by 77 cents.
- My account shows the email and no way to change it. A typo can be fixed on the verify step only.
- The production build with no mail key says "We sent a 6 digit code" while the mail stays queued. The go
  live list catches the missing key. The screen should not say "sent" before then.
- The home page hero card still builds one row a second with a white gap in the middle.
- On the phone signup page a strip of the page color shows under the footer.
- A member sees the setup step "Set your labor cost per hour".
- The welcome wizard is four screens for a person who came from the pricing page. "Skip for now" is on
  every one.
- The integrator reports 5 failing WMS unit tests that this work does not touch. Not scored.

## What is already better than the best

Keep these exactly as they are.

- The price math in words on the site, the picker, the pay page, the invoice and the PDF.
- "Email me a code instead": 3 fields, no password, and one sign in page for five apps that lands on the
  page I asked for.
- The password field: one honest line, and the reason named when it says no.
- The first WMS screen: a name already typed, one button, in.
- The launcher: my apps first, then "More apps" with the true added cost.
- The invite form: several addresses, guest free, sends the ones that fit, asks before it adds a seat.
- The plan change dialog: a title that names the whole change, the amount first, nothing charged until yes.
- The failed payment banner in every app, "Pay now" with the decline shown under the button, and "Card
  updated. Your payment went through. Back to WMS".
- The cancel page and the one click undo.
- "Billing is not available right now. Nothing will be charged." in production with no keys.
- Light and dark, 360 px with no sideways scroll, the sticky total on the phone picker.
