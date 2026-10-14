# Plant Store Developer Task: Complete Project Documentation

This document explains the whole project from start to finish: what the task asked for, what was built, which tools were used, how every part works, all links and logins, how to run and test everything, how it is deployed, and how to submit it.

Short answers to the task's own questions are in [ANSWERS.md](ANSWERS.md). This file is the long, step-by-step version.

---

## Contents

1. [Links and logins](#1-links-and-logins)
2. [What the task asked for](#2-what-the-task-asked-for)
3. [Tools and technologies used](#3-tools-and-technologies-used)
4. [Project structure](#4-project-structure)
5. [Install everything on a new computer](#5-install-everything-on-a-new-computer)
6. [Part 1: Order help desk](#6-part-1-order-help-desk)
7. [Part 2: Failed deliveries](#7-part-2-failed-deliveries)
8. [Part 3: Returns service](#8-part-3-returns-service)
9. [Running every test](#9-running-every-test)
10. [Deployment on Render, step by step](#10-deployment-on-render-step-by-step)
11. [Releasing a new version and going back](#11-releasing-a-new-version-and-going-back)
12. [Recording the demo video](#12-recording-the-demo-video)
13. [Troubleshooting](#13-troubleshooting)
14. [Submission checklist](#14-submission-checklist)
15. [Glossary for beginners](#15-glossary-for-beginners)

---

## 1. Links and logins

### Live (Render)

| What | Link |
| --- | --- |
| Customer page | https://plant-help-desk-yyhh.onrender.com |
| Team page | https://plant-help-desk-yyhh.onrender.com/team |
| Health check | https://plant-help-desk-yyhh.onrender.com/health (shows `{"ok":true}`) |
| Store API | https://plant-store-api-yyhh.onrender.com (needs the `x-api-key` header, see below) |
| Store API emails list | `curl.exe -H "x-api-key: test-key" https://plant-store-api-yyhh.onrender.com/emails` |
| GitHub repository | https://github.com/Vuday3336/Plant-Store |
| Render dashboard | https://dashboard.render.com (blueprint `plant-store`, services `plant-store-api` and `plant-help-desk`) |

### Logins and keys

| What | Value | Where it is set |
| --- | --- | --- |
| Team page user | `team` | `TEAM_USER` |
| Team page password (live site) | the value you typed for `TEAM_PASSWORD` when deploying the Render blueprint. Write it here only in your private copy; do not commit a real password to a public repository. | Render → plant-help-desk → Environment |
| Team page password (your own computer) | `plants-2026` | default in `help-desk/src/config.js` |
| Store API key | `test-key`, sent as the header `x-api-key: test-key` | fixed inside `store-api.js` (given with the task, not changed) |
| Returns service (part 3), manager | `priya` / `garden123` | given in `returns-service/README.md` |
| Returns service (part 3), viewer | `sam` / `sam2026` | given in `returns-service/README.md` |

### Test data that always works

The store API makes the same 60 orders every time it starts: `ORD-1001` to `ORD-1060`.

| Order | Phone | Email |
| --- | --- | --- |
| ORD-1001 | 9000010137 | vikram.nair1@example.com |
| ORD-1002 | 9000010274 | meera.shah2@example.com |
| ORD-1003 | 9000010411 | rohan.das3@example.com |

To see all of them: `curl.exe -H "x-api-key: test-key" https://plant-store-api-yyhh.onrender.com/orders`

---

## 2. What the task asked for

A shop that sells plants online gave three jobs:

| Part | Business problem | What had to be delivered |
| --- | --- | --- |
| 1. Order help desk | Customers keep asking "where is my order?" and the team answers by hand. | A customer page to check an order and report a problem, a team page behind a login to resolve tickets, one email per event, robust against a slow, failing, rate-limited store API, and safe with two copies running. Tests, deployment, a video. |
| 2. Failed deliveries | Returned parcels cost shipping twice and the plants die. | The three changes that save the most money (with numbers and working), and a script that writes `actions.csv` with the team's daily actions. |
| 3. Returns service | An existing service "written in a hurry". | A security review (all problems, worst first) with the three worst fixed and tested, a clean-up of the `decide` function without changing its decisions, and a new "exchange" option. |

The fixed rules for part 1 (used by the company's automated checks):

| Item | Rule |
| --- | --- |
| Settings | `PORT` and `STORE_API_URL` come from the environment; one command starts the app |
| `GET /health` | 200 when running |
| `POST /api/lookup` | body `{"order_number","contact"}` → 200 `{"status","expected_delivery"}` or 403 |
| `POST /api/tickets` | body `{"order_number","contact","message"}` → 201 `{"ticket_id"}` or 403 |
| Customer page | at `/`, with ids `order-number`, `contact`, `lookup`, `result`, `message`, `send` |
| Team page | at `/team`, one fixed team user |

---

## 3. Tools and technologies used

| Tool | Version | Used for | Why |
| --- | --- | --- | --- |
| Node.js | 22.13+ (24 on Render) | Parts 1 and 3 | The given `store-api.js` and returns service are Node, so one runtime for both |
| Express | 4.x | Part 1 web server | Small, well known, easy routing and JSON parsing |
| SQLite via `node:sqlite` | built into Node | Part 1 database | Nothing to install; one file; two copies of the app can share it safely using WAL mode and `BEGIN IMMEDIATE` transactions |
| Plain HTML, CSS, JavaScript | none | Part 1 pages | No build step, loads fast on phones, easy to review |
| `node:test` | built into Node | Tests for parts 1 and 3 | No test library to install |
| Python | 3.8+ (standard library only) | Part 2 | Good for reading a CSV and doing sums; no packages needed |
| Git and GitHub | | Version history and hosting the code | Required by the task |
| Render | free plan | Hosting part 1 live | Deploys straight from GitHub using `render.yaml` |
| Docker and Docker Compose | optional | A second way to deploy part 1 on any server | Files included (`help-desk/Dockerfile`, `help-desk/docker-compose.yml`) |

Only one package is installed from npm: `express`. Everything else comes with Node or Python.

---

## 4. Project structure

```
Developer task/
├── README.md                  short overview and quick start
├── DOCUMENTATION.md           this file
├── ANSWERS.md                 answers to the task's questions (keep headings)
├── render.yaml                Render blueprint: deploys part 1 (two services)
├── ai/                        AI chat record, as the task asks
│
├── help-desk/                 PART 1
│   ├── store-api.js           the company's fake store API (unchanged)
│   ├── package.json           npm scripts: start, dev, test
│   ├── src/
│   │   ├── server.js          starts everything, clean shutdown
│   │   ├── config.js          reads all settings from environment variables
│   │   ├── app.js             web routes (/health, /api/lookup, /api/tickets, team API, pages)
│   │   ├── db.js              SQLite: opening, tables, transactions
│   │   ├── orders.js          cleaning order numbers/phones/emails, matching, order cache
│   │   ├── tickets.js         creating tickets, dedupe, resolving, queueing emails
│   │   ├── outbox.js          background worker that sends queued emails
│   │   ├── storeApi.js        calls to the store API with timeouts and retries
│   │   ├── rateLimit.js       shared 60-a-minute limiter kept in the database
│   │   └── auth.js            team login with a signed cookie
│   ├── public/
│   │   ├── index.html         customer page
│   │   ├── customer.js        customer page behaviour
│   │   ├── team.html          team page
│   │   ├── team.js            team page behaviour
│   │   └── style.css          shared styles, phone-friendly, dark mode
│   ├── test/                  16 automated tests + helpers
│   ├── scripts/dev.js         starts store API and app together
│   ├── Dockerfile, docker-compose.yml, .dockerignore
│   └── README.md
│
├── failed-deliveries/         PART 2
│   ├── shipments.csv          given data (3,267 parcels, 60 days)
│   ├── README.md              given rules
│   ├── analysis.py            works out where the money goes
│   ├── analysis_output.txt    saved output of analysis.py
│   ├── make_actions.py        writes actions.csv
│   ├── actions.csv            the output (57 rows)
│   └── test_make_actions.py   12 checks
│
└── returns-service/           PART 3
    ├── server.js, auth.js, db.js, returns.js   the service (fixed and cleaned up)
    ├── products.js            product list (moved out of db.js for exchanges)
    ├── legacy/decide-before-cleanup.js         original decide, kept for comparison
    ├── test.js                original 8 tests
    ├── security.test.js       3 tests, one per security fix
    ├── decide-same.test.js    30,000-case comparison old vs new decide
    ├── exchange.test.js       10 tests for exchanges
    └── README.md
```

---

## 5. Install everything on a new computer

1. **Install Node.js 22.13 or newer** from https://nodejs.org (choose "LTS"). Check: `node --version`
2. **Install Python 3** from https://python.org (on Windows tick "Add python to PATH"). Check: `python --version`
3. **Install Git** from https://git-scm.com. Check: `git --version`
4. **Get the code:**
   ```bash
   git clone https://github.com/Vuday3336/Plant-Store.git
   cd Plant
   ```
   Or unzip the project zip and open a terminal in the folder.
5. **Install part 1's package:**
   ```bash
   cd help-desk
   npm install
   ```

Parts 2 and 3 need nothing installed.

---

## 6. Part 1: Order help desk

### 6.1 Run it on your computer

**Easiest (one terminal):**
```bash
cd help-desk
npm run dev
```
This starts the store API on port 4000 and the help desk on port 3000. Stop with Ctrl+C.

**Two terminals (useful when you want to stop only the store API):**

Terminal 1:
```bash
cd help-desk
node store-api.js
```
Terminal 2 (Windows PowerShell):
```powershell
cd help-desk
$env:PORT=3000; $env:STORE_API_URL="http://localhost:4000"; npm start
```
Terminal 2 (Mac / Linux / Git Bash):
```bash
cd help-desk
PORT=3000 STORE_API_URL=http://localhost:4000 npm start
```

Open:
- Customer page: http://localhost:3000
- Team page: http://localhost:3000/team (user `team`, password `plants-2026`)

**Second copy on the same database (requirement 7):** start another terminal with `PORT=3001` and the same command. Both use `help-desk/data/helpdesk.db`.

### 6.2 All settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | Port the help desk listens on |
| `STORE_API_URL` | http://localhost:4000 | Where the store API is |
| `STORE_API_KEY` | test-key | Header value sent to the store API |
| `DB_FILE` | `help-desk/data/helpdesk.db` | The SQLite file, shared by all copies |
| `TEAM_USER` / `TEAM_PASSWORD` | team / plants-2026 | Team login |
| `SESSION_SECRET` | made automatically and stored in the database | Signs the team login cookie |
| `STORE_API_LIMIT` | 60 | The store API's limit per minute; we use 85% of it |
| `TRUST_PROXY` | off | Set to 1 behind Render/HTTPS so the visitor IP is read correctly |
| `COOKIE_SECURE` | off | Set to 1 on HTTPS so the login cookie is only sent over HTTPS |
| `LOOKUP_DEADLINE_MS` | 9000 | Give up on the store API after this long and answer 503 |
| `TICKET_DEDUPE_MS` | 60000 | Same order + same message within this time is one ticket |
| `LOOKUP_LIMIT_PER_MIN` | 20 | Lookups per minute per visitor IP (per copy) |
| `EMAIL_TIMEOUT_MS` | 10000 | Stop waiting for one email request after this long |

### 6.3 How a request flows

```
Customer browser ──> help desk (Express) ──> SQLite file
                         │                     (tickets, emails outbox,
                         │                      rate-limit window, order cache, settings)
                         ▼
                    store API  <── outbox worker (runs inside every copy)
```

**Order lookup (`POST /api/lookup`)**
1. Clean the input: order number to upper case (`ord-1001` → `ORD-1001`); contact is either an email (lower case) or the last 10 digits of a phone (`+91 90000 10137` → `9000010137`).
2. Use the cached order if it is less than 30 seconds old; otherwise ask the store API.
3. Asking the store API: take a rate-limit slot, try up to 3 times, each try at most 4 seconds, all inside 9 seconds.
4. If the contact matches: answer 200 with only `status` and `expected_delivery`.
5. If not, or the order does not exist: answer 403 with the same "not found" text either way.
6. If the store API could not answer in time: 503.

**Reporting a problem (`POST /api/tickets`)**
1. Message must not be empty and at most 2000 characters (else 400).
2. Check the order and contact the same way (a cached copy up to 24 hours old is enough, so this still works when the store API is down if the customer just looked the order up).
3. In one database transaction: look for a ticket with the same order and the same message (ignoring case and spaces) from the last minute, or with the same `request_id` from the page. If found, return its id. If not, create the ticket **and** its confirmation email row.
4. Answer 201 `{"ticket_id": N}`.

**Sending emails (the outbox, `src/outbox.js`)**
1. Every second each copy looks for an email row that is pending, due, and not claimed.
2. It claims it with a conditional update; only one copy can win.
3. It sends `POST /emails` to the store API with the header `Idempotency-Key: helpdesk-<db id>-ticket-<id>-<kind>`. The store API never sends the same key twice.
4. Success: marked sent. Failure: tried again later (2 s, 4 s, 8 s ... up to 60 s), forever. A crash: the claim runs out after 30 s and the email is sent again with the same key, so still one email.

**Resolving (`POST /api/team/tickets/:id/resolve`)**
`UPDATE ... SET status='resolved' WHERE id=? AND status='open'` changes the row only once; only that one call queues the "resolved" email. Clicking twice, or from two copies, gives one email.

**Rate limit (`src/rateLimit.js`)**
Every store API call first inserts a row into the `store_calls` table, inside a locked transaction, only if fewer than 51 calls were made in the last 60 seconds (emails may use at most 36 of them). All copies share the table, so together they stay under 60. If the store API ever answers 429, everyone waits for its `Retry-After`.

### 6.4 How each requirement is met

| # | Requirement | How | Proved by |
| --- | --- | --- | --- |
| 1 | No order details without the right phone or email | Only status and date are returned; same 403 for wrong contact and unknown order; emails go to the address on the order | `test/privacy.test.js` |
| 2 | Every ticket gets its email even if the store API was failing | Email saved with the ticket, retried until it goes out | `test/emails.test.js` |
| 3 | Never the same email twice (double click, slow API, restart) | Dedupe in one transaction + fixed idempotency key + claims | `test/emails.test.js`, `test/two-copies.test.js` |
| 4 | No ticket lost | Saved to disk (`synchronous=FULL`) before answering 201 | `test/emails.test.js` (app killed and restarted) |
| 5 | 503 within 10 s, page never hangs, typing kept | 9-second deadline; page shows progress and keeps text (also in sessionStorage) | `test/unavailable.test.js` + manual check |
| 6 | Stay inside the rate limit | Shared sliding window in the database | `test/two-copies.test.js` (90-request burst) |
| 7 | Two copies on one database | All shared state is in SQLite with locks | `test/two-copies.test.js` |
| 8 | Phone screen and keyboard only | One column on small screens, 44px buttons, labels, focus outlines, Enter submits, Escape closes the dialog | Checked by hand |
| 9 | Tests | 16 tests | `npm test` |

### 6.5 The pages

**Customer page (`/`)**
- Order number and phone/email fields, "Check my order" button.
- Result box: status in words, a progress tracker (placed → packed → shipped → out for delivery → delivered) and the delivery date.
- While waiting: "Checking your order…", after 3 seconds "Still checking… this can take up to 10 seconds".
- On 503: "We cannot reach our order system right now. What you typed is still here."
- "Something wrong with your order?" box: message field with a character counter and "Send to our team". Shows the ticket number on success.

**Team page (`/team`)**
- Login form (user `team`).
- Ticket list, newest first, with filters Open / Resolved / All.
- Each ticket shows its number, order, customer, time and an "Email waiting" badge if an email has not gone out yet.
- Clicking a ticket opens a dialog: order, customer, what they typed, the message, and the state of each email; "Mark resolved" button.
- A yellow banner appears when the store API is not answering, saying how many emails are waiting.

### 6.6 API reference

| Method and path | Body | Answers |
| --- | --- | --- |
| `GET /health` | | 200 `{"ok":true}` |
| `POST /api/lookup` | `{"order_number":"ORD-1001","contact":"9000010137"}` | 200 `{"status","expected_delivery"}`, 403, 429, 503 |
| `POST /api/tickets` | `{"order_number","contact","message","request_id"?}` | 201 `{"ticket_id","duplicate"}`, 400, 403, 429, 503 |
| `POST /api/team/login` | `{"username","password"}` | 200 and a cookie, 401, 429 |
| `POST /api/team/logout` | | 200 |
| `GET /api/team/tickets` | (cookie) | 200 `{"tickets":[...],"store_api":{...}}`, 401 |
| `GET /api/team/tickets/:id` | (cookie) | 200 ticket with emails, 404 |
| `POST /api/team/tickets/:id/resolve` | (cookie) | 200 ticket (`already_resolved` true on a repeat), 404 |

Try it from PowerShell:
```powershell
curl.exe -H "content-type: application/json" -d '{\"order_number\":\"ORD-1001\",\"contact\":\"9000010137\"}' https://plant-help-desk-yyhh.onrender.com/api/lookup
```

### 6.7 Manual test checklist (local or live)

1. Lookup `ORD-1001` + `9000010137` → status and date appear.
2. Same order + `9999999999` → "could not find an order", nothing about the order.
3. Phone written as `+91 90000 10137` → still works. Email in capitals → still works.
4. Report a problem → ticket number appears.
5. Click Send twice quickly → only one ticket on the team page.
6. Team page → log in → open ticket → Mark resolved → "Resolved. The customer will get one email".
7. Emails list shows exactly one confirmation and one resolved email for that ticket.
8. Stop the store API → lookup a different order → "cannot reach our order system" within 10 seconds, text still in the fields.
9. Narrow the browser to phone width (F12 → device toolbar) → everything fits in one column.
10. Use only Tab, Shift+Tab, Enter and Escape → every action is possible.

---

## 7. Part 2: Failed deliveries

### 7.1 Run it

```bash
cd failed-deliveries
python analysis.py            # prints the breakdowns and the three savings
python make_actions.py        # writes actions.csv
python -m unittest test_make_actions.py
```

### 7.2 How the cost was worked out

The README says a returned parcel costs **2 × shipping_cost + 40% of order_value**. Applied to every parcel with status `returned`: **191 parcels, Rs 75,910 in 60 days**, about Rs 397 each.

Then the returns were grouped many ways (reason, payment type, courier, city, contacted or not, number of attempts, week) to see where they cluster.

### 7.3 The three changes

| # | Change | Numbers from the file | Saves (60 days) |
| --- | --- | --- | --- |
| 1 | Call the customer after the first failed attempt (not home, wrong address, phone off) | Contacted: 74 parcels, 17 returned (23%). Not contacted: 122 parcels, 83 returned (68%). | Rs 20,600 (Rs 10,300 if only half as effective) |
| 2 | Confirm cash-on-delivery orders before shipping | COD refused 70 of 984 (7.1%), cost Rs 24,343; prepaid refused 7 of 2,283 (0.3%) | Rs 12,200 planning figure, up to Rs 23,200 |
| 3 | Stop using QuickDrop for Guwahati, Agartala, Imphal | QuickDrop there: 89 parcels, 22 returned (24.7%); other couriers there: 7.5% | Rs 7,200 |

How each saving was calculated:
- **Change 1:** if the 122 non-contacted parcels came back at the contacted rate, that is 28 returns instead of 83. 55 fewer × Rs 374 average = Rs 20,559.
- **Change 2:** the upper bound is COD refusing as rarely as prepaid. The planning figure is half of the refusal cost.
- **Change 3:** the same 89 parcels at 7.5% would be 6.6 returns instead of 22. 15.4 × Rs 469 = Rs 7,209.

Change 3's parcels are left out of change 1, so nothing is counted twice. The full output is in `analysis_output.txt`. What looked like a problem but isn't: ANSWERS.md section 13.

### 7.4 The action list rules

For each parcel, the first rule that fits wins:

| Status | Condition | Action |
| --- | --- | --- |
| failed_open | fail_reason is refused | RETURN |
| failed_open | 3 or more attempts | RETURN |
| failed_open | fail_reason is wrong_address | ASK_ADDRESS |
| failed_open | customer not contacted | CONTACT |
| failed_open | anything else | RETRY |
| returned, not closed | order already sent again (another parcel has `reship_of` = this one) | nothing |
| returned, not closed | prepaid | ASK_CHOICE |
| returned, not closed | cash on delivery | CLOSE |
| anything else | | nothing |

Result: 57 rows: RETURN 12, ASK_ADDRESS 4, CONTACT 8, RETRY 7, ASK_CHOICE 15, CLOSE 11.

Check: 31 stuck parcels + (48 open returns − 22 already re-sent) = 57.

---

## 8. Part 3: Returns service

### 8.1 Run it

```bash
cd returns-service
node --test            # 23 tests
node server.js         # runs on http://localhost:4300
```
The data file `data.json` is created on first start; delete it to start fresh.

### 8.2 Security review

Sixteen problems were found and ranked worst first (full table: ANSWERS.md section 16). The three worst were fixed:

| # | Problem | Who could do it | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | The `status` filter on `GET /admin/returns` was turned into code with `new Function`, so the address bar could run code on the server | Anyone with a token, and with problem 2 that is anyone | Plain comparison `r.status == q.status` | `security.test.js`: an injection returns nothing and the server keeps running |
| 2 | The admin token was just `base64("username:role")`, so anyone could make a manager token | Anyone | Random 32-byte tokens stored on the server, expire after 8 hours | Home-made token gets 401; a real login works |
| 3 | The photo upload used the customer's file name, so `../` wrote files anywhere (even over `server.js`) | Anyone, no login | The server makes the file name; only image extensions are allowed; the path must stay in `uploads/` | `../x.js` is refused; `../../x.png` is saved inside `uploads/` |

Each test fails on the original code and passes on the fixed code.

### 8.3 Clean-up of `decide`

- The long `if / else` chain per item kind became a table, `ITEM_RULES`: allowed reasons, last day of the window, whether damaged needs a photo, and the bulk limit.
- Reason keywords are in `REASONS`. The money rules (5% credit bonus, Rs 2000 review, when shipping is refunded) are in `MONEY`.
- The loop became small named functions: `checkItem`, `orderLine`, `alreadyReturned`, `valueAfterCoupon`, `wholeOrder`, `reasonType`.
- **Proof it decides the same:** the original was kept in `legacy/decide-before-cleanup.js`. `decide-same.test.js` feeds 30,000 generated requests to both and requires identical answers. It was also checked that the test catches small deliberate changes.
- Odd behaviour was **kept on purpose** and listed in ANSWERS.md section 19. For example: tools close a day earlier than pots, and buying 1 item then returning 2 copies of it in one request is allowed.

### 8.4 Exchange

Send `want: "exchange"` and `exchange_for: "<sku>"`:

```json
{ "order_number": "ORD-2002", "items": [{ "sku": "pruning-shears", "qty": 1 }],
  "reason": "not needed", "want": "exchange", "exchange_for": "watering-can" }
```

- The same rules decide whether the items can come back.
- The value coming back is its price less its share of any coupon. There is no 5% bonus and no shipping refund.
- The new items cost the price of `exchange_for` × the same quantity.
- The answer has `method: "exchange"`, `refund_amount: 0`, and either `pay_amount` (the customer pays more) or `credit_amount` (the customer gets credit). It also includes `exchange_for`, `exchange_qty` and `returned_value`.
- Over Rs 2000 coming back means a person reviews it.

---

## 9. Running every test

| Part | Command (run inside the folder) | Expected |
| --- | --- | --- |
| 1 | `cd help-desk` then `npm test` | `pass 16, fail 0` (about 45 seconds) |
| 2 | `cd failed-deliveries` then `python -m unittest test_make_actions.py` | `Ran 12 tests ... OK` |
| 3 | `cd returns-service` then `node --test` | `pass 23, fail 0` |

How part 1's tests work: they start the real `store-api.js` with its random slowness switched off, put a small proxy in front of it, and start real copies of the app. The proxy can make the store API fail, hang, answer slowly, or take an email and never answer, exactly when a test needs it.

---

## 10. Deployment on Render, step by step

This is how the live site was set up.

1. **Push the code to GitHub** (repository `Vuday3336/PlantStore`, branch `main`).
2. **Open the blueprint link** while logged in to Render: https://render.com/deploy?repo=https://github.com/Vuday3336/Plant-Store
3. **Fill in the form:**
   - Blueprint Name: `plant-store`
   - Branch: `main`
   - Blueprint Path: leave empty (uses `render.yaml`)
   - `STORE_API_URL`: `https://plant-store-api-yyhh.onrender.com`
   - `TEAM_PASSWORD`: a password of your choice (this is the live team password)
4. **Click "Deploy Blueprint".** Render reads `render.yaml` and creates two free web services:
   - `plant-store-api`: runs `node store-api.js`
   - `plant-help-desk`: runs `node src/server.js`, health check `/health`
5. **Wait until both show "Deployed" / "Live"** (a few minutes).
6. **Check:** https://plant-help-desk-yyhh.onrender.com/health shows `{"ok":true}`.
7. **If the store API got a different address** (e.g. `plant-store-api-xxxx.onrender.com`), open `plant-help-desk` → Environment → set `STORE_API_URL` to it → Save.

**Free plan limits:**
- A service sleeps after 15 minutes without visits. The first visit afterwards takes up to about a minute.
- Free services have no disk, so the help desk's database starts empty after every deploy or restart, and the store API's email list also resets.
- For real use: a paid instance with a disk, or the Docker setup below.

**Alternative: any Linux server with Docker**
```bash
git clone https://github.com/Vuday3336/Plant-Store.git
cd Plant/help-desk
docker compose up -d --build
```
The help desk runs on port 3000 and the store API on port 4000, and the database is kept on a Docker volume. To start a second copy: `docker compose --profile two-copies up -d` (port 3001).

---

## 11. Releasing a new version and going back

**On Render**
- **Release:** change the code, run the tests, then `git commit` and `git push`. Render builds the new version automatically, waits until `/health` answers, and only then switches traffic to it. A broken build never goes live.
- **Go back:** open Render → the service → Events / Deploys → **Rollback** on the last good deploy. Or `git revert <bad commit>` and push.

**With Docker on a server**
1. `git checkout v1.3.0` (tag each release).
2. Back up the database:
   ```bash
   docker compose exec helpdesk node -e "new (require('node:sqlite').DatabaseSync)('/data/helpdesk.db').exec(\"VACUUM INTO '/data/before-v1.3.0.db'\")"
   ```
3. `TAG=v1.3.0 docker compose up -d --build helpdesk`. The old copy finishes its current email, then stops.
4. Go back: `TAG=v1.2.0 docker compose up -d helpdesk`. The old image is still there, so this takes seconds.

---

## 12. Recording the demo video

**Before recording:** open the customer page and run the emails command once, so both services are awake.

Record these steps in order (Windows: **Win + Alt + R** starts and stops recording):

1. **Lookup that works:** `ORD-1001` + `9000010137` → status and progress bar.
2. **Wrong phone:** `ORD-1001` + `9999999999` → "could not find an order".
3. **Report a problem:** correct phone, message "The clay pot arrived cracked" → Send → ticket number.
4. **Team page:** log in, open the ticket, click Mark resolved.
5. **Emails list:** `curl.exe -H "x-api-key: test-key" https://plant-store-api-yyhh.onrender.com/emails` → exactly two emails, one confirmation and one resolved.
6. **Store API stopped:**
   - Render → plant-store-api → Settings → **Suspend Web Service**.
   - On the customer page, look up `ORD-1002` + `9000010274` → "We cannot reach our order system right now… What you typed is still here".
   - Afterwards click **Resume Web Service**.

Upload the video (YouTube unlisted, Google Drive or Loom) and put the link in ANSWERS.md.

---

## 13. Troubleshooting

| Problem | Why | Fix |
| --- | --- | --- |
| Opening the store API in a browser shows `{"error":"missing or wrong x-api-key"}` | The store API needs the header `x-api-key: test-key`, which a browser cannot add from the address bar. This is expected. | Use `curl.exe -H "x-api-key: test-key" <url>` |
| The live site takes almost a minute to open | Free Render services sleep after 15 minutes idle | Open it once before demoing |
| Tickets disappeared on the live site | Free plan has no disk; a deploy or restart empties the database | Expected on the free plan; use a paid disk or Docker for real use |
| `npm start` says `Cannot find module 'express'` | Packages not installed | Run `npm install` in `help-desk` |
| `node:sqlite` error / `No such built-in module` | Node is older than 22.13 | Install Node 22 LTS or newer |
| "Port 3000 is already in use" | Another program uses the port | Use another port: `PORT=3005 npm start`, or stop the other program |
| Lookup always says "cannot reach our order system" | The store API is not running or `STORE_API_URL` is wrong | Start `node store-api.js`, check the URL |
| Lookup says "Too many tries from your connection" | More than 20 lookups a minute from one IP | Wait a minute |
| Team page keeps asking to log in | Wrong password, or `COOKIE_SECURE=1` while using plain http | Check the password; only set `COOKIE_SECURE` on https |
| On PowerShell `PORT=3000 npm start` does not work | That is bash syntax | Use `$env:PORT=3000; npm start` |
| Old page design still showing after a change | Browser cache | Hard refresh with Ctrl+F5 |

---

## 14. Submission checklist

- [ ] ANSWERS.md top filled: Name, Live link (done), Video link
- [ ] Video recorded with the six steps in section 12, uploaded, and the link added
- [ ] All tests pass (section 9)
- [ ] Changes committed and pushed: `git commit -am "..."` then `git push`
- [ ] GitHub repository set to **Private** (Settings → Change visibility) and the reviewer added as a collaborator
- [ ] Render services left running until the review is finished
- [ ] Send: the repository link (or the zip including the hidden `.git` folder), the live link and the video link

---

## 15. Glossary for beginners

| Word | Meaning |
| --- | --- |
| API | A way for programs to talk to each other over the web, using addresses like `/api/lookup` |
| Endpoint | One address of an API, e.g. `POST /api/tickets` |
| Status code | The number a server answers with: 200 OK, 201 created, 400 bad request, 401 not logged in, 403 not allowed, 404 not found, 429 too many requests, 503 a service we depend on is unavailable |
| Environment variable | A setting given to a program from outside, like `PORT=3000` |
| Database transaction | A group of database changes that happen all together or not at all |
| Outbox | A table of "emails to send"; written together with the ticket and sent later by a worker |
| Idempotency key | A label sent with a request so that sending it twice has the same effect as once |
| Rate limit | A maximum number of requests per minute; the store API allows 60 |
| Cache | A short-lived saved copy to avoid asking again |
| Race condition | A bug that only happens when two things run at exactly the same time |
| Path traversal | Using `../` in a file name to escape the intended folder |
| Code injection | Getting a server to run text you sent as code |
| Blueprint (Render) | A `render.yaml` file that describes which services to create |
| Deploy | Putting a version of the code on the live server |
| Rollback | Going back to the previous working version |
