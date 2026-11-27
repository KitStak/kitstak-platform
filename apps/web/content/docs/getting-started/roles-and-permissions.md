---
title: Roles and what each can do
description: Owner, admin, member, viewer, guest and billing only. See what each role can do in the Portal, who uses a seat, and how to change or remove someone.
section: Users and roles
order: 30
---

Every person in an organization has a role. The role decides what they can do in the Portal, and each app uses the same role names for its own rights. Billing manager is a separate right that an owner can give to anyone, on top of their role.

## The roles

| Role | Uses a seat | In short |
| --- | --- | --- |
| **Owner** | Yes | Can do everything, including billing and naming billing managers. |
| **Admin** | Yes | Runs the team: invites, roles, the profile and setup. Can see billing and start the free trial, but not pay. |
| **Member** | Yes | Uses the apps. Sees a short billing card that says who manages billing. |
| **Viewer** | Yes | Same as a member in the Portal. Each app decides what a viewer can change. |
| **Guest** | No | Sees only what the team adds them to. No setup guide. |
| **Billing only** | No | Manages billing and nothing else. No access to CRM, WMS, Projects or Pulse. |

What a role can do inside an app is set by that app. See the [CRM docs](/docs/crm), [WMS docs](/docs/wms), [Projects docs](/docs/projects) and [Pulse docs](/docs/pulse).

## What each role can do in the Portal

| Task | Owner | Admin | Member or viewer | Guest | Billing only |
| --- | --- | --- | --- | --- | --- |
| Open the apps on the plan | Yes | Yes | Yes | What they are added to | No |
| Edit the organization profile | Yes | Yes | No | No | No |
| Invite people, change roles, remove people | Yes | Yes | No | No | No |
| Use and skip steps in the setup guide | Yes | Yes | Read only | Not shown | Not shown |
| See the welcome screen after sign up | Yes | Yes | No | No | No |
| See plans, invoices, details and activity | Yes | Yes | No | No | Yes |
| Start the free trial or change trial apps | Yes | Yes | No | No | Yes |
| Pay, change a paid plan, cancel or pause | Yes | No | No | No | Yes |
| Edit billing details | Yes | No | No | No | Yes |
| Add or remove a billing manager | Yes | No | No | No | No |
| Ask for an app on the Billing page | No | No | Yes | Yes | No |

A billing manager keeps their own role and also gets every billing right in the **Owner** column, except adding or removing billing managers. A billing manager needs no admin rights over data.

A person with the **Billing only** role is a billing manager by that role alone. Their Portal home is Billing, and their **Account menu** has no **Apps** row.

## Seats

- A seat is one person who can sign in to the apps. **Admin**, **Member** and **Viewer** each use one.
- **Guest** and **Billing only** are free and use no seat.
- An open invite with a seat role holds a seat until it is accepted or canceled.
- During a free trial there is no seat limit.
- On a paid plan, seats are counted against the plan. See [Change your plan, seats and warehouses](/docs/getting-started/change-your-plan).

## Change someone's role

1. Go to **Organization settings** and find the person under **Members**.
2. Pick a new role in the role list on their row: **Admin**, **Member**, **Viewer** or **Guest**.
3. The change saves at once.

You cannot change your own role, an owner's role, or a **Billing only** person from this list. Billing only people are managed on **Billing > Team**. People who cannot change roles see the role as a label.

## Remove someone

1. Under **Members**, select **Remove** on the person's row.
2. The dialog asks **Remove** and their name. It says **They lose access to every app now.**
3. On a paid plan it also says the seats you still pay for, for example **You still pay for 6 seats until you lower them.** Removing a person never lowers the bill by itself.
4. Select **Remove** to confirm, or **Keep** and their first name to stop.

After removing, a line says the person **was removed. To bring them back, send a new invite.**

> **Tip:** To pay for fewer seats after someone leaves, lower **People on your team** on **Billing > Plan**.

## Related pages

- [Invite people to your organization](/docs/getting-started/invite-people)
- [Billing team and billing details](/docs/getting-started/billing-team-and-details)
- [Organizations and switching between them](/docs/getting-started/organizations)
