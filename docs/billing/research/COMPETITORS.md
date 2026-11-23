# Competitor teardown: signup and billing

Date: 2026-11-23. Owner: billing effort (docs/billing). Status: research input for the KitStak signup and billing build.

This file answers one question: what do the best signup and billing flows do, and what must KitStak do to be better?

## How this was researched

Each fact below carries a tag so nobody mistakes memory for proof.

- **[V]** Verified on 2026-11-23 through web search results that quote the vendor's own pages. Links are in the Sources section.
- **[K]** From the researcher's working knowledge of the product. Not fetched live in this session. Treat as likely true and check before quoting it to a customer.
- **[C]** Sources conflict. Both versions are given.

Limits of this research, stated plainly:

- Direct page fetches were blocked in this session. These hosts did not resolve: linear.app, vercel.com, www.atlassian.com, help.shopify.com, docs.stripe.com. Only search result summaries were reachable. To check a claim first hand, those hosts must be allowed in the session network settings.
- No competitor account was created and no competitor checkout was run. Step counts and field lists for signup screens are tagged [K].
- Competitor prices change often. Prices here are context, not something KitStak copy should quote.

## 1. Teardowns

### 1.1 Stripe (the checkout and billing portal benchmark)

Stripe matters twice. Its own signup is a model of deferring work. And its Checkout and Customer Portal set what buyers expect a payment screen to feel like. KitStak runs on Stripe, so most of this is ours to use if we configure it well.

| Topic | What Stripe does |
|:-|:-|
| Signup steps | One screen: email, full name, country, password. Then straight into a working dashboard in test mode. [K] |
| Social or SSO | Google sign in. Passkeys. SSO for larger accounts. [K] |
| Email verification | Asked for, but it does not block you from exploring. [K] |
| Trial model | No trial needed. Test mode is free forever. You only "activate" (business details, bank) when you want live money. [K] |
| Plan picker | None for core payments. Pay as you go. [K] |
| Checkout (as a product) | Hosted or embedded page. Card, wallets, Link one click pay, live card checks, address autocomplete, tax ID field, promo code field, clear "then $X per month" trial text. [K] |
| Proration | Built into subscriptions. Upgrade charges the difference, with a preview API so the buyer can see the exact amount first. [K] |
| Invoices | Hosted invoice page, PDF invoice and PDF receipt, emailed on payment. [K] |
| Payment method update | Customer Portal: add, remove, set default. Also a hosted "update your card" link in failed payment emails. [V] |
| Dunning | Smart Retries choose retry times with machine learning. You set the retry count and window. Hard declines and "no card on file" are not retried. After retries end you choose: cancel, pause, or leave past due. [V] |
| Cancel and pause | Portal lets customers upgrade, downgrade, pause, resume, cancel, and pay open invoices. Cancel can be now or at period end, and the customer can undo it until the period ends. [V] |
| Cancel reasons and save offers | Preset cancel reasons plus free text for "Other". Reasons arrive in the subscription updated webhook. A coupon can be offered before cancel completes. Newer "retention rules" target offers by reason, tenure or spend (public preview). [V] |
| Tax and receipts | Stripe Tax computes sales tax and VAT by address. Portal lets the customer edit billing details and tax IDs. [V] for tax IDs in portal, [K] for Stripe Tax detail |
| Billing roles | Dashboard has roles for the merchant team. Not relevant to our customers. [K] |
| Feels great | You are inside the product in under a minute. Nothing is asked before it is needed. Error text names the fix. Test mode makes trying things safe. |
| Annoying | Activation is a long form. The Customer Portal looks like Stripe, not like your app, and it cannot show app context such as "you use 7 of 10 seats". |

### 1.2 Linear

| Topic | What Linear does |
|:-|:-|
| Signup steps | Email (magic link or code) or Google. Name the workspace and pick its URL. Short welcome tour: theme, command menu, connect GitHub, invite teammates. About 5 light screens. [K] |
| Fields asked | Email, workspace name, workspace URL. No password. No phone. No company size. [K] |
| Social or SSO | Google, passkeys, email link. SAML on higher plans. [K] |
| Email verification | The login link is the verification. No second step. [K] |
| Trial model | Free plan with limits, no card. Paid plans start when you upgrade. No trial terms were found in search. [K] |
| Plan picker | Three paid tiers in a simple table in settings. Basic $10 and Business $16 per user per month billed yearly. [V] |
| Seat handling | You pay for active members. Suspended members lose access at once and drop off the next bill. Guests bill as members on Business and Enterprise. [V] |
| Checkout | Card form inside settings. No redirect feel. [K] |
| Proration | Yearly: adding a member makes a prorated charge, suspending one makes a prorated credit. Credits go to future invoices, never refunded. Monthly: no charge until the next month for adds, and no credit for removals mid month. [V] |
| Invoices | List in Settings, Billing. Stripe invoices. [K] |
| Dunning | Email notices to admins, then the workspace drops to the free plan. [K] |
| Cancel and pause | Downgrade to Free in settings. No pause. [K] |
| Tax and receipts | Billing email, address and tax ID fields on the billing page. [K] |
| Billing roles | Admins only. [K] |
| Feels great | Speed. No password. Every screen has one job. Keyboard first. The app is the reward, and you reach it fast. |
| Annoying | Monthly and yearly proration rules differ, which takes a help article to explain. No pause. Billing is admin only, so finance staff need full admin rights. |

