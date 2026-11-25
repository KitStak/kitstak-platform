---
title: Set labor classes and rates
description: Build the real cost of an hour for each labor class from the wage, payroll taxes, benefits and overhead, see what a change does before you save, and date raises.
section: Costs and rates
order: 10
---

An hour of work costs more than the wage. The **real cost of an hour** is the wage, plus payroll taxes and benefits, plus overhead for each hour. Pulse builds that number with you for each labor class, such as Packer, Line lead or Temp packer, and uses it for every hour logged.

## Before you start

- The **Rates** tab needs an admin or the owner, because it holds wages. Managers see the real cost of an hour but never the wage.
- The fill in numbers for a new rate come from **Settings > Labor defaults**. See [Workspace settings](/docs/pulse/workspace-settings).

## Add a labor class

1. Go to **Labor** and open the **Rates** tab.
2. Select **Add a labor class**.
3. Type the **Name** and pick the **Kind**: **Your employees** (people on your own payroll) or **Temp agency**.
4. Save. Pulse asks you to add its rate next.

One class is the **Default class**. Hours logged with no class use it.

## Add or change a rate

1. Pick the labor class in the list.
2. Select **Add a rate**, or **Change the rate** when it has one.
3. Fill in the fields below. The readout shows what one hour really costs and what an overtime hour costs as you type.
4. Read **What this changes**.
5. Select **Add the rate** or **Save the rate**.

| Field | What to type |
| --- | --- |
| **Wage for an hour** | The hourly wage. For a temp agency class this reads **What the agency bills for an hour**, and taxes and benefits are usually 0. |
| **Payroll taxes and workers comp** | A percent of the wage. |
| **Benefits and paid time off** | A percent of the wage. |
| **Other** | Anything else you pay per hour worked, as a percent of the wage. |
| **Overhead for each hour** | Rent, utilities, equipment and office staff, spread over each hour worked. |
| **Overtime multiplier** | Usually 1.5. A number from 1 to 5. |
| **Starts on** | The first day the rate applies. Earlier days keep the older rate. |
| **Where** | All sites, or one site. A rate for one site beats the all sites rate there. |
| **Note** | Why it changed. |

## See what a change does before you save

**What this changes** reads like: "This changes 212 logged entries across 9 jobs and lowers profit by $1,430.00." Entries dated in a closed month keep their old cost, and the box says how many. With no logged work from the start day on, nothing is costed again and the rate is used for new entries.

## Let Pulse suggest overhead

When you have typed company costs (rent, salaried staff and the like), the **Overhead for each hour** box shows a suggestion: your company costs of the last 3 full months, spread over the hours on jobs in those months. Select **Use it** to fill it in. See [Add other costs and company costs](/docs/pulse/other-and-company-costs).

## The math

- Real cost of an hour = wage x (1 + taxes + benefits + other) + overhead.
- Overtime hour = wage x multiplier x (1 + taxes) + wage x (benefits + other) + overhead. Taxes grow with overtime pay. Benefits and overhead do not.
- Pay of an hour (used for paid time not on any job) = the real cost of an hour less overhead.

## Worked example (made-up figures)

A packer earns $16.00 an hour. Taxes are 9%, benefits 12%, other 0%, overhead $2.40, overtime 1.5.

- Real cost of an hour: $16.00 x 1.21 + $2.40 = $19.36 + $2.40 = $21.76.
- Overtime hour: $16.00 x 1.5 x 1.09 + $16.00 x 0.12 + $2.40 = $26.16 + $1.92 + $2.40 = $30.48.
- Pay of an hour: $19.36.

## Which rate an entry uses

1. Pulse looks at the rates of the entry's labor class that start on or before the work day.
2. A rate for the entry's site wins over an all sites rate. Among those, the latest start day wins.
3. An entry with no labor class uses the **Default class**.
4. A class with no rate uses **Real cost of an hour when no rate is set** from Labor defaults.
5. With no fallback either, the hours cost nothing and the job shows **Not enough data** with **Add a labor rate**.

## Rate history

Each class lists its rates newest first, marked **In use now** or **Starts later**, with the parts: wage, the percent on top and overhead. You can edit or remove a rate. Removing one costs the hours from that day on again with the earlier rate.

## Related

- [Read where time and labor cost go](/docs/pulse/labor-time-and-cost)
- [Workspace settings](/docs/pulse/workspace-settings)
- [Import a CSV file](/docs/pulse/import-csv)
