---
title: Single sign-on with OpenID Connect and SAML
description: Set up the single sign-on app with OpenID Connect or SAML 2.0 details, test the connection, limit email domains and see how sign-in behaves today.
section: Settings and admin
order: 30
---

Single sign-on connects KitStak WMS to your company identity provider. You set it up in the **Single sign-on (SSO)** app: the protocol, the provider's details, allowed email domains and whether SSO is required. Once it is active, the sign-in page shows a button such as **Sign in with Okta**. Read the section on sign-in today before you turn it on.

## Before you start

- You need **Update** on **Company Settings** to configure and activate apps.
- Every person who signs in with SSO must already be an active KitStak user with the same email. SSO never creates users. See [Add and manage users](/docs/wms/user-manage-users).
- You need admin access to your identity provider to create an app there.

## Set up OpenID Connect

1. In your identity provider, create an OpenID Connect web app.
2. In KitStak, go to **Settings > Company > Apps** and find **Single sign-on (SSO)**.
3. Open its settings with the gear icon.
4. Set **Protocol** to **OpenID Connect** and choose the **Identity provider**.
5. Copy the **Sign-in redirect URI** shown in the panel into the identity provider app. The **Initiate login URI** is there too if your provider asks for one.
6. Fill in **Issuer URL**, **Client ID** and **Client secret** from the identity provider app.
7. Optionally set the **Sign-in button label**, **Allowed email domains** and **Require SSO for every non-admin user**.
8. Save, then select **Test saved settings**.
9. When the test reads **Connection OK**, select **Activate** on the app card.

KitStak won't activate the app before it is set up. Selecting **Activate** first opens the settings with **Set up single sign-on first**.

## Fields

| Field | What it does | Required |
| --- | --- | --- |
| **Protocol** | **OpenID Connect** or **SAML 2.0**. | Yes |
| **Identity provider** | **Okta**, **Microsoft Entra ID**, **Google Workspace**, **Auth0** or **Other**. | Yes |
| **Sign-in button label** | Defaults to Sign in with and the provider name, or Sign in with SSO for **Other**. | No |
| **Issuer URL** | KitStak reads the provider's `/.well-known/openid-configuration` from it. Must start with `https://`. | OpenID Connect |
| **Client ID** | From the identity provider app. | OpenID Connect |
| **Client secret** | Stored encrypted and never shown again. Leave blank to keep the saved one. | OpenID Connect |
| **Identity provider entity ID** | From the identity provider. | SAML 2.0 |
| **Single sign-on URL** | Must start with `https://`. | SAML 2.0 |
| **X.509 signing certificate** | The provider's signing certificate. | SAML 2.0 |
| **Allowed email domains** | Comma separated, such as `northbay.example`. Empty allows any domain. | No |
| **Require SSO for every non-admin user** | Password sign-in keeps working for admins, so you can't lock yourself out. | No |

## The connection test

**Test saved settings** checks the saved values, so save first.

| Protocol | Checks |
| --- | --- |
| OpenID Connect | **OpenID configuration** found at the issuer, **Signing keys (JWKS)** reachable, **Client ID** and **Client secret** present. |
| SAML 2.0 | **Signing certificate** is a valid X.509 certificate and not expired, **Single sign-on URL** starts with `https://`. |

## SAML 2.0

With **Protocol** set to **SAML 2.0**, the panel shows the **SP entity ID / metadata** and the **ACS URL** to paste into your identity provider, and KitStak validates the provider's certificate. The sign-in button itself uses OpenID Connect, so to turn on sign in with SSO, switch **Protocol** to **OpenID Connect**. Every identity provider in the list offers an OpenID Connect app. A SAML assertion sent to KitStak returns the user to the sign-in page with the message that SAML sign-in isn't enabled.

## What happens at sign-in today

Once the app is active with **OpenID Connect**, the sign-in page shows your SSO button. Selecting it currently brings the user back to the sign-in page with the message **Single sign-on is being upgraded and is temporarily unavailable. Use your password.** Users sign in with their KitStak email and password in the meantime.

> **Important:** Keep **Require SSO for every non-admin user** off while the SSO button returns that message. With it on, users who hold no **Admin** role can't sign in with a password either.

The rules KitStak applies to SSO users stay the same: SSO never creates users, the email must belong to an active KitStak user, and admins can always sign in with a password.

## Related

- [Company settings and security](/docs/wms/settings-company-and-security)
- [Apps and add-ons](/docs/wms/settings-apps)
- [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs)