### 1.3 Shopify

| Topic | What Shopify does |
|:-|:-|
| Signup steps | Short quiz about what you sell (every question has "Skip"). Pick country. Create account. Land in the admin with a setup guide. [K] |
| Fields asked | Email, password, store name, country. Business address comes later, when you pick a plan. [K] |
| Social or SSO | Email, Apple, Google, Facebook. [K] |
| Email verification | Asked for after you are already in the admin. [K] |
| Trial model | 3 day free trial with no card, then $1 per month for the first 3 months on most plans. [V] You cannot take real orders until you pick a plan. [V] |
| Plan picker | Plan cards with a monthly or yearly toggle and the saving shown. [K] |
| Seat handling | Staff accounts are capped by plan, not billed per seat. [K] |
| Checkout | Card or PayPal inside the admin. [K] |
| Proration | Plan upgrades credit the unused time on the old plan. [K] |
| Invoices | Bills list in Settings, Billing. Each bill itemizes plan, apps, shipping labels and taxes. [K] |
| Dunning | Emails and admin banners. After repeated failures the store is frozen until the bill is paid. Data is kept. [K] |
| Cancel and pause | Owner only. "Pause and build" keeps the admin open at a low monthly price with checkout off. Or deactivate the store. Support cannot cancel for you. [V] Whether the admin stays usable while paused is described both ways in community posts. [C] |
| Tax and receipts | Tax on bills by region. Tax ID field for business buyers. [K] |
| Billing roles | Store owner, plus staff given billing permissions. [K] |
| Feels great | The setup guide checklist with a progress bar. The trial countdown banner with one clear button. Skippable questions. |
| Annoying | A 3 day trial is short. The $1 offer makes the real price easy to miss. Bills mix plan, apps and usage, so totals surprise people. Cancel is owner only. |

### 1.4 Notion

| Topic | What Notion does |
|:-|:-|
| Signup steps | Email then a code, or one click social. Name and optional photo. "How do you plan to use Notion" (team, personal, school). Name the workspace. Invite teammates (skippable). [K] |
| Fields asked | Email, name, use case, workspace name. [K] |
| Social or SSO | Google, Apple, Microsoft, passkeys, SAML on higher plans. [K] |
| Email verification | The emailed code is the verification. [K] |
| Trial model | Free plan forever. Trials of paid plans are offered in app. [K] |
| Plan picker | Compare table in Settings with a monthly or yearly toggle. [K] |
| Seat handling | Charged per member. Guests are free up to a limit. [K] |
| Proration | Adding a member charges only for the part of the period they are in the workspace, shown on the next invoice. Removing members is not prorated. It takes effect next cycle and the seat stays usable until then. [V] |
| Downgrade | Takes effect at the end of the current period. [V] |
| Refunds | Full refund if you downgrade within 3 days of a monthly signup or 30 days of a yearly one. Members added by accident can be refunded within 72 hours of the invoice. [C] The two windows appear on different versions of the help page. |
| Invoices | Settings, Billing: invoice list, billing email, address and VAT or tax ID. [K] |
| Dunning | Emails to owners, then downgrade to Free. Content is kept. [K] |
| Cancel and pause | Downgrade to Free in settings. No pause. App Store purchases must be cancelled through Apple. [V] |
| Billing roles | Workspace owners. [K] |
| Feels great | The use case question changes the starting templates, so the first screen is never blank. Invites feel like part of setup, not a chore. |
| Annoying | Adding a member can create a charge with no confirmation at the moment of the click. That is why a 72 hour "added by accident" refund rule exists. |

### 1.5 Slack

