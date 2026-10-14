# Plant store – developer task

My submission for the three-part task. Each part has its own folder, and the written answers are in [ANSWERS.md](ANSWERS.md). The full step-by-step guide (links, logins, running, testing, deployment) is in [DOCUMENTATION.md](DOCUMENTATION.md).

- `help-desk/` – part 1, the order help desk (customer page + team page)
- `failed-deliveries/` – part 2, the returned-parcel analysis and the action list script
- `returns-service/` – part 3, security fixes, the `decide` clean-up and exchanges
- `ai/` – AI chat history, as asked in the task

## Setup

You'll need Node 22.13+ (part 1 uses the built-in `node:sqlite`, so no database install) and Python 3.8+ for part 2. Docker only if you want to deploy part 1 the way I did.

## Part 1 – help desk

```bash
cd help-desk
npm install
npm run dev
```

`npm run dev` starts the store API on 4000 and the help desk on 3000. If you'd rather run them separately:

```bash
node store-api.js
PORT=3000 STORE_API_URL=http://localhost:4000 npm start
```

Customer page is at http://localhost:3000, team page at http://localhost:3000/team (login `team` / `plants-2026`).
For a quick try: order `ORD-1001`, phone `9000010137`.

Tests: `npm test`. They take ~45s because they start real copies of the app and the store API, and some of them wait out timeouts on purpose.

A few notes on how it's put together:

- Tickets and their emails are saved in the same transaction. Emails go out from a background worker (an outbox), and each one has a fixed idempotency key, so a retry never sends a second email.
- Calls to the store API are counted in the database, so two copies of the app share the 60/min limit instead of each thinking it has 60.
- Lookups give up after 9s and return a 503. The page keeps whatever the customer typed.

More detail in `help-desk/README.md` and ANSWERS.md sections 1–11.

## Part 2 – failed deliveries

```bash
cd failed-deliveries
python analysis.py                        # the breakdown behind section 12
python make_actions.py                    # writes actions.csv
python -m unittest test_make_actions.py
```

Returns cost Rs 75,910 over the 60 days. The three changes I'd make are calling the customer after the first failed attempt, confirming COD orders before dispatch, and moving the north-east off QuickDrop. Numbers and working are in ANSWERS.md section 12.

## Part 3 – returns service

```bash
cd returns-service
node --test
node server.js     # port 4300
```

Fixed the three worst security issues: code injection in the status filter, forgeable admin tokens, and path traversal in the photo upload. Each one has a test that fails on the old code. The full list of issues is in ANSWERS.md section 16.

`decide` is now table-driven. `decide-same.test.js` compares it against the original (kept in `legacy/`) on 30k generated requests to make sure nothing changed. Exchange support was added after that, in `exchange.test.js`.
