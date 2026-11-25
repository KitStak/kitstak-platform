---
title: Intake forms
description: Build a form with a public or workspace-only link, send each response straight to a project as a task or to Triage first, and read every response.
section: Forms
order: 10
---

An intake form is a link you share with anyone: customers, partners or teammates. Each response becomes a task in your project, or waits in the project's Triage queue first. No account is needed to fill in a public form.

## Before you start

- You need the Editor or Owner role on the project the form sends tasks to.
- You need at least one project. Otherwise the page says **Forms need a project to send tasks to**.

## Create a form

1. Go to **Forms** and select **New form**.
2. Under **Each response makes**, pick **A task** (or **A build in a program**, see [plan builds and log output](/docs/projects/builds-and-output)).
3. Under **Start with**, pick a ready-made set of questions.
4. Pick the project under **Tasks go into**.
5. Enter the **Form name** and select **Create form**.

The form opens in the builder. Adjust the questions, then share the link.

### Ready-made question sets

| Start with | Questions |
| --- | --- |
| **General request** | What do you need?, Tell us more, When do you need it by?, How urgent is it? |
| **Problem report** | What went wrong?, What happened step by step?, Where did it happen?, How bad is it?, Link to a screenshot or page |
| **Client request** | Company name, What can we help with?, Order or reference number, Details, Needed by |
| **Event sign-up** | Your full name, Team, Food needs or allergies, I’m bringing a guest |
| **Start from scratch** | What do you need? |

## Write the questions

On the **Questions** tab:

1. Edit the **Form name** and the **Intro** people see at the top.
2. Select **Add a question** and pick its answer type.
3. Write the question, and optional help text.
4. Turn on **Required** if people must answer it.
5. Under **Where the answer goes on the task**, pick where the answer lands.
6. Reorder with **Move up** and **Move down**. **Duplicate question** and **Delete question** are on each question.
7. Select **Save**.

### Answer types

| Type | What people enter |
| --- | --- |
| **Short answer** | A line of text |
| **Paragraph** | Several lines |
| **Email** | An email address |
| **Phone** | A phone number |
| **Number** | A number |
| **Date** | A date |
| **Pick one** | One choice from a list |
| **Pick several** | Any number of choices |
| **Yes / no** | A checkbox |
| **Link** | A web address |

### Where answers go

| Choice | What happens |
| --- | --- |
| **Task name** | The answer becomes the task name |
| **Task description (top)** | The answer goes at the top of the description |
| **Due date** | A date answer sets the due date |
| **Priority** | Answers like “High” or “Urgent” set the priority |
| A custom field | The answer fills that field |
| **Listed in the description** | Shown in the description as “Question: answer” |

### Rules the builder checks

- A form needs a name and at least one question.
- Every question needs words. Choice questions need at least one choice, and every choice needs words.
- Only one question can become the task name.

## Set what happens to responses

On the **Settings** tab:

| Panel | Settings |
| --- | --- |
| **New tasks** | **Start in status** (the project’s first status to start), **Section**, **Assign to**, **Priority** (used when no question sets it) and **Labels** |
| **After someone sends it** | **Send responses to Triage first**, the **Thank-you message**, and **Tell these people about each response** |
| **Who can fill it in** | **Anyone with the link** (customers, partners and teammates, no sign-in needed) or **Only people in** your organization (they sign in first, good for internal requests). With **Anyone with the link**, you can also **Ask for name and email** |
| **Form status** | **Accepting responses**. A form that is turned off shows a “not found” page until you turn it back on |

With **Send responses to Triage first** on, responses wait in the project's **Triage** tab until someone accepts them. See [triage](/docs/projects/triage). Responses also set off **a task is created** automations.

## Share the form

On the **Share** tab:

1. Under **Share link**, select **Copy** and paste the **Form link** anywhere: email, chat or your website.
2. To put the form on a website, select **Copy code** under **Put it on a website** and paste the **Embed code** into your page.

To stop an old link working, select **Make a new link**. The old link stops working right away, and anyone who has it will need the new one. If you have unsaved changes, save first so people see the latest version.

On the **Forms** page, each form has a copy link button, an on and off switch (**Stop taking responses** or **Start taking responses**), and a menu with **Edit questions**, **See responses**, **Share**, **Open the form** and **Delete**. Deleting a form keeps its tasks. Forms that only people in your organization can fill in show **Workspace only**.

## Read the responses

The **Responses** tab lists every response with when it was sent and the task it made. Select **Answers** to read them, and **Download CSV** to save them all. A response whose task was deleted shows **Task deleted**.

People filling in the form see **Sent!** and your thank-you message. If the form is closed or the link changed, they see **This form is not available**.

## Related

- [Triage](/docs/projects/triage)
- [Custom fields](/docs/projects/custom-fields)
- [Build an automation](/docs/projects/automations)