| Topic | What Slack does |
|:-|:-|
| Signup steps | Email then 6 digit code, or Google or Apple. Then three questions, one per screen: team name, your name, what is your team working on (this becomes a channel). Then invite teammates (skippable). [K] |
| Fields asked | Email, workspace name, your name, a project name. [K] |
| Email verification | The code is the verification. Paste works, and the code fills from one field to the next. [K] |
| Trial model | Free plan. A Pro trial is offered in app with no card. [K] |
| Plan picker | Plan cards with monthly or yearly toggle. [K] |
| Seat handling | Fair Billing Policy. You pay only for active members. A member with no use for over 28 days, or one who is removed, counts as inactive. [V] |
| Proration | Inactive member: a prorated credit lands on the account. Worked example on the help page: $8.75 plan, member removed 15 days into a 30 day month, credit is $4.38. A member who returns is charged the prorated rest of the period. Minimum bill is one member. Credits have no cash value and end with the plan. [V] |
| Checkout | Card form in a clean two column page with an order summary that shows member count times price. [K] |
| Invoices | Billing page lists statements and invoices as PDF. Billing contacts get copies by email. [K] |
| Dunning | Emails to owners and billing contacts. After retries, the workspace drops to Free. History is kept. [K] |
| Cancel and pause | Downgrade to Free by the Primary Owner. No pause. [K] |
| Billing roles | Owners and admins see billing. Extra "billing contacts" get emails without being admins. [K] |
| Feels great | Fair billing is the best trust signal in SaaS: one sentence, one worked example, and it favors the customer. Signup asks one easy question per screen. |
| Annoying | Only the Primary Owner can cancel. Credits are not refundable. |

### 1.6 HubSpot

| Topic | What HubSpot does |
|:-|:-|
| Signup steps | Google, Microsoft, Apple or email. Then a run of questions: name, industry, job role, company size, company name, website, data region. Then connect inbox and import contacts. About 8 to 10 screens. [K] |
| Email verification | Required early for email signups. [K] |
| Trial model | Free CRM forever. 14 day trials of paid tiers with no card. [K] |
| Plan picker | Hubs times tiers times seats times contact tiers. A calculator page is needed to work out a price. [K] |
| Seat handling | Seat types (core, sales, service, view only) with different prices and rights. [K] |
| Checkout | Self serve cart for Starter. Sales contact for Professional and above, often with an onboarding fee. [K] |
| Renewal | Auto renewal is on by default. You cannot cancel mid term. Turning auto renewal off cancels on the renewal date. [V] |
| Downgrade | Not allowed mid contract. It applies at renewal. Help center says to contact them at least five business days before renewal. Reducing seats does not take effect by itself. [V] |
| Commitment | Monthly billing can still be a 12 month commitment. Cancelling early does not stop the charges. [V] |
| Starter cancel | Help center points Starter customers to an email support ticket. The renewal center is only for Professional and Enterprise. [V] |
| Dunning | Emails to billing admins, then suspension of paid features. [K] |
| Billing roles | Super Admin or a user with billing admin permission. [V] |
| Feels great | The free CRM is truly usable. The in app setup checklist is good. The suite story (one customer record across hubs) is strong. |
| Annoying | Too many signup questions. Pricing you cannot work out in your head. Commitments, auto renewal and support ticket cancellation. This is the flow buyers complain about most. |

### 1.7 Vercel

| Topic | What Vercel does |
|:-|:-|
| Signup steps | Pick Hobby or Pro. Continue with GitHub, GitLab, Bitbucket, Google, passkey or email. Import a project. About 3 screens to a live deploy. [K] |
| Fields asked | Plan type, name, team name. Sometimes a phone check. [K] |
| Trial model | Pro trial with a $20 credit and usage limits. No card needed. With no payment method the team goes back to Hobby when the trial ends. With one, billing starts right after. [V] Trial length is 14 days. [K] Owners cannot be changed during the trial. [V] |
| Seat handling | Owner and Member seats are $20 per month each. Viewer seats are free and unlimited. [V] |
| Checkout | Card form in a modal inside the dashboard. [K] |
| Usage and limits | $20 monthly credit, then on demand usage. Spend management is on by default with notices at $200 per cycle. A hard pause at a limit must be turned on by the customer. [V] |
| Invoices | Billing tab: current usage, forecast, invoice list with PDF. [K] |
| Dunning | Emails and dashboard banners, then the team is paused or downgraded. [K] |
| Cancel and pause | Downgrade to Hobby in settings. [K] |
| Billing roles | A Billing role that can manage payment and invoices without deploy rights. [K] Not confirmed by the search results in this session. |
| Feels great | Sign in with the account you already have. Value in the first minute. The billing page shows usage against limits, live. |
| Annoying | Usage based bills can surprise people. A phone check sometimes blocks signup. |

### 1.8 Atlassian (Jira, Confluence)

