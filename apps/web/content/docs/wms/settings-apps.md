---
title: Apps and add-ons
description: Activate, configure and deactivate KitStak WMS apps such as Labor Analytics, Operational Analytics, Scale, Custom Branding, single sign-on and API users.
section: Settings and admin
order: 60
---

Apps switch extra features on for your whole company. Activating an app makes its screens and actions available to every user whose role allows them, and its gear icon opens the app's settings. Deactivating it hides them again and keeps the settings for next time.

## Before you start

- Anyone can browse apps. Activating, deactivating and configuring them needs **Update** on **Company Settings**. Without it, the page shows **Read-only access**.

## Open Apps

Go to **Settings > Company > Apps**. The tabs are **Popular apps**, **Active apps** and **All apps**, and the search box filters by name and description. Each card has the app's name and description, a gear icon for its settings, **Details**, and **Activate** or **Activated**.

## Activate an app

1. Find the app and select **Activate**.
2. The message names what is now available.
3. If the app has settings, the settings panel opens. Fill them in and save.

To deactivate, select **Activated** on the card and confirm with **Yes, deactivate**. The app's features will no longer be available, and its screens and actions are hidden for every user. Settings are kept if you activate it again. Every activation, deactivation and settings change is written to the app's change log and the audit log.

## Apps and their settings

| App | What it unlocks | Settings |
| --- | --- | --- |
| **Labor Analytics** | Average task, associate task, performance quadrant, associate and receiving analyses. | **Target units per hour** (1 to 5000), **Exclude idle gaps longer than** (1 to 240 minutes). |
| **Operational Analytics** | Inbound and inventory, fulfillment, management and productivity dashboards. | **Dashboard refresh**: 5, 15, 30 or 60 minutes. |
| **Scale** | Live weight capture at the packing station with USB scales in Chrome and Edge, and weight variance warnings before a label prints. | **Scale unit**, **Variance warning above** (percent), **Capture automatically when the reading is stable**, **Baud rate**. |
| **Custom Branding** | Your accent color across the app, on printouts and in emails, and your logo on printouts and a sign-in page message. | **Accent color**, **Use the accent color in the app**, **Show the company logo on printouts**, **Use the accent color for printout headings**, **Sign-in page message**, **Email footer**. |
| **Single sign-on (SSO)** | The SSO button on the sign-in page, SAML 2.0 service provider metadata and the option to require SSO. | See [Single sign-on with OpenID Connect and SAML](/docs/wms/sso-single-sign-on). |
| **API User** | API users with token access for integrations. **Show API users** opens them on the **Users** list. | **Token lifetime**: 1 to 365 days. |
| **Two Boxes** | Ship one order in two boxes from the packing station, with two labels and box level contents. | **Max boxes per order**: 2 to 10. |
| **AI Jobs** | The AI Job type in Wave Rules, built by walking distance and cart capacity. | **Max orders per AI job** (1 to 500), **Optimize for**. |

Once active, many cards show a link to the feature, such as **Open labor analytics** or **Open dashboards**.

## Custom Branding details

| Setting | What it does |
| --- | --- |
| **Accent color** | A hex color such as `#2F6FDE`. Used for buttons, links, active navigation and printout headings. |
| **Use the accent color in the app** | Every user sees it after their next page load. |
| **Show the company logo on printouts** | The logo comes from **Company Settings**. |
| **Sign-in page message** | Shown under the sign-in form, such as your support contact. |
| **Email footer** | Added to invites and password emails. |

## Related

- [Labor analytics and operational dashboards](/docs/wms/analytics-labor-and-operational)
- [Company settings and security](/docs/wms/settings-company-and-security)
- [Single sign-on with OpenID Connect and SAML](/docs/wms/sso-single-sign-on)
