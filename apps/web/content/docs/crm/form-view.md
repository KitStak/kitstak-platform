---
title: Collect responses with a form view
description: Build a form from board columns, add conditional questions, style it, publish a link or embed code, and turn every response into an item.
section: Views
order: 60
---

A form view is a public form that creates an item on the board for every response. Use it for lead capture, requests or sign-ups. People who fill it in don’t need a KitStak account and never see your board. The Leads template comes with a **Lead capture form**.

## Before you start

- You need edit access to the board to build and publish a form.
- Questions come from the board’s columns. Add the columns you need first, or add a new field from the form builder.

## Build the form

1. Select **Add view** and pick **Form**.
2. Enter the **Form title** and, optionally, a description.
3. In **Build**, select **Add question**. Pick a column under **From board columns**, or **New field (adds a column)** to create a column at the same time.
4. Drag questions by their handle to reorder them.
5. Select a question to open **Question settings**.

The name question is always required and always shown.

| Question setting | What it does |
| --- | --- |
| **Question** | The question text |
| **Description** | Help text shown under the question |
| **Required** | Respondents must answer it |
| **Hide question** | Hides the question but keeps its settings |
| **Conditional logic** | **Show this question only if** an earlier answer matches a condition |
| **Remove from form** | Takes the question off the form. The column stays on the board |

Conditional logic can only use questions above the current one. Questions are marked in the list as required, conditional or hidden.

## Design the form

In **Design**:

| Setting | What it does |
| --- | --- |
| **Accent color** | The color of buttons and highlights |
| **Alignment** | **Left** or **Center** |
| **Submit button text** | The label of the submit button |
| **Hide KitStak branding** | Removes the KitStak mark from the form |

Use **Desktop preview** and **Mobile preview** to check the layout.

## Form settings

In **Settings**:

| Section | Setting | What it does |
| --- | --- | --- |
| **After submit** | **Thank-you title**, **Thank-you message** | What respondents see after they submit |
| **After submit** | **Show “Submit another response”** | Lets them send another one |
| **After submit** | **Redirect to a URL** | Sends them to a page instead of the thank-you screen |
| **Responses** | **New items go to** | The group new items land in, or **Top group** |
| **Access** | **Close form** | Stops accepting responses now |
| **Access** | **Close on date** | Stops accepting responses on a date |
| **Access** | **Close after N responses** | Stops after a number of responses |

Spam protection is always on.

## Publish and share

1. Select **Share form**.
2. Turn on **Accept responses with a link**. A toast confirms **Form published**.
3. Select **Copy** next to the form link, or copy the code under **Embed** with **Copy embed code** to put the form on a web page.

The form shows **Live**, **Draft** or **Closed**. Turn the link off to unpublish. The link then stops accepting responses.

## What respondents see

Respondents fill in the questions and submit. Required questions show **This field is required**. Emails, numbers and dates are checked, for example **Enter a valid email address**. When a form is closed, they see **This form is no longer accepting responses**. Many submissions from one network in a short time are refused with **Too many submissions from this network. Wait a minute and try again.**

## Related pages

- [Add and manage board views](/docs/crm/board-views)
- [Automate a board with recipes](/docs/crm/automations)
- [The CRM boards: leads, deals, accounts, contacts and activities](/docs/crm/crm-boards)