| Topic | What Atlassian does |
|:-|:-|
| Signup steps | Email or Google, Microsoft, Apple or Slack. Verify email. Name the site (URL). A few questions about work type and team. Pick a template. Invite teammates. About 6 to 8 screens, with a slow "setting up your site" wait. [K] |
| Email verification | Required before the site is made. [K] |
| Trial model | Free plan for up to 10 users. [V] Moving from Free to Standard starts a 14 day trial, Premium 30 days, per the licensing page. Product pricing pages say 7 days. [C] |
| Free limit overflow | If users stay over the free limit, billing and technical contacts are warned and the site is upgraded to Standard after 7 days unless users are removed. [V] |
| Seat handling, monthly | "Maximum quantity billing": you pay for the highest seat count reached in the cycle. Seats added mid cycle are prorated. Removing seats mid cycle does not lower that bill. [V] |
| Seat handling, annual | Billed by user tier. Tiers cannot be changed once set. [V] |
| Payment methods | Monthly: card or PayPal only. [V] |
| Dunning | A community post citing the licensing page says products are unsubscribed 15 days after the due date. Another user says at least 7 days. [C] After unsubscribe, data is kept for a set time and then deleted (60 days cited for Free). [V, community] Users report that restoring access after paying can take a support ticket and days of waiting. [V, community] |
| Cancel and pause | Unsubscribe in admin. No pause. [K] |
| Billing roles | Billing admins and billing contacts, separate from site admins. Community advice: keep at least two billing admins. [V, community] |
| Feels great | A real free tier. The price calculator. A separate billing admin role. |
| Annoying | Two admin consoles. Tier jumps on annual plans. Surprise auto upgrade when a free site goes over 10 users. Slow recovery from suspension. |

### 1.9 WMS and 3PL software (ShipHero, with ShipBob WMS and Logiwa for context)

| Topic | What they do |
|:-|:-|
| Signup | No self serve signup. A "request a demo" or "get a quote" form with name, work email, phone, company, order volume and warehouse count. A sales rep replies later. ShipBob's form says an expert "will get back to you shortly". [V] |
| Trial | None you can start by yourself. [K] |
| Pricing | ShipHero: one comparison lists Standard WMS for brands at $1,995 per month and a 3PL plan at $2,195 per month. Capterra lists every plan as "Custom quote". [C] ShipBob WMS: custom quote with three parts: a one time implementation fee, a monthly software fee, and per order shipping costs. [V] Logiwa: an aggregator says from $500 per month, with implementation services estimated from $3,500 to $40,000 and G2 listing about 4 months to implement. [V, third party] |
| Seats | ShipBob's standard WMS fee is said to include unlimited users. [V, third party] |
| Checkout | A signed order form. Invoice or ACH. [K] |
| Billing self service | Thin. Plan changes and cancellations go through an account manager. [K] |
| Feels great | A named human helps with setup. |
| Annoying | You cannot see a price, try the product, or buy it without a sales call. Setup takes weeks or months. |

This is KitStak's easiest win. No WMS in this class lets a warehouse owner see the price, start a trial with no card, and pay by card in the same afternoon.

## 2. Feature matrix

Legend: **Y** yes. **P** partly. **N** no. **?** not confirmed in this session. The last column is the bar KitStak must clear, not a claim about what is built today.

### 2.1 Signup

| Feature | Stripe | Linear | Shopify | Notion | Slack | HubSpot | Vercel | Atlassian | WMS class | KitStak target |
|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|
| Self serve signup, no sales call | Y | Y | Y | Y | Y | Y | Y | Y | N | Y |
| Fields before you are inside the product | 4 | 3 | 4 | 4 | 4 | 8+ | 3 | 5+ | 6+ form, then wait | 4 or fewer |
| Google sign in | Y | Y | Y | Y | Y | Y | Y | Y | N | Y, when keys are set |
| Microsoft sign in | N | N | N | Y | N | Y | N | Y | N | Y, when keys are set |
| Passwordless (code, link or passkey) | P | Y | N | Y | Y | N | Y | N | N | P, password plus email code |
| Email verification does not block first use | Y | Y | Y | Y | Y | N | Y | N | N | Y |
| One question per screen, each skippable | P | Y | Y | Y | Y | N | Y | P | N | Y |
| Invite teammates during setup | N | Y | N | Y | Y | Y | Y | Y | N | Y |
| First screen is never empty (sample data or checklist) | Y | P | Y | Y | Y | Y | Y | Y | N | Y |
| No card to start | Y | Y | Y | Y | Y | Y | Y | Y | N | Y |
| Trial length shown as a real date | N | N | Y | P | P | P | P | P | N | Y |
| Public price before signup | Y | Y | Y | Y | Y | P | Y | Y | N | Y |

