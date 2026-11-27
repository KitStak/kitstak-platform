---
title: People, users, temps and agencies
description: How Crew is planned to keep a record of everyone on the floor, including temps who never sign in, and how it keeps pay and personal details private.
section: People
order: 10
---

> **Note:** Crew is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Crew is planned to keep one record for each person who works your floor. That includes employees, temps from an agency and seasonal hires. Most floor workers never sign in to anything, so a Crew person is not the same as a KitStak user.

## People are not users

| Question | Person | User |
| --- | --- | --- |
| What it is | Someone who works the floor | Someone who signs in to KitStak |
| Needs a sign in | No | Yes |
| Can clock in at the kiosk | Yes | Yes, if they are also a person |

A person can be linked to a user when they also sign in. A lead who uses the WMS scanner, or a supervisor who approves time, is both. A packer who only clocks in at the door is a person and nothing more.

The kiosk at the door signs in as the site, not as a person. So anyone with a badge or PIN can clock in there without a KitStak account.

## What a person record holds

- Name, site and the area they usually work.
- Labor class, like packer, lead or forklift driver.
- Pay type, hourly or salary.
- The agency that sent them, for temps.
- Start date and status: active, on leave or ended.
- An emergency contact.
- Their skills and certifications. See [Skills and certifications](/docs/crew/skills-and-certifications).

Crew is planned to keep personnel records light on purpose. Benefits and HR case files stay in the tools you use for them today.

## Temps and agencies

Temps come and go fast, so adding them is planned to take minutes, not an afternoon.

- Add an agency once, then add its people under it.
- Bring in a batch of people from a CSV file.
- Or send the agency a link where they fill in their own people.

Each week, Crew is planned to total the approved hours per agency. If you also use Ledger, it checks the agency's bill against those hours. See [How Crew connects to the other apps](/docs/crew/connected-apps).

## Who sees pay and personal details

Wages, attendance points and personal details are sensitive. The plan:

| Role | Sees |
| --- | --- |
| Lead | Their crew's schedule and punches. Not pay. |
| Supervisor | Schedules, punches and attendance for their site. Edits punches with a reason. |
| Payroll and admins | Everything above, plus pay type, wages and exports. |

Crew uses the same roles as the rest of KitStak, with extra permissions for pay. See [Getting started](/docs/getting-started) for how KitStak roles work today.

## Related

- [Shifts and the schedule](/docs/crew/shifts-and-schedule)
- [The time clock and kiosk](/docs/crew/time-clock-and-kiosk)
