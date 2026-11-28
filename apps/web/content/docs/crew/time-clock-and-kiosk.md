---
title: The time clock and kiosk
description: How Crew is planned to let people clock in at a shared kiosk by the door or on their phone, take breaks and switch jobs during a shift.
section: Shifts and time
order: 20
---

> **Note:** Crew is planned and not available yet. This page describes how it is planned to work, and details may change before launch.

Crew is planned to have two ways to clock in: a shared kiosk by the door, and a phone clock for people who sign in. Every punch lands on the person's record and, once approved, becomes their paid hours.

## The kiosk

The kiosk is a tablet on the wall by the door. It is planned to be built for the floor, not a desk:

- Big targets that work with gloves on.
- A badge or a PIN to clock in, and an optional photo at each punch.
- It keeps working through short network drops and sends the punches when it is back online.
- English and Spanish.

The kiosk signs in as the site, so the people using it do not need a KitStak account. Which tablets are supported is still being decided.

## The phone clock

People who also sign in to KitStak are planned to clock in on their phone. A site fence can require them to be at the site when they punch.

## What a punch can be

| Punch | What it records |
| --- | --- |
| Clock in | The start of a shift. |
| Break start and end | A meal or rest break. |
| Switch | A move to another job or area during the shift. |
| Clock out | The end of a shift. |

Switches are optional. When people clock onto a job, Pulse can use that time for the job's labor hours instead of a supervisor typing people times hours. Whether that writes Pulse hours on its own or waits for a supervisor to approve them is still being decided.

## Stopping buddy punching

A badge plus a PIN, a photo at the punch, and the site fence for phones all make it harder for one person to clock in for another. Each one has a privacy cost, so each is planned to be a setting your organization turns on or off.

## Labor rules

Overtime, breaks and rounding rules differ by state. Crew is planned to keep these rules as settings for each site, so a site in a state with daily overtime counts it that way. Crew is planned to never round time in the shop's favor by default.

## Related

- [Approve hours and send them to payroll](/docs/crew/approve-hours)
- [Attendance and time off](/docs/crew/attendance-and-time-off)
