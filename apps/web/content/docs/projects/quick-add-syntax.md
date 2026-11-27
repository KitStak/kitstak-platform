---
title: Quick add syntax reference
description: Every date word, priority mark, @person, #label and +project token quick add understands, with worked examples and the rules for matching.
section: Quick add
order: 20
---

Quick add reads five kinds of details out of a task name: a due date, a priority, an assignee, labels and a project. This page lists every word and mark it understands. Everything that is used is taken out of the task name; everything else stays as you typed it.

The examples below assume today is **Wednesday, December 2, 2026**, a teammate called Dana Ruiz, a label called Sales lead, and a project called Operations with the key `OPS`.

## Dates

A date sets the task's due date. Upper and lower case both work. The chip shows **Today** or **Tomorrow** for those two days, and a short date such as `Fri, Dec 4` for the rest, with the year when it is not this year.

| You type | Due date | Notes |
| --- | --- | --- |
| `today`, `tonight`, `this evening` | Wed, Dec 2 | Today |
| `tomorrow`, `tmrw`, `tmr`, `tmw` | Thu, Dec 3 | |
| `day after tomorrow` | Fri, Dec 4 | |
| `fri` or `friday` | Fri, Dec 4 | The next Friday after today. Never today |
| `wed` | Wed, Dec 9 | Today is Wednesday, so it means next week's |
| `this fri` | Fri, Dec 4 | The coming Friday, today included |
| `this wed` | Wed, Dec 2 | Today counts |
| `next fri` | Fri, Dec 11 | The Friday of next week. Weeks start on Monday |
| `next mon` | Mon, Dec 7 | The Monday of next week |
| `next week` | Mon, Dec 7 | The Monday of next week |
| `next month` | Fri, Jan 1, 2027 | The 1st of next month |
| `next year` | Fri, Jan 1, 2027 | January 1 of next year |
| `end of week`, `end of the week`, `eow` | Fri, Dec 4 | This Friday. On a Saturday or Sunday, the next Friday |
| `end of month`, `end of the month`, `eom` | Thu, Dec 31 | The last day of this month |
| `weekend`, `this weekend` | Sat, Dec 5 | The coming Saturday. Today, if it is already Saturday or Sunday |
| `in 3 days`, `in 3d` | Sat, Dec 5 | |
| `in 2 weeks`, `in two weeks`, `in 2w`, `in 2wks` | Wed, Dec 16 | |
| `in a month`, `in 1 month`, `in 1mo` | Sat, Jan 2, 2027 | Same day next month, or the last day if that month is shorter |
| `in a year`, `in 1yr` | Thu, Dec 2, 2027 | |
| `dec 5`, `december 5th`, `dec. 5` | Sat, Dec 5 | |
| `5 dec`, `5th of december` | Sat, Dec 5 | |
| `dec 5 2027`, `dec 5, 2027`, `5 dec 2027` | Sun, Dec 5, 2027 | |
| `12/5` | Sat, Dec 5 | Month first, then day |
| `12/5/27`, `12/5/2027` | Sun, Dec 5, 2027 | A two-digit year means 20xx |
| `2026-12-05` | Sat, Dec 5 | |
| `nov 20` | Sat, Nov 20, 2027 | A day without a year that already passed means next year |

### Weekday names

Quick add knows `mon`, `monday`, `tue`, `tues`, `tuesday`, `wed`, `weds`, `wednesday`, `thu`, `thur`, `thurs`, `thursday`, `fri`, `friday`, `saturday` and `sunday`.

`sat` and `sun` are everyday words, so on their own they are not read as dates. Put a lead-in word in front: `on sat`, `by sun`, `due sat` or `before sun`. `saturday` and `sunday` always count.

### Numbers in “in …”

- Use digits up to 999, or the words `a`, `an`, `one` to `twelve`.
- Units: `day`, `days`, `d`, `week`, `weeks`, `wk`, `wks`, `w`, `month`, `months`, `mo`, `mos`, `year`, `years`, `yr`, `yrs`.
- Digits may touch the unit (`in 2w`). Words may not (`in two weeks`).

