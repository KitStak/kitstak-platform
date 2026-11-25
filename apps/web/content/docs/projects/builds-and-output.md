---
title: Plan builds and log output
description: Add builds by hand, with the planner or from a schedule, log what the floor built each day, close a day short or move the rest, and use Floor today.
section: Programs
order: 30
---

A build is one batch of one variant for a day. You plan builds ahead, by hand, in the build planner or with a schedule, and the floor logs what got built each day. Revenue, the statement and Pulse stay up to date on their own.

## Before you start

- Editors and owners of the program can plan builds and log output. Others see **You can view output. Editors can log it.**
- The program needs variants before you plan builds. Otherwise the **Builds** tab says **Add variants before you plan builds**.

## Add one build

1. In the program, press `B`, or open the program menu and select **New build**. You can also pick **New build** from **More ways to create** in the top bar.
2. Type it like `build 100 small brown glove tomorrow` in **Describe the build**. The program, variant, quantity and day are picked out as you type.
3. Check the **Program or project** and the **Variant**. If a word is close to more than one variant, Projects asks **Did you mean** and offers choices.
4. Select **Create build**, or press `Enter`. Tick **Add another** to keep going.

### Build quick add words

| Part | Example | Notes |
| --- | --- | --- |
| `build` | `build` | Starts build mode in quick add |
| Quantity | `100` | Planned units |
| Variant words | `small brown` | Matched against the program's variant names, keys and SKUs |
| Program | `glove` or `+KITS` | A word of the program name, or its key |
| Day | `tomorrow`, `fri`, `next mon` | The same date words as tasks. See [quick add syntax reference](/docs/projects/quick-add-syntax) |
| Assignee | `@dana` | Same as tasks |
| Priority | `!high` | Same as tasks |

A build can also live in an ordinary project. It then has no variant and is priced by its build rate or its Pulse job.

## Plan many builds with the planner

1. In the program, select **Plan builds**, or press `Shift` `B`.
2. The grid shows variants down the side and days across the top. Type a quantity in each cell.
3. Use the keyboard: arrow keys move, `Ctrl` `D` fills right, `Ctrl` `Shift` `D` fills down, and `Delete` clears cells.
4. To copy a block from a spreadsheet, select **Paste from a spreadsheet** or press `Ctrl` `V`. The first column is the SKU or variant, the next columns are the days shown, with a date header row.
5. Optional: select **Apply schedule** to fill the grid from a schedule, or **Bring in** to import a CSV.
6. Check the summary, then select **Create builds**, or press `Ctrl` `Enter`.

Cells that already have a build are skipped. When the program has history, builds from the last 4 weeks suggest quantities.

## Let a schedule make builds

A schedule makes builds ahead of time on the days you pick. Each day it makes is one run. Set one up on the **Schedule** tab. See [variants, price cards and month close](/docs/projects/program-pricing-and-close).

## The Builds tab

| Control | What it does |
| --- | --- |
| **Builds view** | **Board**, **List**, **Table**, **Timeline**, **Calendar** or **Runs** |
| **Date range** | The days shown, or a **Custom range** |
| **Work type** | **Both**, **Tasks** or **Builds** |
| **Variant** | Show one or more variants |
| **Unplanned** and **Short** | Only builds made while logging output, or only builds closed below plan |
| **Bring in** | **Import output** (a CSV with date, SKU or variant, qty) or **Import plan** (makes planned builds from a CSV) |
| **Share** | **Export CSV**, **Print build tickets** (one ticket per build in the range) and **Share report** (the production report for the week) |

The **Runs** view groups the day's builds by run, with what was built and what is left.

## Log output for a day

1. In the program, select **Log output**, or press `O`. From **Floor today** or the **Programs** page, pick the program first.
2. Move between days with **Day before** and **Day after**. Output can be logged for today or earlier.
3. For each build, type what was **Built**. Press `Enter` for the next row, `Shift` `Enter` for the previous one, and `=` to fill the remaining quantity.
4. To scan, press `/` to jump to **Scan or type a SKU** and scan or type the SKU. Projects jumps to that build's row. Turn on **Count each scan** to add to the row on every scan instead.
5. Optional: show scrap with **Show scrap**, or add a note to a row.
6. **Mark done** closes a build when it is full. Uncheck it to keep the build open.
7. Select **Save**, or press `Ctrl` `Enter`.

If the floor built something nobody planned, add a new row with **Variant for the new row** and **Built for the new row**. It becomes an **Unplanned** build where planned equals built.

If someone else logs output on the same build while you type, Projects tells you how much changed and shows the new total.

### Close the day

1. Select **Save and close the day**.
2. For each build still below plan, choose **Close short** and give a reason, or **Leave open**, or move the rest to the next work day.
3. Confirm.

A closed day can't change. Owners can reopen the month from **Settings > Month close**.

## Floor today

1. Go to **Floor today** in the sidebar, or press `G` then `F`.
2. Pick the day with **Day before** and **Day after**.
3. Each running program shows its builds for that day. Log output program by program.
4. When everything is in, select **Close the day for all**. Builds still below plan are listed by program, with **Close short** or **Leave open** for each.

## Change a build

Open a build's menu:

| Item | What it does |
| --- | --- |
| **Change variant** | Picks another variant |
| **Move to day** | **Tomorrow**, **Next work day**, or **Pick a date** |
| **Duplicate** | Makes a copy |
| **Move to program or project** | Moves it to another program or project |
| **Delete build** | Deletes it. Only when nothing was logged |

The build page shows its **Run**, **Schedule**, **Variant**, **Planned**, **Built**, **Remaining** and **Scrap**, where its revenue goes (**Revenue goes to**), and every day's output. People who manage the program's prices can **Set build rate** to price one build differently from the card, or go back with **Use card rate**.

## Related

- [Create a program](/docs/projects/create-a-program)
- [Variants, price cards and month close](/docs/projects/program-pricing-and-close)
- [Keyboard shortcuts](/docs/projects/keyboard-shortcuts)
