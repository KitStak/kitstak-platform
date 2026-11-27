# Critic review, round 4: head to head scorecard

Date: 2026-11-24. Reviewer: the harsh critic (a buyer who has used Stripe, Linear, Shopify, Notion, Slack,
HubSpot and Vercel). Build: branch `mike/amazing-bell-llk3rq` at `61081d9`.

**Verdict: not passed.** Score 23 of 30 with no zero. The bar in `research/COMPETITORS.md` section 6 is 24
or more with no zero. Round 1 was 20, round 2 was 22, round 3 was 23. Nine of the ten round 3 blockers are
closed, and most are closed better than I asked. The signup page now has a second door with no password. The
remove an app dialog names the bundle discount and adds up to the cent. The bookkeeper joins with one email
and sees only Billing. The password meter tells the truth. Two lines went up. Two lines went down, because
this round I found two real faults that sit right on the money path: in the WMS the "Update card" and "Add
WMS" buttons in the banner look switched off and do not go anywhere on the first click, and a person who
signed up with no password cannot sign in on the CRM, WMS, Projects or Pulse sign in pages. Real Stripe has
still never run. I am impressed by the billing. I am not wowed from the first screen to the last.

## How I tested

Real Chromium (Playwright) against the shared dev stack. Every app server ran with
`ENTITLEMENTS_DEV_ALLOW_ALL=0` (I checked each process). I looked at the screenshots named here. Scripts,
output and screenshots are in `docs/billing/.review/critic4/` (not committed). I did not edit product code,
did not restart any server and did not reset the rate limits.

Five people, all made by signing up or by invite:

| Person | Path | What I did |
|:-|:-|:-|
| Sam, Ridgeline Outfitters | Home "Start free", then "Email me a code instead", 1280 by 800, light | Signup with no password, picker, drop to one app and back, start trial, wrong code, right code, welcome wizard, launcher, CRM and WMS first screens, billing home, picker to pay, pay page mistakes, bad promo, good promo, decline, success, trial end, remove WMS, confirm, add WMS back from inside the WMS, six invites over the seat limit, billing only invite, failed renewal, grace, late and view only in the Portal, CRM and WMS, plan ended after 4 tries, come back, update card, cancel page, sign in with a code |
| Jo, Harborline Freight | Pulse card on `/pricing`, 360 px phone, dark | Signup with a password, nine password tries, picker order, skip verify, skip welcome, launcher, trial end with no card, Pulse view only |
| Priya, a bookkeeper | The "billing only" invite from Sam | Invite page, join, where she lands, every billing tab, the launcher, the Organization page, the CRM and the WMS |
| Tess, a teammate | A member invite from Sam | Invite page, join, launcher, what Billing shows her |
| Nobody | Signed out | The sign in page of all five apps, the forgot password page of three, Terms, Privacy, the wizard, `/signup` in dark at 1440 with a yearly cart, the production build with no keys on port 3310 |

Limits, stated plainly:

- No Stripe keys exist. Every payment went through the test gateway. See blocker 1.
- No Google or Microsoft keys exist, so those buttons were never on screen.
- Competitor facts come from `research/COMPETITORS.md`, where most signup details are tagged as working
  knowledge, not verified.
- The test tool "Skip ahead" moves stored dates back, so invoices and activity show dates before the account
  was made. Test mode only.
- I did not see the Pulse banner in the late payment state. Pulse uses the same guard setting as the WMS, so
  I expect the same fault there. See blocker 2.

## What round 3 asked for, and what happened