### 2.2 Plans, seats and checkout

| Feature | Stripe | Linear | Shopify | Notion | Slack | HubSpot | Vercel | Atlassian | WMS class | KitStak target |
|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|
| Price you can work out in your head | P | Y | Y | Y | Y | N | P | P | N | Y |
| Live price calculator in the picker | N | N | N | P | P | P | N | Y | N | Y |
| Monthly or yearly toggle with saving shown in dollars | N | P | Y | Y | Y | Y | N | Y | N | Y |
| Multi product bundle discount shown as its own line | N | N | N | N | N | P | N | P | N | Y |
| Exact amount due today shown before you pay | Y | P | Y | P | Y | P | P | P | N | Y |
| Next charge date and amount shown before you pay | Y | P | Y | P | P | P | P | P | N | Y |
| Wallets (Apple Pay, Google Pay, Link) | Y | ? | P | ? | ? | ? | ? | P | N | Y, through Stripe Checkout |
| Promo code field | Y | N | N | P | P | N | N | N | N | Y |
| Tax ID field at checkout | Y | Y | Y | Y | ? | Y | Y | Y | N | Y |
| Seat add shows the cost before confirm | n/a | P | n/a | N | P | P | P | P | N | Y |
| Seat removal gives credit | n/a | Yearly only | n/a | N | Y | N | ? | N | N | Y |
| No forced annual commitment | Y | Y | Y | Y | Y | N | Y | Y | N | Y |

### 2.3 Running the account

| Feature | Stripe | Linear | Shopify | Notion | Slack | HubSpot | Vercel | Atlassian | WMS class | KitStak target |
|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|:-|
| Invoice list with PDF download | Y | Y | Y | Y | Y | Y | Y | Y | P | Y |
| Receipt email on every payment | Y | Y | Y | Y | Y | Y | Y | Y | P | Y |
| Change card without contacting support | Y | Y | Y | Y | Y | Y | Y | Y | N | Y |
| Failed payment: email plus in app banner with a one click fix | Y | P | Y | P | P | P | Y | P | N | Y |
| Grace period before access changes, shown as a date | P | ? | P | ? | ? | ? | ? | C | N | Y |
| Data kept when payment fails or plan ends | n/a | Y | Y | Y | Y | Y | Y | Y, time limited | ? | Y |
| Cancel in the product, no ticket, no call | Y | Y | Y, owner only | Y | Y, owner only | N | Y | Y | N | Y |
| Cancel keeps access until period end, with undo | Y | P | P | Y | P | Y | P | P | N | Y |
| Pause instead of cancel | Y | N | Y | N | N | N | N | N | N | Y |
| Cancel reason captured | Y | ? | Y | Y | ? | ? | ? | Y | N | Y |
| Billing role apart from full admin | n/a | N | P | N | P | Y | ? | Y | N | Y |
| Billing contact emails apart from users | Y | P | P | Y | Y | Y | P | Y | P | Y |
| Trial status visible on every page | n/a | n/a | Y | P | P | P | Y | P | N | Y |
| Billing page shows use against what you pay for | n/a | P | P | P | Y | P | Y | P | N | Y |
| One bill for a whole product suite | n/a | n/a | P | n/a | n/a | Y | Y | P | n/a | Y |
| Test mode for trying the money flow safely | Y | N | P | N | N | N | N | N | N | Y, non production only |

## 3. Patterns worth stealing

1. **Slack: one easy question per screen.** Each answer is used at once (the project name becomes a channel). Nothing is asked "for our records".
2. **Linear: the login is the verification.** No "check your inbox" wall between the user and the product.
3. **Stripe: defer everything.** Ask for business and tax details at the moment they are needed, which is checkout, not signup.
4. **Shopify: the trial banner and the setup checklist.** A countdown with one button, plus a progress bar that makes finishing feel good.
5. **Slack: fair billing in one sentence with a worked example.** Trust comes from showing the math.
6. **Stripe Checkout: say the future out loud.** "Free until 7 Dec. Then $58.00 per month." No fine print.
7. **Vercel: billing page as a dashboard.** What you use, what you pay for, what is next, all in one view.
8. **Atlassian: a billing admin role.** Finance staff can pay bills without the power to delete data.
9. **Stripe Portal: cancel is two clicks, with a reason, a save offer and an undo.** Easy exits make people more willing to sign up.
10. **Notion: use case question that changes the first screen.** KitStak's version is "which apps do you want", which sets the launcher, the trial and the price.

## 4. Mistakes to avoid