### Lead-in words

`on`, `by`, `due` and `before` in front of a date are taken out with it. `Send report by fri` becomes **Send report**, due Friday.

### Month names

Quick add knows full month names and short ones: `jan`, `feb`, `mar`, `apr`, `may`, `jun`, `jul`, `aug`, `sep`, `sept`, `oct`, `nov`, `dec`.

## Priority

Start the word with `!`. It must stand on its own: a space, the end of the line, or `,` `.` `;` `:` `)` must come after it.

| You type | Priority |
| --- | --- |
| `!urgent`, `!u`, `!p1`, `!1`, `!critical`, `!asap`, `!!!!` | **Urgent** |
| `!high`, `!h`, `!p2`, `!2`, `!important`, `!!!` | **High** |
| `!medium`, `!med`, `!m`, `!normal`, `!p3`, `!3`, `!!` | **Medium** |
| `!low`, `!l`, `!p4`, `!4` | **Low** |
| `!none`, `!no` | **No priority** |

## Assignee

Start the name with `@`. Quick add looks for an exact match first, then a name that starts with what you typed, as long as only one person matches. Case, spaces, dots, dashes, underscores and accents are ignored.

| You type | Matches Dana Ruiz because |
| --- | --- |
| `@dana` | Her first name |
| `@ruiz` | Her last name |
| `@danaruiz`, `@dana.ruiz` | Her full name |
| `@druiz` | First initial and last name |
| `@dr` | Her initials |
| `@dan` | The start of a name only she has |
| `@` and the part of her email before the `@` | Her email name |

`@me` assigns the task to you.

If nobody matches, a red chip such as **No one named sam** appears. The task stays unassigned, and the word leaves the name. Select **×** on the chip to keep it as text.

## Labels

Start the label with `#`. You can add several labels. Matching is exact, ignoring case, spaces, dashes and underscores, so `#sales-lead` and `#saleslead` both match the label **Sales lead**. A partial name does not match: `#sales` does not pick **Sales lead**.

A `#` followed only by digits, such as `#42`, is not a label and stays in the name.

A label name that matches nothing becomes a new label when you save, shown as **sales (new)**, if you are an editor or owner of the project. Dashes and underscores turn into spaces in the new name.

## Project

Start with `+` and the project key or name: `+OPS` or `+operations`. An exact match wins first, then a unique start of a key or name, such as `+oper`.

If nothing matches, a red chip such as **No project called xyz** appears and the text stays in the name.

## When there is more than one

- If you type two dates, two priorities, two people or two projects, the last one wins. The others stay in the task name.
- Where two date phrases overlap, the longer one wins: `next fri` beats `fri`, and `dec 5 2027` beats `dec 5`.
- A token inside another token is ignored. `@friday` is a person, not a date.

## Worked examples

| You type | Task name | Due | Priority | Assignee | Labels | Project |
| --- | --- | --- | --- | --- | --- | --- |
| `Order pallet wrap next fri !high @dana #sales-lead +OPS` | Order pallet wrap | Fri, Dec 11 | High | Dana Ruiz | Sales lead | Operations |
| `Send the quote by eow !!` | Send the quote | Fri, Dec 4 | Medium | | | |
| `Call the supplier tomorrow @me` | Call the supplier | Thu, Dec 3 | | You | | |
| `Count dock 2 on sat !p1` | Count dock 2 | Sat, Dec 5 | Urgent | | | |
| `Renew the lease 12/5/27` | Renew the lease | Sun, Dec 5, 2027 | | | | |

## Builds in programs

In a program, start the line with `build` to add a build instead of a task, such as `build 100 small brown glove tomorrow`. The quantity, variant, program and day are picked out as you type. See [plan builds and log output](/docs/projects/builds-and-output).

## Related

- [Add tasks with quick add](/docs/projects/quick-add)
- [Keyboard shortcuts](/docs/projects/keyboard-shortcuts)