| # | Round 3 blocker | Now |
|:-|:-|:-|
| 1 | Real Stripe never run | Open. See blocker 1. |
| 2 | One door, and it needs a password | Fixed. "Email me a code instead" on `/signup` and `/login`. Signup with it is 3 fields and goes straight to the picker. Sign in with it took 0.8 seconds after I typed the code. It opened a new seam, see blocker 3. |
| 3 | Remove an app gives the wrong reason | Fixed. "That is $269.89 back for WMS, for the 29 full days left. Your CRM goes from $23.20 to $29 per user, because the bundle discount needs 2 apps. That takes $28.04 off the credit." I checked every number by hand. |
| 4 | Long weak passwords pass | Fixed. `passwordpassword`, 16 letters a, `123456789012345`, `qwertyuiopasdfgh` and `Password123!` are refused with one kind line. |
| 5 | The meter says things that are not true | Fixed. One green line "15 or more characters. That is enough." The email name rule shows as I type. One gap left, see blocker 4. |
| 6 | Bookkeeper hits a code wall | Fixed. Joining from the invite marks the address verified. No second email, no blue bar. |
| 7 | Bookkeeper is shown app setup | Fixed. Her menu is Billing and Organization. No setup guide. The CRM and WMS say "You have billing access only" with "Back to Billing". The invite panel says "Billing only. Free. You can pay bills, change the card and download invoices." |
| 8 | Nothing warns that the bundle discount ends | Fixed, in the trial picker, the plan picker and the confirm dialog. The mirror line shows when I add an app. |
| 9 | Side panel sells a trial to the wrong people | Fixed. `/login` says "One sign in for every KitStak app". `/verify-email` shows my cart and the trial end date. The invite page shows who invited me and my role. |
| 10 | Small true things | Fixed: "Seats: 5 of 5 in use. 1 person and 4 open invites." with a two tone bar, the welcome answers are saved, "2 people were not invited yet" stays after a reload, the phone signup fits one screen, the chosen app is first in the phone picker, "Did you mean gmail.com?". |

## Clicks and fields to first value

| Path | Screens | Fields typed | Clicks | Notes |
|:-|:-|:-|:-|:-|
| KitStak with a code, home "Start free" to the launcher | 5: signup, picker, verify, welcome, launcher | 3, no password | 7 (start, code door, create, one app switch, start trial, later, skip) | No trip to the inbox. Account made in 0.8 seconds on the dev box. |
| KitStak with a password, pricing card to the launcher | 5 | 4 | 5 | The app is already switched on. 5.5 seconds of machine time at 360 px. |
| KitStak, launcher to a real WMS screen | 2 more | 0 | 2 ("Open WMS", "Create warehouse") | Name, code and time zone are filled in. |
| KitStak, "Pick a plan" to a card field | 2 | 0 | 2 | |
| KitStak, sign in again with a code | 1 | 1 plus the code | 1 | 0.8 seconds after the sixth digit, and it kept my `next` page. |
| Linear | about 5 | 3, no password | about 5 | Needs a trip to the inbox first |
| Slack | about 5 | 4, no password | about 5 | Needs a trip to the inbox first |
| Notion, Vercel with Google | about 3 | 1 or 2 | about 4 | One click sign in. KitStak cannot show this without keys. |
| Stripe Checkout, to a card field | 1 | 0 | 1 | |
| HubSpot | 8 to 10 | 8 or more | 10 or more | |

## Scorecard

0 is worse than most, 1 is on par with the best, 2 is better than the best.

| # | Question | Best in class | R1 | R2 | R3 | R4 | Why |
|:-|:-|:-|:-|:-|:-|:-|:-|
| 1 | Time from signup to inside the product | Linear, Slack | 1 | 1 | 1 | 1 | With a code: 3 fields and no inbox trip, which beats Linear and Slack. A buyer on Google Workspace still gets there faster on Notion or Vercel with one click. |
| 2 | Things asked before value | Linear (3) | 1 | 1 | 1 | 1 | 3 with a code, 4 with a password. The same as Linear. |
| 3 | Price obvious and the same everywhere | Slack, Linear | 1 | 2 | 2 | 2 | Site, signup panel, picker, pay page, success, billing home and invoice agree to the cent, promo and yearly included. |
| 4 | Can I work out my bill in my head | Slack | 2 | 2 | 2 | 2 | "CRM: 5 users x $29 = $145 per month." Still the best I have seen. |
| 5 | Do I know what I pay today and next | Stripe Checkout | 1 | 1 | 2 | 2 | Due today, first charge with its date, then the amount. After a credit: "$0.00. Your credit pays this bill in full." |
| 6 | Does checkout feel safe and fast | Stripe Checkout | 1 | 1 | 1 | 1 | Two clicks, kind errors, typed values and the promo kept after a decline. Real Stripe is unseen. |
| 7 | How fair are seat changes | Slack | 2 | 1 | 1 | 1 | Fair and said out loud. Billing home now says "You pay for 5 seats and use 1. Remove a seat to save $23.20 per month." Slack does that step for you. |
| 8 | Could a charge ever surprise me | Slack | 0 | 1 | 1 | 2 | Every change shows the amount first. The bundle discount ending is warned in three places. Over the seat limit it sends what fits and asks before it adds. |
| 9 | How clear is the billing page | Vercel | 2 | 2 | 2 | 2 | Five answers on first paint. The seat line and bar now agree. |
| 10 | Invoices and tax details alone | Stripe Portal | 1 | 2 | 2 | 2 | List, PDF, details page, all self serve. |
| 11 | What happens when a card fails | Stripe, Shopify | 2 | 2 | 2 | 1 | Portal and CRM are still excellent, and paying opened the WMS again in 2.5 seconds. But in the WMS the banner button "Update card" is greyed and the first click only opens a dialog. See blocker 2. |
| 12 | Leave, pause, come back | Stripe Portal | 2 | 2 | 2 | 2 | One page, end date first, pause, undo. After the plan ended I was paying again in 4 clicks. |
| 13 | Can finance pay without being admin | Atlassian | 1 | 1 | 1 | 2 | Free, by email, no code wall, lands in Billing, sees nothing she cannot use. Better than the Atlassian billing contact. |
| 14 | One account for the whole suite | HubSpot, Atlassian | 2 | 2 | 2 | 1 | Inside the apps it is still the best: one banner, one lock screen, one bill. At the door it is not one account: five sign in pages, four of them with no code door. See blocker 3. |
| 15 | Would an 8th grader understand every screen | Slack | 1 | 1 | 1 | 1 | Nearly all. "That one is too easy to guess" for a password with every rule ticked, and a greyed button that is the only fix, would each stop one. |

