# Employee login, line connection and Offices: plan

This plan was written on 28 Nov 2026. The source is the client's PDF, "Add a heading (4).pdf" (7 screens), plus the call with the user.

## 1. What the client wants, in one paragraph

Today an admin pins each rep to a line on the Intercoms tab. That breaks when reps move between offices, when a landline goes faulty and a rep calls from another number, or when someone swaps the wires behind the KoreCall box. A swapped wire means a rep's calls get filed under somebody else's line.

The new way works like this:

1. The rep logs in as an employee: Reg No, then password.
2. The rep picks an office and a calling number (that is, a line).
3. The rep proves the wiring with a test call: they dial a test number from their desk phone and hold it for at least 10 seconds.
   **Changed 28 Nov 2026 (client):** the number is not an office setting. Each test gets its own random 10-digit number (first digit 6–9), shown on the test page. It needn't exist: KoreCall records whatever is dialled. Because the number belongs to one test, a recording proves whose test it is. `line_sessions.test_number` (migration 035); `teams.test_number` is unused.
4. When that recording reaches the server on the line they picked, the line is locked to them for the day. Their working day starts, and they go to the Leads tab.

Lines, calling numbers and offices are set up by the client on a redesigned Intercoms tab. The Teams tab becomes Offices.

## 2. Facts from the live system that shape the design

| Fact (checked 28 Nov 2026) | What it means for the design |
|---|---|
| A recording reaches the server **8 s after hang-up (median) for Office 1, ~57 s for Office 2, sometimes 2–3 min**. | A 30-second wait can't work. The rep holds the call for 10 s or more, and the server then waits **up to 3 minutes**. A countdown is shown. |
| A recording's file name has the **line (01–08) and the dialled number**, but no office and no rep. | We know the call came in on line L, to number N. If L is the line the rep picked and N is the number shown for this test, then the wiring is right. |
| Line numbers come from the boxes: Office 1 = 01–04, Office 2 = 05–08. | Line numbers are **unique across all offices**. "Add connection" suggests the highest line + 1. |
| The PBX clock drifts (it resumes from its shutdown time every morning). | Match the test call on **when it arrived at the server**, never on the time the PBX gives it. |
| A rep is already stamped onto a recording **when it arrives**, from `lines.employee_id`. | Keep that. A connection simply sets `lines.employee_id`, so the receiver logic doesn't change. If a line changes hands mid-day, calls after the change go to the new rep. This already works. |
| Each call already stores its `calling_number` (migration 030). | If a line's number changes, old calls keep the old number. We can split a rep's calls by calling number. |
| There are 2 teams in prod. The 7 active people all have a Reg No (`employee_code`) and a phone. | Teams become Offices as they are. The Reg No is already there. |

## 3. Architecture

```
 Rep's browser                    API (Express)                         Database                     FTP receiver
 ─────────────                    ─────────────                         ────────                     ────────────
 /login → Employee
  Reg No → Get details ──────► POST /auth/employee/lookup ─────► employees (name, masked phone)
  Office + number ───────────► GET  /auth/employee/lines ───────► teams (offices), lines + holder
  Password → Login ──────────► POST /auth/employee/login ───────► sets cookie, creates
                                                                  line_sessions(status=testing)
 /connect (test page)
  "Dial 98xxxxxx, hold 10 s"
  polls every 3 s ───────────► GET  /connect/me ────────────────► looks in calls for:            KoreCall box
                                  (does the matching)              line = picked line,             uploads the
                                                                   number = this test's number,◄── test recording
                                                                   ≥ 10 s, arrived after start     (unchanged)
  ✓ connected → Start calling                                      → session connected,
                                                                     lines.employee_id = rep
  ✗ 3 min, no call → Retry / Try another number
  ⚠ line taken → "In use by Jaspreet Kaur (1004)"
 Leads tab ...
 Logout ─────────────────────► POST /connect/end ───────────────► session ended, line freed
                                 cron every 5 min ───────────────► ends connections idle > 47 min
```

### Data (migration 034, safe to re-run)

