# Billing: owner decisions (binding)

Read this before SPEC.md and CONTRACTS.md. These come straight from the owner and override
any assumption elsewhere.

## 1. Pricing model: per product

Signup and billing charge per product, matching the marketing site catalog:

| Product  | Price                         | Basis                          |
| -------- | ----------------------------- | ------------------------------ |
| CRM      | $29 per user per month        | seats                          |
| Projects | $12 per user per month        | seats (shared count with CRM)  |
| WMS      | $349 per warehouse per month  | warehouses                     |
| Pulse    | $29 per organization per month| flat, up to 5 seats            |

Two or more products: 20% bundle discount. Billed yearly: 15% off. The owner chose this model
for self serve signup, so these prices are no longer placeholders.

## 2. Stripe account state (KitStak LLC, live mode, read on 2026-11-23)

- Old tier products exist and stay untouched: Starter ($800/mo, $8,160/yr), Professional
  ($1,800/mo, $18,360/yr), Enterprise ($3,500/mo, $35,700/yr), plus an inactive $1 smoke test.
  The new flow must never match or reuse them. Find prices by `lookup_key` only, never by name.
- No paying customers. One canceled internal test subscription with metadata
  `org_id` and `plan_key`.
- Only the live account is connected. There is no sandbox.

## 3. New products are created in the live account

The orchestrating session creates the new products and prices in live mode through the Stripe
connector, straight from the mapping in CONTRACTS.md. So CONTRACTS.md must define, exactly:

- product names, and a `kitstak_module` metadata value per product
- one `lookup_key` per price (monthly and yearly for each product)
- how the 20% bundle discount and the 15% yearly discount are modeled in Stripe (coupon ids or
  yearly prices), with integer cent amounts that match the shared quote function to the cent
- tax code and tax behavior

The setup script in the lifecycle lane must be idempotent against these same lookup keys, so
running it after the connector has created them changes nothing.

## 4. Old webhook is replaced at go live

A live webhook endpoint sends `checkout.session.completed` and
`customer.subscription.created|updated|deleted` to a Supabase Edge Function
(`.../functions/v1/stripe-webhook`), described as the only writer of billing state. The Portal
webhook replaces it at go live, not before. GO-LIVE.md must include the step: enable the Portal
endpoint, confirm events flow, then disable the Supabase endpoint. Nothing in this build may
disable it earlier.

## 5. Unchanged

- 14 day free trial, no card.
- The test gateway is for local and non production only.