Total: 23 of 30. No zero.

## Step by step against the best

| Step | KitStak today | Best in class | Who wins |
|:-|:-|:-|:-|
| Public price | Four cards, live calculator, 4 rules, FAQ | Slack and Linear tables | KitStak |
| Home page button | "Start free", "14 days free. No card needed." | Linear, Slack | Tie |
| Signup form | 4 fields, or 3 with "Email me a code instead". Right autofill hints, focus on the first field, nothing cleared on error, "Did you mean gmail.com?" | Linear email only, Stripe 4 fields | Beats Stripe. Ties Linear. Loses to Notion, Slack, HubSpot, Shopify and Vercel on "Continue with Google" until keys are set. |
| Reasons to sign up on that page | Real screenshots, prices or my cart, three true promises | Shopify, HubSpot | Tie. No customer proof yet, and none should be invented. |
| Password | Long ones pass alone, easy ones are refused, the meter is honest | Stripe | Tie. One refusal gives no reason, see blocker 4. |
| Picker | Live math, trial end date, bundle price per app, warns when the discount ends | Atlassian calculator | KitStak |
| Verify email | 6 boxes, skip, change email, wrong code message, my cart beside it | Slack code step | KitStak |
| First screen | 5 steps, my apps first, true cost of each extra app | Shopify setup guide | Tie |
| First screen of the WMS | One click, everything filled in | Shopify admin | KitStak |
| Pay page | Summary beside the card, promo line, decline text, values kept | Stripe Checkout | Tie in test mode. Real Stripe unseen. |
| Remove an app | Right total, right reason, discount named, math adds up | Stripe preview API | KitStak |
| Add an app from inside an app | Works, with "Back to WMS" after. 4 clicks from a view only WMS, the spec says 3 | HubSpot | KitStak once blocker 2 is fixed |
| Invite the team | Several at once, guest free, seat cost first, sends what fits, remembers who is left | Slack | KitStak. The email itself can wait up to a minute, see blocker 5. |
| Bookkeeper | Free, by email, lands in Billing, clean | Atlassian billing contact | KitStak |
| Failed payment in the Portal and CRM | Calm banner, four facts, one click fix, open again in seconds | Stripe, Shopify | KitStak |
| Failed payment in the WMS | The same words, but the button is greyed and needs two clicks | Stripe, Shopify | Loses until blocker 2 is fixed |
| Sign in again | Password or code on the Portal. Password only on the other four apps | Linear, Slack, Notion | Loses until blocker 3 is fixed |
| Cancel and pause | One page, pause, reasons, undo, refund rule in plain words | Stripe Portal | KitStak |
| Invoice | List, page, PDF | Stripe hosted invoice | KitStak |

## Blockers

Each one is something I saw. "Great" is what would make me drop it.

### 1. Real Stripe has never been run (backend)

- Where: `packages/billing` Stripe adapter, `stripe:setup`, `/api/billing/webhooks/stripe`, `GO-LIVE.md`
  "Open item 1".
