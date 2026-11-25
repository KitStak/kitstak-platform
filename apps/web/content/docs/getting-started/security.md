---
title: Security in KitStak
description: How KitStak protects your account and organization: sign in rules, lockout, codes, sessions, roles, card payments and what owners can control.
section: Security
order: 10
---

KitStak protects your account at the sign in page and your organization at every page after it. This page lists what the product does for you and what owners and admins can do to keep a team safe. For the full picture of how KitStak runs and protects the service, see [Security](/security).

## Your account

| Protection | What it does |
| --- | --- |
| Password rules | Every new password meets the same rules, and easy to guess passwords are refused at any length. See [Password rules](/docs/getting-started/password-rules). |
| Account lockout | After 5 wrong passwords for one email, sign in is locked for 15 minutes. The message never says the account is locked, so nobody can use it to find accounts. |
| One answer for every address | Reset and sign in code screens say a code is on its way if the address has an account. They never confirm whether it does. |
| Codes by email | Sign in, reset and verify codes are 6 digits and expire after a short time. New codes are spaced out, so nobody can flood your inbox. |
| Reset ends every session | Saving a new password signs out every other device, in every app. |
| Ended sessions stop at once | Every request checks the session, so a session that was ended is refused on the next page you open. |
| Verified email | Inviting people and paying need a verified email. |
| Safe links | After sign in, the Portal only sends you back to KitStak addresses, never to another site. |

## Your organization

- Every page and action works on your current organization only. A link that names another organization opens only if you are a member of it.
- Roles decide who can invite, change roles, see billing and pay. See [Roles and what each can do](/docs/getting-started/roles-and-permissions).
- Only an owner can add or remove a billing manager.
- A billing manager gets no extra access to your data. A billing only person has no access to the apps at all.
- An invite link proves the mailbox it was sent to. A copied link asks for a code sent to the invited address before anyone can join.
- Removing a person ends their access to every app at once.
- When a WMS admin deactivates someone, every session they have ends and no new one can start until they are activated again.

## Payments

- Card payments run on Stripe. KitStak never sees your full card number.
- Billing keeps only what it needs to show you: the card brand, its last four digits and its expiry date, your invoices and your billing details.
- Every billing change records who did it and when. See [Invoices and billing activity](/docs/getting-started/invoices-and-activity).
- No screen sets a price. Every amount comes from KitStak's own price list or the payment provider, and a plan change is only confirmed at the amount you saw.

## Keep your team safe

1. Ask everyone to use a long password, or a code by email.
2. Give the **Admin** role only to people who run the team. Invite people from outside your company as **Guest**, so they see only what you add them to.
3. Add a second billing manager, so billing never depends on one person.
4. Remove people the day they leave. See [Roles and what each can do](/docs/getting-started/roles-and-permissions).
5. Check **Billing > Activity** now and then for changes you did not expect.

## Report a problem

To report a security concern, select **Report a problem** on the [Security](/security) page. For other questions, use the [contact page](/contact). Read how KitStak handles personal data in the [Privacy policy](/privacy).

## Related pages

- [Sign in to KitStak](/docs/getting-started/sign-in)
- [Export and delete your data](/docs/getting-started/export-and-delete-data)
- [Get help with KitStak](/docs/getting-started/get-help)
