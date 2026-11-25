---
title: Price a job with the calculator
description: Use the quote calculator to get the price for your target margin, the lowest price worth taking and the break even, test pace and price, and turn a scenario into a job.
section: Quote vs actual
order: 30
---

The **Calculator** prices a new job, or tests a what if, before you say yes. Type the units, the pace and the crew, and it gives the price per unit for your target margin, the lowest price worth taking and the break even price. Save a scenario to come back to it, compare two, or turn one into a job whose quote is the scenario.

## Before you start

- The calculator needs a role that sees money. Saving scenarios needs a manager.
- It needs at least one labor rate. Without one it says **The calculator needs a labor rate first**. See [Set labor classes and rates](/docs/pulse/labor-rates).

## Price a job

1. Go to **More > Calculator**.
2. Under **What you know about the job**, pick the client and the **Job type**. The job type fills in its target pace and margin. Or use **Start from a past job** to fill the form with what that job really did.
3. Type the units and **What one unit is called**.
4. Check the **Target pace**. Units divided by the pace gives hours. Hours times the real cost of an hour gives labor cost.
5. Add **Setup hours**, and the crew: one line per **Labor class**, with the people. Use **Another labor class** for a mixed crew.
6. Under **Who buys the parts**, pick who does, and type the **Material per unit** if you buy them.
7. Add **Extra services** (how many, price each, cost each) and **Other costs** for the whole job.
8. Set the **Target margin**. Leave **Price to test** empty to get the price for your target, or type a price to test it.

Nothing is saved until you press **Save scenario**.

## Read the answer

| Figure | What it means |
| --- | --- |
| **Price per unit for your target margin** | All cost divided by one minus your target margin, per unit, rounded up so the target is always met. |
| **Total for the job** | Units times the price per unit, plus what the extra services bring in. |
| **Job margin** | Profit divided by revenue, after every cost. Its last line, **Before time not on a job**, leaves that time out. |
| **All cost of the job** | Labor, material, other costs, the cost of extra services and time not on a job. |
| **Break even price** | Where revenue just covers all cost. Profit is zero at this price. |
| **Break even units** | Units needed to win back setup and other fixed costs. |
| **Lowest price worth taking** | Covers labor, material and other costs, before time not on a job. Under this, say no. |
| **Cost per unit** | All cost divided by the units, split by kind. |

**Time not on a job** is filled from your last 90 days, or 0 if your workspace does not spread it.

## If the crew is slower or faster

The grid **If the crew is slower or faster** shows each pace from 20% under the target pace to 20% over, by price. The middle cell is the answer above. Use **Show margin or profit** to switch the cells. Cells are marked when the job makes money under target or loses money.

## What happened last time

**What happened last time** lists similar past jobs, with the same client marked, showing their real pace and margin. Compare the pace you typed with what these jobs really did before you send the price.

## Save, compare and turn into a job

| Button | What it does |
| --- | --- |
| **Save scenario** | Saves the numbers under the **Scenario name**, like "Holiday kit at 40 an hour". |
| **Save as new** | Saves a copy of an open scenario. |
| **Scenarios** | Opens **Saved scenarios**. Each one has a status: **Draft**, **Sent to the client**, **Won** or **Lost**. |
| **Compare** | **Compare two scenarios** side by side. The last column is the second less the first. |
| **Create a job from this** | The price, pace, crew and costs become a new planned job and its quote, so plan vs actual starts from what you quoted. |
| **Start over** | Clears the form. |

## Test a what if on a real job

To test a new price, pace, crew or rate on a job that is running, use the what if panel on the job's **Overview**, or open the job in the calculator with **Start from a past job**. See [Work with a job page](/docs/pulse/job-page).

## Worked example (made-up figures)

All cost of a job is $10,000.00 for 5,000 units, and your target margin is 30%.

- Revenue needed: $10,000.00 / (1 less 0.30) = $14,285.72, rounded up.
- Price per unit: $14,285.72 / 5,000 = $2.8572, rounded up to 4 places.
- If time not on a job is $400.00 of the cost, the lowest price worth taking is $9,600.00 / 5,000 = $1.92.

## Related

- [Add a quote or a budget](/docs/pulse/quotes-and-budgets)
- [Add a job](/docs/pulse/add-a-job)
- [Set a target pace](/docs/pulse/target-pace)
