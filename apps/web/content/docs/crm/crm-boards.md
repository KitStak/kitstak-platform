---
title: "The CRM boards: leads, deals, accounts, contacts and activities"
description: Learn the columns, groups, labels and views of the five CRM boards and how leads, deals, accounts, contacts and activities link to each other.
section: Accounts and pipelines
order: 10
---

The CRM is built from five connected boards. **Leads** holds people you haven’t qualified yet. **Deals** holds opportunities. **Accounts** holds the companies you sell to and **Contacts** the people who work there. **Activities** logs calls, meetings and other touches. Each board is a normal board, so you can add columns, views and automations to it.

## Before you start

Create the boards with the CRM suite, a starter CRM during setup, or one template at a time. See [Create a board from scratch or a template](/docs/crm/create-a-board).

## How the boards link

| From | Column | Links to |
| --- | --- | --- |
| Deals | **Account** | One account |
| Deals | **Contacts** | The deal’s contacts |
| Contacts | **Account** | The contact’s account |
| Contacts | **Deals** | The contact’s deals |
| Accounts | **Contacts** | The account’s contacts |
| Accounts | **Deals** | The account’s deals |
| Activities | **Deal**, **Contact** | The deal and contact the activity belongs to |

The links are two-way: linking a deal to an account also lists the deal on the account. The Accounts board mirrors deal values in **Pipeline value**.

## Leads

| Column | Type |
| --- | --- |
| **Lead** | Name |
| **Status** | Status: **New lead**, **Working on it**, **Contacted**, **Qualified** (Done), **Unqualified**, **Nurturing** |
| **Owner** | People |
| **Company**, **Title** | Text |
| **Email**, **Phone** | Email, Phone |
| **Source** | Status: **Website**, **Referral**, **Event**, **Outbound**, **Partner**, **LinkedIn**, **Webinar** |
| **Lead score** | Numbers |
| **Priority** | Status: **Critical**, **High**, **Medium**, **Low** |
| **Country** | Country |
| **Created** | Creation log |

Groups: **New leads**, **Active leads**, **Qualified** and **Disqualified**. Views: **Main table**, **Lead funnel** (kanban), **By source** (chart) and **Lead capture form**. See [Convert a lead](/docs/crm/convert-a-lead).

## Deals

| Column | Type |
| --- | --- |
| **Deal** | Name |
| **Stage** | Status: **Lead**, **Discovery**, **Proposal**, **Negotiation**, **Won** (Done), **Lost** |
| **Owner** | People |
| **Deal value** | Currency |
| **Close probability** | Numbers (%) |
| **Forecast value** | Formula: deal value weighted by close probability |
| **Expected close** | Date |
| **Priority** | Status |
| **Timeline** | Timeline |
| **Account**, **Contacts** | Connect boards |
| **Source** | Status |
| **Next step** | Text |
| **Last updated** | Last updated |

Groups: **This quarter**, **Next quarter**, **Closed won** and **Closed lost**. Views: **Main table**, **Pipeline** (kanban by stage), **Close dates** (calendar), **Pipeline by stage** (chart), **Forecast** (open deals by stage, sorted by close date) and **Deal timeline**.

## Accounts

| Column | Type |
| --- | --- |
| **Account** | Name |
| **Industry** | Dropdown |
| **Company size** | Status: **1 to 50** up to **5,000+** |
| **ARR** | Currency |
| **Region** | Status: **North America**, **EMEA**, **APAC**, **LATAM** |
| **Health** | Status: **Healthy** (Done), **Needs attention**, **At risk** |
| **Account owner** | People |
| **Website** | Link |
| **Contacts**, **Deals** | Connect boards |
| **Pipeline value** | Mirror of the linked deals |
| **HQ** | Location |

Groups: **Customers**, **Prospects** and **Churned**. Views: **Main table**, **ARR by region** (chart) and **Account health** (kanban).

## Contacts

| Column | Type |
| --- | --- |
| **Contact** | Name |
| **Email**, **Phone** | Email, Phone |
| **Title** | Text |
| **Account**, **Deals** | Connect boards |
| **Type** | Status: **Customer**, **Prospect**, **Partner**, **Champion**, **Former customer** |
| **Owner** | People |
| **Last contacted** | Date |
| **LinkedIn** | Link |
| **Country** | Country |

Groups: **Decision makers**, **Champions & influencers** and **Other contacts**. Views: **Main table** and **By type** (kanban).

## Activities

| Column | Type |
| --- | --- |
| **Activity** | Name |
| **Type** | Status: **Call**, **Meeting**, **Email**, **Demo**, **Task** |
| **Status** | Status: **Planned**, **Done** (Done), **Cancelled** |
| **Owner** | People |
| **Date** | Date with time |
| **Duration** | Numbers |
| **Deal**, **Contact** | Connect boards |
| **Notes** | Long text |

Groups: **Upcoming** and **Completed**. Views: **Main table**, **Calendar** and **Activity mix** (chart). See [Account and contact 360 pages](/docs/crm/account-and-contact-pages) to log activities from a record.

## Keep the CRM columns

The pipeline, the 360 pages, lead conversion and duplicate checks read the template columns, such as **Stage**, **Deal value**, **Close probability**, **Expected close** and **Owner** on Deals. You can rename them and add your own columns, but keep these columns on the board.

## Related pages

- [Read the pipeline and forecast](/docs/crm/pipeline)
- [Convert a lead](/docs/crm/convert-a-lead)
- [Account and contact 360 pages](/docs/crm/account-and-contact-pages)
- [Find and merge duplicate records](/docs/crm/duplicates)
