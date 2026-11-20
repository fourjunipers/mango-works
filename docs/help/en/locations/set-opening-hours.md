---
title: Set opening hours
summary: Set the times a location opens and closes on each day of the week, or mark a day closed.
keywords: [opening hours, business hours, open, close, closed day, weekend, เวลาเปิดทำการ, เวลาเปิด, เวลาปิด, วันหยุดประจำสัปดาห์]
screens: [/[tenant]/locations/[id]]
updated: 2026-11-20
---

# Set opening hours

Each location has its own **Opening hours**, one row per day of the week, in the location's own time zone.

Who can do this: owners and managers.

## Steps

1. Open **Locations** and choose the location.
2. Under **Opening hours**, type **Opens** and **Closes** for each day, such as 09:00 and 18:00.
3. Fill in both times for each open day. For a day the location is closed, leave both blank: it shows as **Closed**. The closing time must be later than the opening time on the same day, so hours can't run past midnight.
4. Press **Save**. The whole week is saved as one set: if any day is wrong, nothing changes and the hours you had stay as they were. Fix the day that has a message and press **Save** again.

For one-off days off, such as a public holiday, add a closure instead: [Add a closure](add-a-closure.md).

## Common problems

- **"Enter a time, such as 10:00."** Use hours and minutes with a colon. This also shows when only one of **Opens** and **Closes** is filled in: fill in both, or leave both blank.
- **"The end must be after the start."** The closing time is the same as, or earlier than, the opening time. Hours past midnight aren't possible. The message shows on that day, and no day is saved until every day is right.
- **"These opening hours couldn’t be saved. Check each day’s times: a day closes after it opens."** The database refused the week. Check that each open day has both times and closes after it opens. Nothing was saved and your old hours stay.
- **"Only an owner or manager can change that."** Ask an owner or manager to set the hours.
- **"This location is no longer here. Reload the page."** The location was deleted meanwhile.
- **"Couldn't save. Please try again."** Reload the page and try again.