1. **HubSpot: cancellation by support ticket and locked terms.** Never make leaving harder than joining.
2. **HubSpot: pricing that needs a calculator page and a sales rep.**
3. **Atlassian: silent auto upgrade** when a free site passes its limit. Never start charging without a clear yes from a person.
4. **Notion: adding a member charges money with no confirm step.** Always show the cost before the click.
5. **Atlassian and Linear: proration rules that differ by billing period.** One rule for everyone.
6. **Shopify: a teaser price that hides the real one.** Show the real price first.
7. **Vercel: bills that surprise.** KitStak prices are fixed per seat, per warehouse or per org, so the next bill can always be shown to the cent.
8. **WMS class: demo wall.** No price, no trial, no self serve.
9. **Slack and Shopify: only one person can cancel.** If that person leaves the company, the account is stuck.
10. **Atlassian: slow return after a late payment.** Paying must restore access at once, with no ticket.

## 5. What KitStak must do to beat them (ranked)

Ranked by effect on "will a buyer sign up and stay". Every item has a test that passes or fails. Prices in tests come from the shared pricing catalog, so if the catalog changes the expected numbers change with it.

### Tier 1: without these we lose

1. **Inside the product in 60 seconds with 4 fields or fewer.**
   Signup asks for work email, name, password and company name. Nothing else is required.
   Test: a new user with a stopwatch goes from the signup page to the launcher in under 60 seconds. Count of required inputs on the signup screen is 4 or fewer. No phone, no card, no company size.

2. **Trial starts by itself, with no card, and says its end date in words.**
   Test: right after signup, core.entitlements has rows with source trial and a period end 14 days out for each chosen product. Every app shows "Free trial. Ends 7 Dec." with a real date. No card field appears anywhere before the user chooses to pay.

3. **One price, the same everywhere, to the cent.**
   Marketing site, signup, plan picker, checkout and invoice all read the one catalog.
   Test: for the same cart (for example CRM with 5 users plus WMS with 1 warehouse, monthly), the total on the pricing page, in the plan picker, on the Stripe Checkout page and on the first invoice are the same number. An automated test asserts this for at least 6 carts, including bundle discount and yearly discount.

4. **The picker shows the math in plain words.**
   Each line reads like "CRM: 5 users x $29 = $145". The bundle discount and yearly saving are their own lines in dollars. Pulse reads "$29 for your whole team, up to 5 seats".
   Test: change seats, warehouses, products and billing period, and the total updates in under 100 ms with no page load. A reader can rebuild the total with a calculator from what is on screen.

5. **Before paying, the buyer sees three facts: due today, next charge amount, next charge date.**
   Test: the review step and the checkout page both show all three. During a trial, "Due today: $0.00" and "First charge: $X on [date]" are shown.

6. **Checkout that never leaves a person stranded.**
   Stripe Checkout with wallets and saved details. Clear return paths for success, cancel and decline.
   Test: in test mode, the success card, a declined card and "back" each land on a KitStak page that says what happened and what to do next. A declined card never creates a paid entitlement. Closing the tab mid checkout and coming back resumes the cart.

7. **Access turns on at once, driven by signed webhooks, safe to replay.**
   Test: after payment, the launcher shows the products as active within 5 seconds without a manual refresh. Sending the same webhook event twice creates one core.billing_events row and no double entitlement. A webhook with a bad signature gets a 400 and changes nothing.

8. **Fail closed in production, honest test mode elsewhere.**
   Test: with no Stripe keys and NODE_ENV production, every pay button shows a plain "Billing is not available right now" message and no entitlement changes. With no keys outside production, every billing screen shows a "Test mode" label and the test gateway runs the same sync code as Stripe.

9. **Cancel in two clicks, keep access to period end, undo with one click.**
   Test: an owner can cancel from the billing page with no ticket, no call and no hidden link. The page then shows "Your plan ends on [date]. You keep everything until then." and a "Keep my plan" button that restores the subscription. Data is never deleted by a cancel.

10. **Failed payment is calm, clear and fixable in one click.**
    Test: a failed renewal produces an email and a banner in every app for owners and billing managers. Both say the amount, the card's last 4 digits, the next retry date, and the date access will change. "Update card" opens the payment update screen directly. After a good payment the banner is gone and access is restored within 5 seconds, with no support step.

### Tier 2: this is how we pass the best of them

11. **One rule for seat changes, in the customer's favor.**
    Add a seat: pay only for the days left, and see that number before you confirm. Remove a seat: get credit for the days left on your next bill. Same rule for monthly and yearly. This beats Notion, Linear monthly and Atlassian.
    Test: adding 1 CRM seat halfway through a 30 day month shows "$14.50 today, then $29 more each month" before the confirm button. Removing it shows the credit amount. The invoice line matches the preview to the cent.

