# The Mat: Reporting Decisions Log

**Purpose:** owner and stakeholder answers that reporting must follow. Each entry says what was decided and what it means for the data.
**Started:** 2026-10-22 (first set of answers). Open items are in [§7](#7-open-follow-ups).

---

## 1. Teacher pay

| # | Decision (owner, 2026-10-22) |
|---|---|
| P1 | **Recurring weekly and monthly classes** are paid at a **variable rate of $1.13333 per minute**. |
| P2 | **Workshops** are paid **the higher of 70% of revenue or the variable rate**. |
| P3 | **Not everything named "Workshop" is paid as a workshop.** Example: *Monthly Workshop: Mantra and Chanting* is paid at the variable rate. |
| P4 | Rates live today in the **"YTD TYO Reports" financial workbook** (Google Sheets), the **teacher agreement**, and the **Sheets invoice template**. |

**What this means for the data:**
- **The pay rule must be set per class type, not inferred from its name.** We need a small table, `class_type_pay`, mapping each Acuity class type to `variable` or `workshop`, with effective dates.
- **The teacher isn't in the Acuity calendar** (one shared calendar, "Tejal Yoga Online", for about 99.7% of bookings). The name is usually in the class type ("… with Gauree"). Some types name several teachers, "TY Teachers" (rotating), or nobody. We need a `class_type_teacher` mapping with effective dates, plus per-session overrides for rotating classes.
- **Minutes per class** come from the Acuity class-type duration. Durations are consistent per type in 2020–2022 (25, 30, 45, 60, 75, 90, 120 minutes).
- **Pay is per class session, not per student.** Sessions are identified by Acuity's `classID`, which is stored in raw but not yet in the cleaned-up table.
- At $1.13333/min, a 30-minute class pays $34.00, 45 minutes $51.00, 60 minutes $68.00. That suggests the rate is **$68/hour** (see F1).

## 2. Membership revenue split

| Component | Amount / month | Included in |
|---|---|---|
| 1. On-Demand Library | $20 | all tiers |
| 2. Live reservations (monthly membership call + live classes) | $20 | all tiers |
| 3. Studio reinvestment | $20 | BFF and up |
| 4. Teacher support | $20 | BFF and up |
| 5. 1-hour deep-dive mentoring call (1/year) | $20 | Unlimited and up |
| 6. Mutual aid | $20 | Unlimited and up |
| 7. Additional Activist Sanctuary classes | $8 | Full and Premium Activist Sanctuary |
| 8. Additional Activist Sanctuary deep-dive mentoring calls | $20 | Premium Activist Sanctuary |

| Membership tier | Price | Components | Check |
|---|---|---|---|
| Scholarship | $40 | 1–2 | 2 × $20 ✓ |
| BFF | $80 | 1–4 | 4 × $20 ✓ |
| Unlimited | $120 | 1–6 | 6 × $20 ✓ |
| Full Activist Sanctuary | $128 | 1–7 | $120 + $8 ✓ |
| Premium Activist Sanctuary | $148 | 1–8 | $128 + $20 ✓ |

**What this means for the data:**
- Every membership charge is split into these components. That gives "membership revenue by purpose" (on-demand, live, reinvestment, teacher support, mentoring, mutual aid, Activist Sanctuary).
- **Only the live-reservation components (2 and 7) relate to classes.** How they're spread across classes is open (F4).
- Each membership product (Acuity product, Square invoice title) has to be mapped to a tier. The probe found names like "Monthly Unlimited Membership" and "Monthly Unlimited Scholarship Membership".
- **2020 charges don't match these prices** (e.g. a $9.00 membership charge in Jun 2020), so tiers need effective dates (F5).

## 3. Who counts as a member

| # | Decision |
|---|---|
| M1 | A **member** is anyone with an **active membership on that date**. |
| M2 | **Class-pack holders are not members.** They count with drop-ins as non-members. |

**What this means for the data:** we need membership periods (start and end per person) to answer "active on date X". v1 estimates them from recurring membership charges (Acuity subscription charges in Square, plus Square invoices).

## 4. Attendance

| # | Decision |
|---|---|
| A1 | **Nobody checks people in.** Live attendees aren't counted, and no-shows aren't counted. |

**What this means for the data:**
- Reports use **reservations** (booked and not canceled) and must label them that way, never as "attendance".
- The at-risk and engagement reports are based on reservations. On-demand library use isn't visible in Acuity or Square.
- 2020 bookings do carry an Acuity "Checked In" label. Per A1, reports ignore it (F7).

## 5. Access

| # | Decision |
|---|---|
| X1 | **Financial reports: the owner only.** The finance app stays local and single-user for now. |
| X2 | **Teachers need the attendee list for their own classes, including form answers** (emergency contact, injuries and conditions). |

**What this means for the data:**
- X2 is a **separate product** from the finance app. It needs per-teacher access, near-real-time data (lists change until class starts) and **health information**.
- The finance pipeline doesn't pull intake forms today, and the finance database shouldn't become a store of health information.
- Options are in F8.

## 6. Data findings that shaped these notes (from the Acuity exports, 2020–2022)
- 167 distinct class types; 10,453 of 10,590 bookings are on the "Tejal Yoga Online" calendar.
- Types include on-demand recordings ("Workshop On Demand…", "Weekend On-Demand…"), multi-session series ("Spring Awakening Series (7 Workshops)", 745 min), fundraisers, guest-teacher sessions ("GTW: …"), and class + on-demand add-on bundles.
- "Workshop" appears in 25 type names, including GTW, series and on-demand variants.

## 7. Open follow-ups
Numbered for replies. P = pay, M = membership, X = access.

| # | Question |
|---|---|
| F1 | Is the variable rate exactly **$68/hour** ($1.1333… per minute)? Round per class, to the cent? |
| F2 | **Workshop revenue** for the 70% test: ticket sales before or after discounts, refunds and Square fees? Do members attending a workshop add anything (e.g. part of their live-reservation component)? When a workshop has several teachers, how is the 70% split? |
| F3 | Which classes **aren't paid per minute**: on-demand recordings, fundraisers, the monthly membership call, classes Tejal teaches herself? Are teachers paid for a scheduled class with **zero reservations**? (Acuity's API only shows classes that have bookings.) |
| F4 | How should the **$20 live-reservations** component (plus $8 Activist Sanctuary) be spread across classes: divided across that member's live reservations that month, or reported as a pool beside member reservation counts? |
| F5 | When did the current membership prices start, and what were earlier tiers and prices (2020 shows a $9.00 charge)? What if a charge doesn't equal a tier price (discounts, proration, scholarships)? Split proportionally? |
| F6 | **Class packs** (not members): spread the pack price across the classes reserved with it (price ÷ credits), or count it on the day it's bought? |
| F7 | Confirm reports ignore the 2020 "Checked In" labels. |
| F8 | Teacher class lists: how do teachers get them today? Option A, **use Acuity's own staff access** (needs one Acuity calendar per teacher, so no health data is copied anywhere). Option B, **build a teacher roster page** (hosted, logins, per-teacher access rules, live data, audit trail). |
| F9 | Can we read the **"YTD TYO Reports"** workbook (Google Drive is connected) to load the teacher/class-type mapping and rates, and to **check our computed pay against what was actually paid**? |
| — | Still to come from the first list: churn definition (Q6), at-risk rule (Q7), meaning of "enrollments" (Q8). |
