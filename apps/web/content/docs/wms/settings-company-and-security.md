---
title: Company settings and security
description: Set your company name and logo, default currency, units and date format, the password policy, account lockout, idle sign-out and how KitStak sends email.
section: Settings and admin
order: 40
---

Company Settings holds what applies to your whole KitStak WMS account: how your company is named on screen and on documents, the defaults new records start with, the security policy every user signs in under, and how invites and password emails are sent.

## Before you start

- You need **View** on **Company Settings** to open the page and **Update** to change it.

## Open Company Settings

Go to **Settings > Company > Company Settings**. The left menu has four sections: **Company information**, **Account defaults**, **Security** and **Email delivery**. Each section saves on its own. **Change log** shows every change to company settings.

## Company information

| Field | What it does | Required |
| --- | --- | --- |
| **Company display name** | Short name used in the header and emails. Up to 60 characters. | Yes |
| **Company full name** | Legal name printed on documents. Up to 160 characters. | Yes |
| Logo | A JPG or PNG under 2 MB. Shown in the header and on printouts. | No |

Select **Add file** or **Replace** to upload the logo. When you remove it, the header shows the KitStak logo again and printouts show your company name. Select **Update company info** to save the names.

## Account defaults

| Field | What it does |
| --- | --- |
| **Currency** | Default for new billing contracts and product prices. |
| **Date format** | Default for new users: **M/D/YYYY (default)**, **MM/dd/yyyy**, **dd/MM/yyyy** or **yyyy/MM/dd**. Each user can change it in **Preferences**. |
| **Weight unit** | Pound, Ounce, Kilogram or Gram. |
| **Dimension unit** | Inch, Foot, Centimeter or Meter. |

Select **Save defaults**.

## Security

### Password policy

| Field | What it does |
| --- | --- |
| **Minimum length** | 8 to 64 characters. |
| **Require upper and lower case** | At least one capital and one small letter. |
| **Require a number** | At least one digit. |
| **Require a symbol** | At least one character that is not a letter or number. |
| **Passwords expire** | Users must choose a new password after a number of days. |
| **Expire after** | 1 to 3650 days. |

The section sums up the rule, for example `12+ characters with upper and lower case, a number`. New passwords must meet it. Existing passwords keep working until they are changed. The same policy checks passwords set in **Add user** and **Change Password**.

### Account lockout

| Field | What it does |
| --- | --- |
| **Lock after** | 3 to 50 failed sign-ins in a row. |
| **Lock for** | 1 to 1440 minutes. |

A locked user shows **Locked until** with the time in their user details.

### Idle sign-out

Turn on **Sign out idle users** and set **Sign out after**, from 5 to 720 minutes. Web users are then signed out after that long without activity in any open KitStak tab, with a 60 second warning first. When it is off, web sessions stay signed in until they expire or the user signs out.

Mobile devices have their own setting per warehouse: **Auto logout inactive mobile users**. See [Manage warehouses](/docs/wms/settings-warehouses).

Select **Save security settings**. Policy changes are written to the audit log as **Password policy changed**.

## Email delivery

KitStak sends welcome invites, password reset emails and scheduled report links. Choose how in **Delivery**:

| Delivery | What happens |
| --- | --- |
| **SMTP server** | Real email through your mail provider, such as Microsoft 365, Google Workspace, SendGrid or Postmark. |
| **KitStak email** | No setup needed: emails go out from KitStak's own email service. |
| **Server log only** | No email leaves the server. Invites and reset emails are written to the server log. |

The second choice is **KitStak email** when your account offers it, and **Server log only** when it doesn't.

For **SMTP server**, fill in:

| Field | What it does | Required |
| --- | --- | --- |
| **Server** | A host name such as `smtp.example.com`. | Yes |
| **Security** | **STARTTLS (port 587)**, **SSL/TLS (port 465)** or **None (local relay, port 25)**. | Yes |
| **Port** | 1 to 65535. | Yes |
| **User name** | The mail account. | No |
| **Password** | Stored encrypted and never shown again. | No |
| **From address** | Invites and password emails come from this address. Your provider must allow it. | Yes |
| **From name** | The sender name. | No |

Select **Save email delivery**. Then, in **Send a test email**, enter an address and select **Send test email**. The test uses the saved settings, so save first.

## Related

- [Add and manage users](/docs/wms/user-manage-users)
- [Single sign-on with OpenID Connect and SAML](/docs/wms/sso-single-sign-on)
- [Audit log and change logs](/docs/wms/admin-audit-log-and-change-logs)