12. **Nothing ever costs money without a confirm screen that shows the amount.**
    Test: inviting a user who needs a new paid seat shows the price and asks for a yes. There is no path in any app (Portal, CRM, WMS, Projects, Pulse) that raises the bill without that step. Going over a limit never upgrades by itself.

13. **A billing page that answers five questions without scrolling on a laptop.**
    What am I on? What does it cost? When is the next charge? What card? Where are my invoices?
    Test: at 1280 x 800 all five answers are visible on first paint. The page also shows seats used against seats paid for, per product.

14. **Invoices and receipts with no support step.**
    Test: every paid invoice is listed with date, amount and status, and downloads as a PDF. A receipt email goes out on each payment. Company name, billing address, billing email and tax ID can be edited by the customer and appear on the next invoice.

15. **A billing manager role.**
    A person can pay bills, change the card and download invoices without admin rights over data. At least two people can hold billing rights, so no single person is a lock.
    Test: a user with only the billing role can do all billing tasks and cannot change org members' data access. Any owner can cancel, not only the first one.

16. **Trial ending is a soft landing, never a wall.**
    Test: reminders go out by email and in app at 7 days, 3 days and 1 day before the end, plus on the day. When the trial ends with no payment, the apps go read only with a clear "Pick a plan to keep working" screen. Nothing is deleted. Paying restores write access at once.

17. **Pause as an option beside cancel.**
    Only Stripe and Shopify offer it. Seasonal warehouses will use it.
    Test: the cancel flow offers "Pause for 1, 2 or 3 months" with the restart date shown. While paused no invoice is made and data is kept read only.

18. **Cancel asks why, once, and listens.**
    Test: the cancel flow has one optional question with 5 or 6 plain reasons and a text box. The answer is stored with the org and visible to KitStak staff. Skipping the question does not block the cancel.

19. **The suite advantage: one account, one bill, one trial, every app.**
    None of the single product rivals can do this, and HubSpot does it with far more friction.
    Test: one signup gives access to every chosen app through the launcher with no second login. Adding WMS to a CRM plan from inside WMS takes 3 clicks or fewer, shows the bundle discount applied to both products, and produces one combined invoice. Each app's trial and billing banners come from the same shared component and say the same thing.

20. **Self serve WMS purchase.**
    Test: a warehouse owner can see the WMS price on the public site, start a trial with no card, add a second warehouse with a visible price change, and pay by card, all without contacting KitStak. No "request a demo" step is required at any point.

### Tier 3: polish that people feel

21. **Google and Microsoft sign in when keys are set.** Warehouse and sales teams live in Microsoft 365 and Google Workspace.
    Test: with provider keys in env, both buttons appear and work. With no keys, the buttons are not rendered at all (no dead buttons).

22. **Email verification never blocks the first session.**
    Test: a new user can reach the launcher and open an app before verifying. A thin banner asks them to verify. Verification is required before paying or inviting others.

23. **Forms that work with the browser.**
    Test: every input has the right autocomplete token (email, name, organization, new-password, current-password). Password managers offer to save on signup and fill on login. A 6 digit code field accepts paste and one time code autofill. The whole signup and checkout path works by keyboard alone, with visible focus.

24. **Errors that say what to do.**
    Test: every error message on the signup and billing path names the problem and the fix in one or two short sentences. "That card was declined. Try another card or call your bank." No raw codes, no stack text. Typed input is never lost after an error.

25. **Works on a phone, on a slow link, with motion turned off.**
    Test: at 360 px wide there is no sideways scroll and all tap targets are at least 44 px. On a throttled 3G profile each button shows a busy state within 100 ms and cannot be double submitted. With reduced motion set, there are no moving animations.

26. **Light and dark themes with the shared tokens.**
    Test: every new screen uses packages/ui tokens only. Text contrast is at least 4.5 to 1 in both themes. No hard coded colors.

27. **A setup checklist after signup that uses the answers given.**
    Test: after signup the welcome screen lists 3 to 5 next steps tied to the chosen apps, with progress. It follows docs/integration/ONBOARDING.md step rules. No step is a dead end.

28. **Reading level check on every screen.**
    Test: all UI copy on the signup and billing path scores grade 8 or lower on a readability check. No sentence is over 20 words. A search of the new files finds no em dash, no double dash, no "coming soon" and no placeholder text.

29. **Money questions answered next to the button, not in a help center.**
    Test: under the pay button are three short lines: "No charge today" (during trial) or the amount, "Cancel any time in Billing", and "Your data stays yours". A short FAQ on the picker answers: What happens when my trial ends? Can I change seats later? Can I cancel?

