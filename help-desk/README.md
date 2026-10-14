# Order help desk

Customers check where their order is and report a problem. The team sees the tickets and marks them resolved. Every ticket sends the customer one confirmation email, and resolving it sends one "resolved" email.

## Run it

Needs Node 22.13 or newer (it uses Node's built-in SQLite). Nothing else to install apart from `npm install`.

```
cd help-desk
npm install
node store-api.js                                          # terminal 1: the store API on :4000
PORT=3000 STORE_API_URL=http://localhost:4000 npm start    # terminal 2: the help desk on :3000
```

Or both at once: `npm run dev`.

On Windows PowerShell set the variables like this: `$env:PORT=3000; $env:STORE_API_URL="http://localhost:4000"; npm start`

- Customer page: http://localhost:3000/
- Team page: http://localhost:3000/team (user `team`, password `plants-2026`; change with `TEAM_USER` / `TEAM_PASSWORD`)
- Health: http://localhost:3000/health

Two copies on one database (requirement 7): start a second one with another `PORT` and the same `DB_FILE`.

```
PORT=3001 STORE_API_URL=http://localhost:4000 npm start
```

## Tests

```
npm test
```

They start the real `store-api.js` with its random slowness turned off, put a small proxy in front of it that can make it fail, hang or answer late on purpose, and start real copies of the app. About 45 seconds.

| File | What it proves |
| --- | --- |
| `test/privacy.test.js` | Req 1: right phone or email shows only status and date; wrong contact, unknown order and wrong ticket all get the same 403 with no order data; team API needs login |
| `test/emails.test.js` | Req 2, 3, 4: double click is one ticket; store API failing when the ticket is made, email arrives later; slow store API, one email; app killed mid-send, one email after restart; resolving twice, one email |
| `test/unavailable.test.js` | Req 5: store API hanging, stopped or failing gives 503 in under 10 s; one slow answer is retried in time |
| `test/two-copies.test.js` | Req 6, 7: two copies on one database: one ticket, one email each; a burst of 90 lookups never goes over 60 store API calls a minute and never gets a 429 |

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | |
| `STORE_API_URL` | http://localhost:4000 | |
| `DB_FILE` | `help-desk/data/helpdesk.db` | SQLite file, shared by all copies |
| `TEAM_USER`, `TEAM_PASSWORD` | team / plants-2026 | the one team login |
| `SESSION_SECRET` | made and kept in the database | signs the team cookie |
| `STORE_API_LIMIT` | 60 | the store API's limit a minute; we use 85% of it |
| `TRUST_PROXY`, `COOKIE_SECURE` | off | set to 1 behind HTTPS on a host |

## How it works, in short

```
browser ──> app (Express) ──> SQLite (tickets, emails outbox, rate-limit window, order cache)
                 │                        ▲
                 └── store API <── outbox worker (in every copy)
```

- **Lookup**: order is fetched from the store API (at most 3 tries, 4 s each, all inside 9 s), cached 30 s, and only `status` and `expected_delivery` go back, if the phone or email matches.
- **Ticket**: the ticket row and its email row are written in one transaction. Same order and same message (ignoring case and spaces) within a minute returns the existing ticket.
- **Emails**: the outbox worker claims one email at a time with a conditional update, so only one copy can take it, and sends it with a fixed `Idempotency-Key`. The store API never sends the same key twice, so retries after a timeout, a crash or from the other copy are safe.
- **Rate limit**: every store API call first takes a slot in a one-minute window kept in the database, so all copies share one budget (51 a minute; emails may use at most 36 so customers always get a turn). A 429 pauses every copy for `Retry-After`.

## Deploy

`docker-compose.yml` runs the store API and the help desk on any server with Docker. `../render.yaml` is the same for Render. Release and rollback steps are in `../ANSWERS.md`, section 10.