- Saw: unchanged from rounds 1, 2 and 3. Every payment in four reviews and in the 53 browser tests used the
  test gateway. Hosted Checkout, wallets, the tax ID field, the Billing Portal card update, live signed
  webhooks, Stripe's invoice PDF and the proration dates are all unseen. The signup page says "Card payments
  run on Stripe". Nobody has watched one do so.
- Great: the one hour run in `GO-LIVE.md` "Open item 1", recorded, in Stripe test mode, every line pass. This
  needs two values from the owner (`sk_test_...` and the `whsec_...` from `stripe listen`). The team cannot
  close it alone. Ask the owner for the keys in one line, today.

### 2. In the WMS the banner's own fix button is greyed out and does nothing on the first click (ui)

- Where: `packages/ui/src/view-only/view-only-guard.tsx` (`WRITE_LABEL` starts with `add` and `update`, and
  the scan does not skip the plan banner), switched on in `apps/wms/src/components/layout/app-shell.tsx` and
  `apps/pulse/src/features/shell/app-shell.tsx` with `writeLabel={WRITE_LABEL}`.
- Saw, state one: I removed WMS from a paid plan. The WMS banner said "WMS is view only because it is not in
  your plan. Add it to make changes." with the button "Add WMS". The button carries `data-plan-write` and is
  drawn at 55% (`shots/13-wms-removed.png`). It looks switched off. I clicked it. The address did not
  change. A dialog opened that said "Your plan is view only right now" and showed a second "Add WMS". That
  one worked. Adding WMS back took 4 clicks. The spec promises 3.
- Saw, state two: a late payment after the 7 days. The WMS banner said "Your payment is late, so your apps
  are view only. Pay now to turn them back on." with "Update card", again at 55% (`shots/31-wms-unpaid.png`),
  again a dialog on the first click. The same banner in the CRM is full strength and goes to Billing in one
  click. I did not see Pulse in this state. It uses the same setting.
- Why it matters: this is the one moment the customer has stopped paying and wants to fix it. The only
  button that fixes it reads as disabled. Stripe and Shopify never do this.
- Great: the guard never marks or catches anything inside the plan banner (skip `.ks-planbanner` the way it
  already skips `.ks-viewonly`). One click on "Add WMS", "Update card", "Start again now", "Keep my plan" or
  "Pick a plan" lands on the Portal from every app. A browser test presses the banner button in a view only
  WMS and a view only Pulse for each banner kind and checks the address. The banner also says "Pay now" and
  the button says "Update card": use one of the two.

### 3. The suite has five sign in pages and only one knows the new door (backend)

- Where: `http://localhost:3100/login` (CRM), `3000/login` (WMS), `3400/login` (Projects), `3500/login`
  (Pulse), their `/forgot-password` pages, Portal `/login` (`next`), and the Portal account menu.
- Saw: Sam signed up with "Email me a code instead". The page told him "No password needed". Signed out, he
  opened a link to his CRM. The CRM sent him to its own sign in page: email and password, nothing else. He
  typed his email and got "Enter your password." He has none that he knows. "Forgot password?" on the CRM
  answered "Password reset by email isn't available on this server yet. Ask your KitStak administrator to
  reset your password." He is the administrator. The WMS, Projects and Pulse pages are the same: no code
  door, and no link to the Portal sign in. "Forgot password?" on Pulse opens the CRM's reset page, with the
  CRM name on it. The Portal sign in works with a code, but when I gave it `next=` with the full CRM address
  it dropped it and left me on the launcher. The Portal has no account page (`/settings/account` is a 404
  and the avatar menu has Apps, Billing, Organization settings, theme and Sign out), so there is no place
  to set a password later either.
- Why it matters: the Portal login says "One sign in for every KitStak app". Linear, Slack and Notion have
  one sign in page. Here the door I am sent to depends on which bookmark I used, and four of the five cannot
  let a code only person in.
- Great: one front door. A signed out visit to any app goes to the Portal sign in with the full app address
  in `next` (allowed only for the five trusted app origins), and after signing in by password or code I land
  on the page I asked for. Each app's `/forgot-password` goes to the Portal's. No screen ever says "ask your
  administrator" to the owner. The avatar menu gets "My account" with name, email and "Set a password" or
  "Change password". A browser test: sign up with a code, sign out, open a CRM deep link, sign in with a
  code, land on the deal.

### 4. A password with the company name in it is refused with no reason (ui)