30. **Promo codes and tax handled by Stripe, shown by us.**
    Test: a valid promo code shows its discount as a line before payment. Tax, when it applies, is its own line on the review step and on the invoice. A tax ID entered at checkout shows on the invoice PDF.

## 6. Scorecard for the critic

A reviewer comparing KitStak to the nine products above should score each line 0 (worse than most), 1 (on par with the best) or 2 (better than the best). The flow is ready when no line scores 0 and the total is 24 or more out of 30.

| # | Question | Best in class to beat |
|:-|:-|:-|
| 1 | Time from landing on signup to inside the product | Linear, Slack |
| 2 | Number of things asked before value | Linear (3) |
| 3 | Is the price obvious and the same everywhere | Slack, Linear |
| 4 | Can I work out my bill in my head | Slack |
| 5 | Do I know what I pay today and next, before I pay | Stripe Checkout |
| 6 | Does checkout feel safe and fast | Stripe Checkout |
| 7 | How fair are seat changes | Slack fair billing |
| 8 | Could a charge ever surprise me | Slack |
| 9 | How clear is the billing page | Vercel |
| 10 | Can I get invoices and fix tax details alone | Stripe Portal |
| 11 | What happens when a card fails | Stripe, Shopify |
| 12 | How easy is it to leave, pause or come back | Stripe Portal |
| 13 | Can finance pay without being an admin | Atlassian |
| 14 | Does one account cover the whole suite cleanly | HubSpot, Atlassian |
| 15 | Would an 8th grader understand every screen | Slack |

## Sources

Search results used on 2026-11-23. Pages were read as search summaries, not fetched in full.

- Slack fair billing policy: https://slack.com/help/articles/218915077-Slack-s-fair-billing-policy
- Linear billing and plans: https://linear.app/docs/billing-and-plans
- Linear members and roles: https://linear.app/docs/members-roles
- Linear pricing: https://linear.app/pricing
- Shopify pricing: https://www.shopify.com/pricing
- Shopify free trial help: https://help.shopify.com/manual/intro-to-shopify/pricing-plans/free-trial
- Shopify community, cancel before trial ends: https://community.shopify.com/t/how-can-i-cancel-my-shopify-store-before-the-free-trial-ends/262710
- Shopify community, pause: https://community.shopify.com/t/can-i-pause-my-subscription-without-losing-my-account-settings/186409
- Notion billing help: https://notion.com/help/billing
- Notion members and billing: https://www.notion.com/help/members-and-billing
- Notion change your plan: https://www.notion.com/help/upgrade-or-downgrade-your-plan
- HubSpot review your upcoming renewal: https://knowledge.hubspot.com/account/review-your-upcoming-renewal
- HubSpot cancel account: https://knowledge.hubspot.com/account/how-do-i-cancel-my-hubspot-account
- HubSpot billing FAQ: https://knowledge.hubspot.com/account/billing-and-payment-faqs
- Vercel Pro plan: https://vercel.com/docs/plans/pro-plan
- Vercel Pro trials: https://vercel.com/docs/plans/pro/trials
- Vercel Pro billing FAQ: https://vercel.com/docs/plans/pro-plan/billing
- Vercel new Pro pricing: https://vercel.com/blog/new-pro-pricing-plan
- Atlassian cloud licensing: https://www.atlassian.com/licensing/cloud
- Atlassian Jira pricing: https://www.atlassian.com/software/jira/pricing
- Atlassian community, suspended products: https://community.atlassian.com/t5/Jira-Software-questions/Your-Atlassian-Cloud-products-are-suspended/qaq-p/2056322
- Atlassian community, reactivation delay: https://community.atlassian.com/forums/Jira-questions/Need-our-Account-reactivated-Ticket-submitted-with-no-response/qaq-p/2629032
- Stripe smart retries: https://docs.stripe.com/billing/revenue-recovery/smart-retries
- Stripe revenue recovery: https://docs.stripe.com/billing/revenue-recovery
- Stripe customer portal: https://docs.stripe.com/customer-management
- Stripe portal configuration: https://docs.stripe.com/customer-management/configure-portal
- Stripe cancellation page: https://docs.stripe.com/customer-management/cancellation-page
- Stripe retention rules: https://docs.stripe.com/billing/retention/rules
- Stripe billing features: https://stripe.com/billing/features
- ShipBob WMS pricing: https://www.shipbob.com/wms-pricing/
- ShipHero versus Logiwa pricing (third party): https://www.costbench.com/compare/logiwa-vs-shiphero/
- ShipHero pricing (Capterra): https://www.capterra.com/p/166930/ShipHero/pricing
- Logiwa pricing (G2): https://www.g2.com/products/logiwa-corp-logiwa/pricing
