# Answers



Keep the headings as they are. Short answers are fine.



Name: Vardhineedi Uday Kiran

Live link: https://plant-help-desk-yyhh.onrender.com (team page: https://plant-help-desk-yyhh.onrender.com/team, store API: https://plant-store-api-yyhh.onrender.com)

Video link: <!-- link to the screen recording -->

Team page login: user `team`, password: `plant-2026`

Command that starts the help desk: `cd help-desk && npm install && PORT=3000 STORE_API_URL=http://localhost:4000 npm start`

Hours spent on part 1: 12–18 hours

Hours spent on part 2: 4–6 hours

Hours spent on part 3: 6–10 hours (total about 22–34 hours)

AI tools used: ChatGPT. The chats are in `ai/`.



# Part 1: Order help desk



## 1. How to run it



The exact commands, from a fresh clone. Include how to run the tests.



Needs Node 22.13 or newer (the app uses Node's built-in SQLite, so there is no database to install).



```

cd help-desk

npm install

node store-api.js                                          # terminal 1, store API on :4000

PORT=3000 STORE_API_URL=http://localhost:4000 npm start    # terminal 2, help desk on :3000

npm test                                                   # the tests start their own store API and app copies

```



`npm run dev` starts both in one terminal. A second copy for requirement 7: same command with `PORT=3001` (both use `help-desk/data/helpdesk.db` unless `DB_FILE` says otherwise).



Pages: `/` for customers, `/team` for the team. With Docker: `cd help-desk && docker compose up -d --build`.



## 2. What I built and what I left out



Built:

- Node + Express, SQLite through `node:sqlite`, plain HTML/CSS/JS pages (no build step).

- `POST /api/lookup`, `POST /api/tickets`, `GET /health` exactly as in the fixed parts, plus `/api/team/*` for the team page.

- An **outbox**: a ticket and its email are saved in one transaction; a worker in every copy sends the emails with a fixed `Idempotency-Key`.

- A **rate limiter shared through the database**, so all copies together stay under the store API's limit.

- Customer page with the required ids, an order progress tracker, "still checking" messages, and the draft kept if anything fails.

- Team page: login, tickets newest first, open/resolved filter, a dialog per ticket that shows each email's state, and a banner when the store API is down.

- 16 tests covering requirements 1 to 7, Dockerfile, docker-compose, Render blueprint.



Left out:

- Real team accounts (one fixed user, as the task allows). No password reset, no audit log beyond `resolved_by`.

- Team replies to the customer, notes, assigning tickets, paging the ticket list (it loads all tickets).

- Postgres. SQLite is enough for two copies on one machine. Copies on different machines would need Postgres (see 11).

- Alerts when an email keeps failing; the team page shows it, but nobody is paged.



## 3. Order details stay private



How do you make sure nobody sees an order that is not theirs?



- The API returns only `status` and `expected_delivery`, and only when the contact matches the order: the email (case-insensitive) or the last ten digits of the phone (so `+91 90000 10137` works). Name, address, items and total never leave the server.

- A wrong contact, an unknown order number, an empty contact or a strange body all get the **same** 403 with the same text, so nobody can find out which order numbers exist.

- `POST /api/tickets` does the same check before it creates anything; a wrong contact makes no ticket and no email.

- Emails go to the email **on the order**, never to what was typed, so nobody can use the form to send our emails to themselves.

- Guessing is slowed down: 20 lookups a minute per IP per copy. The order number is checked against a pattern before it is put in the store API URL.

- The team API needs the signed, HttpOnly, SameSite=Strict cookie. Pages send a strict Content-Security-Policy, and all text is escaped before it goes into the page.

- Test: `test/privacy.test.js`.



## 4. One email, never two, never none



What happens in your app when:

- the customer clicks submit twice

- the store API is slow and you stop waiting

- the store API fails

- your server restarts in the middle of sending

- two copies of your app are running



Three pieces do the work:

1. The ticket and its email row are written in **one transaction**, so a ticket always has its email waiting.

2. Each email row gets an `Idempotency-Key` when it is created (`helpdesk-<database id>-ticket-<id>-<kind>`). Every send of that email, from any copy and after any crash, uses the same key, so the store API sends it at most once.

3. A worker claims an email with `UPDATE ... WHERE locked_until <= now`, so only one copy works on it at a time. The claim runs out after 30 s.



- **Clicked twice**: the button is disabled while sending, and the page sends the same `request_id` again. On the server, `BEGIN IMMEDIATE` makes the "is there already a ticket with this order and message from the last minute?" check and the insert happen as one step, so both clicks get the same `ticket_id`. One ticket, one email row, one email.

- **Slow, we stop waiting** (10 s): the email may have gone out. The row stays pending and is retried with the same key; the store API answers with the first email's id and does not send again.

- **Fails** (500 or cannot connect): the row stays pending with the error, and is retried with backoff (2 s, 4 s ... up to 60 s), forever. A 400 (the email itself is bad) is marked failed and shown in red to the team.

- **Restart mid-send**: the claim runs out after 30 s and a copy (the restarted one or the other) sends again with the same key: still one email. On a normal stop (SIGTERM) the app first finishes the email it is sending.

- **Two copies**: same database, so the same claim and the same keys; tested in `test/two-copies.test.js`. Resolving: `UPDATE tickets SET status='resolved' WHERE id=? AND status='open'` changes one row once, and only that call adds the "resolved" email.



Limit: the store API only remembers keys for 24 hours (and forgets them if it restarts). An email that kept failing for over a day after one attempt quietly got through could be sent twice. The key includes a random id per database, so a wiped database can never reuse an old key.



## 5. No ticket lost



- The ticket is committed to SQLite (WAL, `synchronous=FULL`) **before** we answer 201, so a crash after the answer cannot lose it.

- Making a ticket does not need the store API to be up. If the customer looked the order up in the last 24 hours, the cached order is enough to check the contact. If the order cannot be checked at all, the customer gets a 503 and the page keeps the message, so it is not lost there either.

- An email that cannot be sent is kept and retried; a ticket never disappears because of its email.

- Two copies write to the same file with `BEGIN IMMEDIATE` and `busy_timeout`, so writes wait for each other instead of failing.

- Test: in `test/emails.test.js` the store API fails, the ticket is made, the app is killed, a new copy starts, and the ticket and its single email are still there.



## 6. Slow or broken store API



What does the customer see? What does the team see?



- **API**: an order lookup tries at most three times, 4 s each, all inside 9 s, then answers **503** with `{"error":"store_unavailable"}`. One slow answer (5-9 s) is usually saved by the second try.

- **Customer**: right away "Checking your order…", after 3 s "Still checking. Our order system is slow right now, this can take up to 10 seconds…", then on 503 a yellow box: "We cannot reach our order system right now. What you typed is still here. Please try again in a minute." Buttons go back to normal, fields keep their text (also saved in the tab's sessionStorage, so a reload keeps it). The page also gives up by itself after 15 s if the connection is dead. If they already looked up their order, reporting a problem still works while the store API is down.

- **Team**: a yellow banner "The store API is not answering (timeout, 2 min ago). Customers see 'try again in a minute'. 3 email(s) are waiting and will be sent automatically when it is back." Each ticket shows "Email waiting", and its dialog says "Confirmation email: waiting to send (tried 4×, store API: status 500; it keeps trying)".



## 7. Rate limit



- Every call to the store API first takes a slot in a one-minute sliding window stored in the `store_calls` table, inside `BEGIN IMMEDIATE`, so **all copies share one count**.

- We use 51 of the 60 (85%) to leave room for clock differences and for people opening `/emails`. Emails may use at most 36 of those, so a customer lookup always has room.

- If the window is full: a lookup waits if a slot frees inside its 9 s, otherwise answers 503. An email just tries later.

- If the store API still says 429, every copy pauses for `Retry-After` (kept in the database).

- Fewer calls in the first place: orders are cached 30 s for lookups and 24 h for checking a ticket's contact, a down store API gets at most 3 tries per request, and one IP gets 20 lookups a minute.

- Test: two copies, 90 lookups at once. The store API saw at most 60 calls in any minute and never answered 429.



## 8. Tests



What do your tests prove, and what is not tested?



`npm test` (about 45 s). They run the **real** `store-api.js` with SLOW=0 and FAIL=0, behind a small proxy that makes it fail, hang, answer late, or take the email and never answer, exactly when the test wants. They also run real copies of the app as separate processes.



Proved:

- Req 1: right contact (phone in different formats, email in any case) gets only status and date; wrong contact, someone else's contact, unknown order, empty or odd input get the same 403 with no order data; a wrong-contact ticket makes nothing; the team API needs login.

- Req 2/4: store API failing when the ticket is made: 201, the email is retried and arrives once it is back.

- Req 3: double click (concurrent), same message with other spaces and capitals, slow email (retried, one email), app killed with SIGKILL while the email is in flight (one email after restart), resolve twice at once (one email), new ticket after the dedupe window.

- Req 5: store API hanging, refusing connections, or always 500: 503 in under 10 s for lookup and ticket; one slow answer retried in time.

- Req 6/7: two copies, same ticket from both, resolve from both, a 90-request burst within the limit.



Not tested: the pages themselves (I checked them by hand at phone width and with the keyboard only), the store API restarting and forgetting its keys, the 24-hour key limit, the per-IP limit, power loss, and copies on different machines.



## 9. The pages



What could confuse a customer or a team member on your pages, and what did you do about it?



- **Where is my order number?** A hint under the field says where to find it. Lower-case and spaces are fine.

- **Which phone format?** Any: `+91 98765 43210`, `098765-43210`, or the email. Comparison uses the last ten digits.

- **Wrong details**: one clear sentence, both fields stay filled, nothing about the order is shown.

- **Slow answers**: the button changes to "Checking…" and is disabled, and after 3 s a message explains the wait, so nobody clicks again or thinks it is broken.

- **Did my report go through?** The answer shows the ticket number and says the confirmation email can take a few minutes, because it really can when the store API is down.

- **Report form below the lookup**: its text says it uses the order number and phone or email from above. If those are empty it says so and moves the focus there.

- **Status words**: a tracker shows placed → packed → shipped → out for delivery → delivered, and dates are shown as `2026-09-07 (Monday, 7 September 2026)`.

- **Team**: "Open" is the default filter so finished work does not hide new tickets. Email state is written in words. Resolving asks for nothing more but says "The customer will get one email". If someone else already resolved it, it says that instead of failing. A ticket that was resolved cannot be resolved again (the button is hidden).

- Phones and keyboards: 44 px touch targets, one column on small screens, labels on every field, visible focus outline, Enter submits, the ticket dialog is a real `<dialog>` (focus moves in, Escape closes, focus goes back to the ticket). Status messages are in `aria-live` regions so screen readers hear them. Dark mode follows the phone setting.



## 10. Deployment



Where is it hosted, how do you release a new version, and how would you go back to the old one?



Hosting: Render, from `render.yaml` in the repo. Two web services: `plant-store-api` runs `store-api.js` unchanged, and `plant-help-desk` runs the app with `STORE_API_URL` pointing at the store API. Both are on the free plan. A free instance has no disk, so the SQLite file starts empty after every deploy or restart, and the service sleeps after 15 minutes without traffic (the first request then takes about a minute). That is fine for the review but not for real use: for that I would move the help desk to a paid instance with a disk, or run `help-desk/docker-compose.yml` on a small VM where the database sits on a volume.



Release (Render): every push to `main` deploys automatically. Render builds the new version, starts it, waits for `/health` to answer, and only then sends traffic to it and stops the old one, so a broken build never goes live.

Going back (Render): open the service, go to Events / Deploys, and press "Rollback" on the last good deploy. Or `git revert` the bad commit and push.



Release (Docker on a VM, the setup I would use for real):

1. Merge to `main`; `npm test` must pass.

2. Tag it: `git tag v1.3.0 && git push --tags`.

3. On the server: `git fetch --tags && git checkout v1.3.0`, then take a consistent copy of the database while it runs:

   `docker compose exec helpdesk node -e "new (require('node:sqlite').DatabaseSync)('/data/helpdesk.db').exec(\\"VACUUM INTO '/data/before-v1.3.0.db'\\")"`

4. `TAG=v1.3.0 docker compose up -d --build helpdesk`. Compose stops the old container with SIGTERM: it stops taking requests, finishes the email it is sending (20 s grace), and the new one starts. Emails waiting in the outbox are sent by the new version. With the second copy running (`--profile two-copies`), restart them one at a time and there is no downtime at all.

5. Check `/health`, do one lookup, and look at the team page.



Going back: the old image is still on the server under its tag, so `git checkout v1.2.0 && TAG=v1.2.0 docker compose up -d helpdesk` takes seconds and needs no build. Database changes are only ever added (new tables or columns, `PRAGMA user_version` counts them), so the old version can still run on the newer database. If a release ever had to change data in a way the old version cannot read, restore the backup from step 3.



## 11. If this had 1,000 stores



What would break first?



1. **SQLite's single writer.** Every ticket, every email claim and every rate-limit slot takes the same write lock. With 1,000 stores the copies would queue on it and start timing out. Move to Postgres: `SELECT ... FOR UPDATE SKIP LOCKED` for the outbox, a unique index for the one-minute dedupe, and copies on many machines.

2. **The rate limiter is one counter.** Each store has its own store API and its own limit, so the window has to be per store (a key per store, likely in Redis), and one busy store must not use up the others' budget or block their emails.

3. **One outbox loop polling every second in every copy.** Fine for two copies, wasteful for fifty. Use a queue (or `LISTEN/NOTIFY`) and per-store fairness.

4. **One shared team login and a page that loads every ticket.** Needs real accounts per store with roles, paging and search.

5. The in-memory per-IP limit and the order cache would also need to live in a shared store.



# Part 2: Failed deliveries



## 12. Where the money goes



The three changes that would save the most. Worst first.



A returned parcel costs 2 × shipping + 40% of the order value. In the 60 days, **191 parcels came back and cost Rs 75,910** (Rs 397 each on average). Run `python failed-deliveries/analysis.py`; the output is saved in `failed-deliveries/analysis_output.txt`.



| What I would change | The numbers from the file | Saves about (Rs in 60 days) | How I worked it out |

| ------------------- | ------------------------- | --------------------------- | ------------------- |

| 1. Call (or WhatsApp) every customer after the **first** missed delivery (not home, wrong address, phone off), before the courier tries again. Today most of them never hear from us and the courier just tries three times. | Finished parcels with one of those failures: **contacted 74, 17 came back (23%)**; **not contacted 122, 83 came back (68%)**, costing Rs 31,041. Per reason, not contacted vs contacted: wrong address 87% vs 19%, not home 55% vs 23%, phone off 50% vs 18%. 171 of the 191 returns were never contacted. | **Rs 20,600** (about Rs 10,300 if calling works only half as well as the data suggests) | If the 122 not-contacted parcels came back at the contacted rate (23%): 28 returns instead of 83, so 55 fewer × Rs 374 (their average cost) = Rs 20,559. Parcels in change 3 are left out so nothing is counted twice. |

| 2. **Confirm cash-on-delivery orders before they ship** (an automatic call or WhatsApp "reply YES"), and ask for prepayment from addresses that refused before. | COD: **70 of 984 refused (7.1%)**, 62 came back, costing **Rs 24,343**. Prepaid: 7 of 2,283 refused (0.3%). Refused parcels come back 90% of the time, after one attempt. Without refusals, COD and prepaid come back at the same rate (3.8% vs 3.7%). | **Rs 12,200** (up to Rs 23,200) | Upper bound: COD refusing as rarely as prepaid would save Rs 24,343 − Rs 1,185 = Rs 23,158. Not every refuser will say no before shipping, so I plan on half: Rs 12,171. |

| 3. **Stop using QuickDrop for the north-east** (Guwahati, Agartala, Imphal); send those with PostPlus or BlueLine. | QuickDrop north-east: **89 parcels, 22 came back (24.7%)**, 17 of them "wrong address", costing Rs 10,329. BlueLine + PostPlus in the same cities: 308 parcels, 23 came back (7.5%). Outside the north-east QuickDrop is as good as the others (5.1% vs 4.8% and 5.8%). Prices are the same bands for all couriers. | **Rs 7,200** | The same 89 parcels at 7.5%: 6.6 returns instead of 22, so 15.4 fewer × Rs 469 (their average cost) = Rs 7,209. |



Together about Rs 40,000 of the Rs 75,910 (53%), using the cautious number for change 2.



## 13. What looked like a problem but is not



- **BlueLine costs the most** (Rs 37,481 of returns), but it carries 55% of the parcels. Outside the north-east its return rate (4.8%) is the same as the others.

- **Cash on delivery comes back 2.5 times as often** (10.1% vs 4.0%). That is all refusals: leave refusals out and COD and prepaid are the same (3.8% vs 3.7%). COD is not the problem; refusing at the door is (change 2).

- **Mumbai and Delhi top the cost list** mostly because they send the most parcels.

- **The last week looks almost perfect** (no returns from 6 October on). Those parcels are simply not finished yet (89 in transit, 31 still with the courier).

- **"Three attempts" parcels** (162, 75% returned) look like a courier problem, but nearly all of them were never contacted. Three attempts are a symptom of change 1.

- **Sending again**: 67 parcels were sent a second time and 60 were delivered (3 came back). Re-shipping works and is worth keeping.

- **North-east shipping is dearer** (Rs 75-115 against Rs 45-85). That is distance, and every courier charges the same bands, so switching courier there costs nothing extra.



## 14. The action list



The command that writes actions.csv, and how you checked the list is right.



```

cd failed-deliveries

python make_actions.py              # reads shipments.csv, writes actions.csv

python -m unittest test_make_actions.py

```



Standard library only, Python 3.8+. It wrote **57 rows**: RETURN 12, ASK_ADDRESS 4, CONTACT 8, RETRY 7, ASK_CHOICE 15, CLOSE 11.



How I checked it:

- A unit test for each rule, and for the order of the rules (refused beats three attempts; three attempts beat wrong address; wrong address is asked even when not contacted).

- A test on the real file: one row per parcel; every one of the 31 `failed_open` parcels has a row; the other rows are exactly the 48 open returns minus the 22 already sent again (31 + 26 = 57); delivered and in-transit parcels never appear.

- Counted the rule groups by hand with a separate query and compared, and read some rows myself, for example S12262: it is itself a re-ship that came back, nothing was sent after it, and it is prepaid, so ASK_CHOICE.



## 15. What I was not sure about



- **"Three attempts were made"**: read as `attempts >= 3`.

- **"The order has already been sent again"**: a parcel whose `reship_of` points at this one. As a fallback, also any later parcel with the same order number; in this file the two give the same answer.

- **A re-ship that came back itself** (S12262, S12732) is handled like any other returned parcel; its own original was already dealt with.

- **Empty `customer_contacted`** on a failed parcel counts as "not contacted", so it gets CONTACT. That never happens in this file.

- **Does calling really cause the difference?** The team may call the customers who are easier to reach. That is why I give the half number too. A simple test: call every other failed parcel for two weeks and compare.

- **COD confirmation effect** is an estimate (half), not something the file shows.

- **The cost model** leaves out the cost of a re-ship, courier fees per attempt, the cost of staff calling, and lost repeat business. Change 1 needs about 3-4 calls a day.

- The rates leave out parcels that are still open, so they could move a little once those finish.



# Part 3: Returns service



## 16. Security problems, worst first



| # | What is wrong | Where (file) | Who can do it | What they get | Fixed? |

| - | ------------- | ------------ | ------------- | ------------- | ------ |

| 1 | The `status` filter is pasted into `new Function(...)`, so `?status=' || process.exit() || '` runs code on the server. | server.js (`GET /admin/returns`) | Anyone with a token, and because of #2 that is **anyone** | Runs any code on the server: reads all data, changes anything, stops or takes over the server. | **Yes**, plain comparison. Test in `security.test.js`. |

| 2 | Admin tokens are just `base64("username:role")`; the server believes whatever it decodes. `check()` even accepts `base64("x:manager")`. | auth.js | **Anyone**, no password needed | Manager access: approve or reject any return, export every customer's name, phone, email, address, and the password hashes. Opens #1 to everyone. | **Yes**, random 32-byte tokens kept on the server, 8 h expiry. Test. |

| 3 | Photo upload joins the customer's filename onto the uploads path, so `../server.js` or `../../anything` is written outside the folder. | server.js (`POST /returns/:id/photo`) | **Anyone**, no login; return ids are 1, 2, 3… | Overwrite any file the server can write: its own code (runs at the next restart), `data.json`, other customers' photos. | **Yes**, the server makes the file name, keeps only an image extension, and checks the path stays in `uploads`. Test. |

| 4 | `PATCH /returns/:id` copies the whole body into the return (`Object.assign`), with no login and no check of who owns it. | server.js | **Anyone**; ids are counted | Set `status: "approved"`, `refund_amount: 99999`, `method`, change the customer's address or phone on any return. `__proto__` in the body also changes the object's prototype. | No |

| 5 | `decide` trusts the request: two lines of the same sku are each checked separately (buy 1, return 2); a negative `qty` is accepted (refund −1645), and once saved it lowers the "already returned" count so later you can return 6 of 1 (refund Rs 1,974 on a Rs 329 order); `photo: true` is just believed. | returns.js | **Anyone** with an order number | Refunds or credit for more than they bought; damaged returns skip the photo check. | No (kept: part 2 says not to change what decide decides) |

| 6 | Anyone can create a return for any order: only the order number is needed, and they are sequential (ORD-2001…). The answer includes the customer's name, phone, email and address. | server.js (`POST /returns`) | **Anyone** | Every customer's personal details, and false returns filed on other people's orders. | No |

| 7 | `GET /returns/:id` has no login and ids are 1, 2, 3… | server.js | **Anyone** | Name, phone, email, address and order of every customer who made a return. | No |

| 8 | The viewer role can approve and reject; there is no role check, though the README says only a manager should. | server.js | Any team member (sam) | Approve their own or a friend's refund. | No |

| 9 | `/admin/export` gives everything, including all password hashes, to any logged-in user. | server.js | Any team member, including viewers | All customer data and the hashes for #10. | No |

| 10 | Passwords are unsalted MD5, and weak ones are written in the README. | db.js, README.md | Anyone with the hashes (#9) or the README | Cracks the passwords in seconds and logs in as a manager. | No |

| 11 | No limit on login tries, and the answer says whether the username exists ("no such user" / "wrong password"). | auth.js | Anyone | Finds usernames and guesses passwords without being slowed down. | No |

| 12 | Every request body is logged, including passwords on login and base64 photos; tokens can be sent in the URL (`?token=`), so they end up in logs, browser history and proxies. | server.js | Anyone who can read logs or history | Team passwords and tokens. | No |

| 13 | Errors return `e.stack` to the caller. | server.js | Anyone (send bad JSON) | File paths and code details that help with other attacks. | No |

| 14 | No limit on body or photo size. | server.js | Anyone | Fill the memory or the disk and stop the service. | No |

| 15 | `access-control-allow-origin: *` on every answer. | server.js | Any website a team member visits, with a token in the URL | Can read API answers from the browser. Low on its own. | No |

| 16 | `data.json` is rewritten in place on every change, and ids are `returns.length + 1`. | db.js, server.js | Happens by itself on a crash or two quick requests | A crash mid-write can wipe all data; ids could repeat if a return is ever removed. A reliability problem more than security. | No |



## 17. Why this order



I ranked by what the worst person can do, and how easily. #1 to #3 give control of the server itself. #1 and #2 together let anyone on the internet run code with one request, so they come first. #3 also needs no login, but the code it writes only runs at the next restart. #4 and #5 are direct money loss for anyone, but they stay inside the returns data. #6 and #7 leak personal data at scale. #8 to #11 need a team login first or make another attack easier. #12 to #16 are real but need extra access or only cause outages. I fixed the top three because each is a single small change and together they close "anyone can take over the server". The next one I would fix is #4: allow only `reason` and `note` in PATCH.



## 18. The clean-up



What you changed in `decide`, and how you know it still decides the same.



Changed:

- The long `if kind == seed / plant / tool / pot / else` chain became one table, `ITEM_RULES`: which reasons are accepted, the last day of the window, whether damaged needs a photo, and the bulk limit. Changing a rule (say, plants 5 days) is now one number.

- The reason words are in `REASONS`, the money rules (5% bonus, Rs 2000 review, when shipping comes back) in `MONEY`.

- The loop body became small functions with names: `checkItem`, `orderLine`, `alreadyReturned`, `valueAfterCoupon`, `wholeOrder`, `reasonType`.

- The repeat counter is one named object with a comment, instead of two loose globals.

- Same name, same four arguments, same answers. No other file needed changing for the clean-up.



How I know it still decides the same:

- Before touching it I copied the old file to `returns-service/legacy/decide-before-cleanup.js`.

- `decide-same.test.js` makes **30,000 requests** from a fixed random seed (all kinds, reasons, window edges like day 3.5 and 6.9, cod and prepaid, coupons, wrong skus, odd quantities like 0, −1, 1.5, "2", earlier returns, the same order several times in a row) and checks that the old and the new `decide` give exactly the same answer, in the same order, so even the repeat counter is compared.

- To make sure that test would catch a mistake, I changed the new code on purpose four ways (tool window by a day, bulk limit, which order line wins, repeat limit). The test failed each time.

- The original 8 tests still pass.



## 19. Behaviour that looks wrong and I did not change



All checked by running `decide`; all still there on purpose.

1. **Tools close a day earlier**: a tool is refused on day 7 (`>= 7`), a pot or potting mix only on day 8 (`> 7`). The README says "within a week" for both.

2. **The repeat counter is global**: it counts back-to-back calls for the same order across all customers in the process, any other order in between resets it, a restart resets it, and it counts even cancelled or rejected requests. It is not "3 requests for this order".

3. **Same sku twice in one request** is checked twice against earlier returns only, so you can return 2 of 1 (refund Rs 658 for one Rs 329 can).

4. **Negative and odd quantities**: −5 gives a negative refund (−1645) and is approved; saved, it makes later returns of more than was bought possible. `qty: 0` counts as 1; `1.5` is accepted.

5. **The photo is self-declared**: `photo: true` with no upload is enough.

6. **Damaged potting mix (and any unknown kind) needs no photo**, unlike plants, tools and pots.

7. **Damaged seeds are refused**: only "wrong" seeds come back.

8. **The 5% credit bonus is also paid on the refunded shipping**, and it is added before the Rs 2000 check, so asking for credit can push a return into review.

9. **COD + "refund"** quietly becomes credit without the 5%; COD + "credit" gets the 5%.

10. **No delivery date** (`delivered_at` missing) means no window at all: always in time.

11. **Reason words are crude**: "not damaged, just changed my mind" counts as damaged; "different plans" counts as wrong item.

12. **Shipping back on the "last part" of an order**: if an earlier return took some items, a later damaged/wrong return of the rest counts as "the whole order" and gets shipping again.



## 20. The exchange



- Request: `want: "exchange"` and `exchange_for` (a sku from the product list). The list moved from `db.js` to `products.js` (db.js still seeds from it) so `decide` can look up the price without loading the data file. An unknown `exchange_for` is rejected.

- **Same rules**: the items go through exactly the same checks as a refund (kind, reason, window, photo, bulk, quantity left). Only the items that pass are exchanged.

- **Value coming back** = price × quantity less its share of the coupon. No 5% extra, no shipping, and COD does not turn it into credit.

- **New items** = price of `exchange_for` × the same total quantity that is coming back.

- Answer: `method: "exchange"`, `refund_amount: 0`, `pay_amount` (new costs more) or `credit_amount` (new costs less), the other one 0, both 0 when equal. It also has `exchange_for`, `exchange_qty` and `returned_value`, so the team can see how it was worked out. The server saves those on the return.

- Over Rs 2000 coming back, a person looks at it, like a refund; repeat requests are flagged the same way.

- Tests: `exchange.test.js` (10 tests: dearer, cheaper with no shipping, two for two, coupon share, COD and no bonus, the same rules, partly refused, review over 2000, unknown sku, refunds unchanged). `decide-same.test.js` still passes, so refunds and credit decide exactly as before.

- My assumption: if several different items come back, the customer gets the same **number** of the new item.



# All parts



## 21. AI

Where did AI help, and where was it wrong?

I used ChatGPT for limited coding assistance during the developer assessment. The related prompts, responses, and notes are organized in the `ai/` folder.

**Helped:**
- Reviewing the supplied code and identifying potential issues without rewriting entire files.
- Explaining errors in simple terms and suggesting minimal corrections with comments.
- Improving code readability, formatting, and organization.
- Suggesting frontend accessibility checks, including labels, keyboard navigation, focus visibility, semantic HTML, and error announcements.
- Suggesting responsive UI improvements while preserving existing element IDs, API routes, and backend logic.
- Summarizing coding discussions and organizing prompts, responses, and technical notes into Markdown files.
- Using AI to phrase technical explanations clearly, add relevant comments, and structure detailed documentation for `README.md` and `ANSWERS.md`.

**Wrong or needed fixing:**
- The startup script review did not reveal a confirmed syntax error because no actual runtime error message was provided.
- Some suggestions, such as improving shutdown handling, were optional robustness improvements rather than confirmed fixes.
- The accessibility review was initially given backend API code rather than the actual frontend page. It could therefore provide general recommendations but could not verify page-specific accessibility defects.
- The suggested HTML was illustrative and would need to be checked against the existing frontend before integration.
- AI suggestions were treated as recommendations, not verified solutions. Code and runtime behavior must be checked before claiming that a fix works.

I used AI as an assistance tool for understanding code, small corrections, comments, summaries, and documentation—not as a replacement for reviewing the implementation or verifying results.

## 22. Not done

Anything that does not work or that you are not sure about.

- The help desk runs on Render's free plan: its database is empty again after every deploy or restart, and it sleeps after 15 minutes idle (the first visit then takes about a minute). For real use it needs a paid instance with a disk, or the Docker setup on a server.
- I could not run the Docker files on this machine (Docker was not running). The app itself, the tests and the pages were run locally, and the live site was checked after deploying.
- Security problems #4 to #16 in part 3 are listed, not fixed.
- The page tests are manual (keyboard and phone width in a browser); there is no automated browser test.
- Copies on different machines would need Postgres instead of a shared SQLite file.