- Where: `/signup`, `/invite/...`, `/reset-password`, the password field and its messages.
- Saw: Jo from "Harborline Freight" typed `Harborline#2026!` and then `Harbor!line2026x`. 16 characters, a
  capital, a number, a symbol. The meter said "Too weak" and the line said "That one is too easy to guess.
  Try a few words that do not go together." It does not say why. For the email name the form does say why:
  "Do not use your email name in your password." A person who puts the company name in every work password
  will try three more that fail the same way. Also, the red line sits under the "Email me a code instead"
  link, not under the field it is about (`shots/02-signup-weaklong.png`).
- Great: "Do not use your company name in your password." as its own line, shown as I type once the company
  field is filled, and again if I fill the company after the password. Error lines sit right under the
  password field, above the code link.

### 5. Invite emails wait for the one minute job (backend)

- Where: `packages/billing/src/server/auth-hooks.ts` `sendInvitationEmail` (it calls `enqueueEmail`), against
  `sendVerificationOTP` in `apps/portal/src/server/auth.ts` (it calls `sendEmailNow`).
- Saw: the page said "Invites sent to team1, team2, team3 and team4" and "We sent an invite to priya". In
  the database all five rows were still `queued` with no send time. Codes go out at once. Invites go when
  the billing job next runs, which is once a minute in production. So "sent" is not yet true, and a teammate
  on the phone with me waits up to a minute.
- Great: an invite is sent at once, like a code, and falls back to the queue only if the mail provider is
  down. The page says "sent" only after that.

## Waiting on the owner (not counted against the team)

- Stripe test keys (blocker 1), and Google and Microsoft test client keys. The code door closes my round 3
  ask, so the social buttons are no longer a blocker. They are still the fastest door on six of the seven
  rivals, and nobody has seen ours work.
- A pricing oddity that the screens now show honestly. With CRM for 5 people, the Pulse tile says "Adds the
  bundle discount. You pay $5.80 less per month." A second app makes the bill smaller, so removing Pulse
  later would make it bigger. That comes from a flat $29 app meeting a 20% discount on everything. The owner
  should decide if that is wanted.
- `BILLING_SELLER_ADDRESS` and `BILLING_SUPPORT_REPLY_TIME` are still not set.
- The price flag. The brief for this review says only the Pulse price is owner confirmed. Add one line to
  the `GO-LIVE.md` launch checklist: "The owner has confirmed the CRM, WMS and Projects prices."

## Seen, not blockers

- The pay page answers an empty form, a made up card number and an expired date with the same line: "Use
  one of the test cards on this page." Fine for a test page. Real Stripe will do its own field errors.
- After "Remove WMS" the dialog says "Then $145.00 per month, starting Dec 24" while the Dec 24 bill is in
  fact $0.00 because of the credit. Billing home says so the moment I confirm. One more line in the dialog
  would close the gap: "Your credit pays the next bill in full."
- Removing WMS and adding it back the same day cost $8.35. That follows the stated rule (a day that has
  started counts as used) and both dialogs showed the amounts first.
- The home page hero card still builds one row a second with a white gap in the middle for the first
  seconds.
- On the dark signup page the product screenshots are light and small. They prove the product is real. They
  do not make me want it. One large, sharp shot per theme would.
- A member's launcher tiles for apps not in the plan say "Ask Sam Ortega to add it." with a "See Billing"
  button that leads to a page that says the same thing.
- The welcome wizard shows "2 to 10" already picked for team size on a brand new one person account.
- The production build on port 3310 shows "Billing is not available right now. Nothing will be charged."
  beside a "Start free trial" button. I did not press it.
- The integrator reports 5 failing WMS unit tests that this work does not touch. Not scored.

## What is already better than the best

Keep these exactly as they are.

- "Email me a code instead": 3 fields, no password, no inbox trip before the product.
- The price math in words on the site, the picker, the pay page, the invoice and the PDF.
- The bundle discount lines: "Removing WMS ends your 20% bundle discount. Your CRM goes from $23.20 to $29
  per user." and the mirror line when I add an app.
- The remove an app dialog, with a reason for every number.
- The first WMS screen: a name already typed, one button, in.
- The launcher: my apps first, then "More apps" with the true added cost.
- The invite form: several addresses, guest free, sends the ones that fit, asks before it adds seats, and
  keeps the list of who is still waiting.
- The bookkeeper path, start to finish.
- The failed payment banner and email in the Portal and CRM, "Pay now", and "Card updated. Your payment went
  through. Back to WMS".
- The cancel page and the one click undo.
- Light and dark, 360 px with no sideways scroll, the sticky total on the phone picker.