- **`teams`**: this becomes "Offices" in the UI. The table name stays the same, so reports, users and existing code keep working. New column: **`test_number`**, the number reps dial for the test.
- **`lines`**: this becomes a "connection". New columns: **`team_id`** (office) and **`calling_number`**. The line number stays unique.
- **`line_sessions`** (new): `line_id`, `line_number`, `calling_number`, `team_id`, `employee_id`, `status` (`testing` / `connected` / `ended` / `failed`), `started_at`, `connected_at`, `ended_at`, `end_reason`, `test_call_id`. The database enforces the rules itself, with partial unique indexes:
  - one connected rep per line;
  - one connected line per rep;
  - one test running per line.
- **The test call itself** is filed as a misc call with reason "Connection test". It belongs to the rep, so it shows on the Recordings tab, but it doesn't count as a lead call.

### Receiver change (one query)

The calling number stored on a call is read from `lines.calling_number` first, then from the old intercoms table as a fallback. Restart the receiver after office hours.

## 4. Rules (the client's, plus the edge cases we add)

| # | Situation | What happens |
|---|---|---|
| 1 | A rep picks a number that **someone is already connected on** | In the dropdown, the number is greyed out. It shows a blurred circle in the holder's colour with their initial. It can't be picked. |
| 2 | Two reps pick the **same free number** and both reach the test page | The first rep to start the test holds that line’s test for 3 min. The second sees: "Jaspreet Kaur (1004) is testing this line right now". When the first rep connects, the second sees: "This line is in use by Jaspreet Kaur (1004)". Only one test runs per line because a recording on line 05 can't tell us *which* person dialled. With two tests at once we couldn't know whose call it was. |
| 3 | No matching recording within **3 min** | A red ✗ shows "Connection not established", with **Retry** and **Try another number**. |
| 4 | The test call arrives on **another line** (wires swapped) | The rep is told: "Your test call came in on line 06 (number …), not line 05. Ask for the wire to be fixed, or pick that number." This is the client's actual problem, so the test points straight at it. |
| 5 | A line changes hands mid-day | Calls after the change go to the new rep (they're stamped on arrival). |
| 6 | A line's calling number changes mid-day | The rep stays. Each call keeps the number it was made on. The recording details show it, and the rep's dashboard can split calls by number. |
| 7 | The rep logs out | The session ends and the line is freed. Calls on that line after this have no rep (gap calls, which an admin can give to someone, as now). |
| 8 | **No activity for 45 min** (no click, key, mouse or touch on CallFlow, **and** no call recorded on their line) | An **"Are you there?"** popup appears with a 1-minute countdown. **Cancel** keeps them logged in. **OK**, or the countdown running out, logs them out and frees the line. If the browser was closed, the server frees the line after 47 min. Changed from "midnight" by the user on 28 Nov. |
| 9 | The rep logs in again the same day while still connected | They skip the test and go straight to Leads. |
| 10 | The rep tries a second line while connected to one | Refused: "You're connected on line 05. Log out first." |
| 11 | A rep is switched off | Their session ends and the line is freed (the same as today's rule). |
| 12 | An admin presses **Free line** | The session ends with the reason "freed by admin". |
| 13 | An admin edits a line's **number** or deletes it while a rep is connected | Refused. Free the line first. The line number must match the KoreCall box's setting. |
| 14 | The office box is offline, so no recording can arrive | The test fails with a hint: "No recording has reached the server from this office in the last N min — the box may be offline". As a fallback, an admin can connect a rep by hand on the Intercoms tab. |
| 15 | The box uploads hours of old calls after an outage | They go to whoever holds the line when they arrive. This is today's behaviour. It could be improved later by matching on session times. |
| 16 | Someone types random Reg Nos | The lookup is rate-limited (150 per 15 min per address, because all reps of an office share one address; failed logins: 20 per 15 min). It shows only the name and a masked phone (98\*\*\*\*\*\*66). Unknown or switched-off numbers get one generic message. |
| 16a | Contact number | This is the rep's **personal** phone (Users tab), shown masked. It is **unique**: two people can't share a number (409 on the Users form). The calling number is the office line's number, which is a different thing. |
| 16b | A rep's own line | It stays pickable for them, whether they're connected on it or testing it. Others see it greyed out with the holder's initial. |
| 17 | Who must connect | **Users** (reps) must connect before they can use the dashboard. **Admins and the Super Admin** log in with email as now and don't need a line. |

## 5. Screens (glass style, in the site's colours)

1. **Login**: two choices, "Staff login" (the email form as now) and **"Employee login"**.
2. **Employee login**: one frosted-glass card that grows step by step.
   - Reg No, then **Get details**.
   - Name and masked contact appear (read-only), then **Next**.
   - Office dropdown and Calling number dropdown. The numbers shown belong to the picked office, and taken numbers show the holder's initial.
   - Password, then **Login**.
3. **Test connection**:
   - The number to dial, large.
   - "Hold for at least 10 seconds".
   - A countdown ring for the 3 minutes.
   - The outcome:
     - success: a green ✓, "You are connected", then **Start calling** (to Leads);
     - failure: a red ✗, then **Retry** or **Try another number**;
     - line taken: a popup naming who holds the line.
4. **Intercoms (redesigned)**:
   - An **Office** filter.
   - A table of connections: Line, Calling number, Office, Connected rep (with "since 9:42"), Calls today, Save.
   - **Add connection**, which suggests the next line number.
   - **Free line** on connected rows.
   - "Connect someone by hand", the admin fallback.
5. **Offices** (was Teams): renamed throughout ("Create office"), plus a **Test number** per office.
6. A **Logout** that also ends the connection, plus a small "Connected: line 05 · 1755001112" chip in the top bar for reps.

## 6. Tasks, in order

| Phase | Work | Ships on its own? |
|---|---|---|
| **1** | Migration 034. Rename Teams to Offices (sidebar, page, "Create office", Users form label, Reports). Add the test number per office. | Yes |
| **2** | Intercoms redesign. API to add, edit and delete connections. Office filter. Next-line suggestion. Free line. The old intercom/swap UI goes. | Yes (with the cutover, see 7) |
| **3** | Session engine: `line_sessions`, the test-call matcher (unit-tested), the wrong-line hint, idle auto-end (45 min, with the popup), ending on logout, switch-off and Free line. | Yes |
| **4** | Employee login API: lookup, the lines list, login. Rate limits. | With 5 |
| **5** | Employee login screens and Test connection screen (glass). | With 4 |
| **6** | Gating: reps without a connection are sent to the test page. Logout ends the connection. Top-bar chip. The receiver reads the calling number from the line. | With 4–5 |
| **7** | Calling number on the recording details. A rep's calls split by calling number on their dashboard and the eye view. | Yes |
| **8** | e2e checks, a browser check at 1280 and 1440, and the cutover script. | n/a |

## 7. Cutover (one evening, with the client)

**Order matters:** migration 034 must run **before** the new FTP receiver starts. The receiver reads `lines.calling_number`, and without that column every recording insert would fail.


1. Take a backup, then deploy everything.
2. Run the script that **removes the old lines and intercoms**, as the client asked. Old calls keep their line and number, because those are stored on each call.
3. The client sets up offices, then adds the connections (line plus calling number) on the new Intercoms tab.
4. Restart the receiver after hours.
5. The next morning, each rep logs in with Reg No and password, tests, and connects. Calls made before a rep connects have no rep, and an admin can give them out as now.

## 8. Decisions taken by default (the client can change them)

- Test wait: **3 min** (Office 1 uploads sometimes take ~3 min). 30 s is too short for the boxes' upload delay.
- Office dropdown lists **every office**, starting on the rep's own (reps shift between offices).
- Connections end after **45 min idle**, with an "Are you there?" popup and a 1-min countdown. Calls on the rep's line count as activity.
- The test call **doesn't count** towards calling time or leads.
- **Pay is unchanged.** The connection time is recorded per day and shown, but whether "no connection = no pay that day" is the client's call. Ask before adding it.
