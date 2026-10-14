// Requirements 6 and 7: two copies of the app on one database stay inside the
// store API's rate limit together, and still make one ticket and one email.
const test = require("node:test");
const assert = require("node:assert");
const { startStore, startProxy, startApp, tempDb, removeDb, waitFor, sleep } = require("./helpers");

let store, proxy, a, b, db, orders;

test.before(async () => {
  store = await startStore({ limit: 60 });
  proxy = await startProxy(store.url);
  db = tempDb();
  [a, b] = await Promise.all([startApp({ storeUrl: proxy.url, dbFile: db }), startApp({ storeUrl: proxy.url, dbFile: db })]);
  orders = await store.orders();
});
test.after(async () => {
  await Promise.all([a.stop(), b.stop()]);
  proxy.stop();
  store.stop();
  removeDb(db);
});

test("same ticket sent to both copies at once: one ticket, one email; resolved from both: one email", async () => {
  const o = orders[20];
  const body = { order_number: o.order_number, contact: o.email, message: "Two copies" };
  const results = await Promise.all([a.post("/api/tickets", body), b.post("/api/tickets", body), a.post("/api/tickets", body), b.post("/api/tickets", body)]);
  const ids = new Set(results.map((r) => r.body.ticket_id));
  assert.equal(ids.size, 1);
  const id = [...ids][0];

  await a.login();
  await b.login(); // the session cookie from one copy also works on the other; each just logs in here
  const [x, y] = await Promise.all([a.post(`/api/team/tickets/${id}/resolve`), b.post(`/api/team/tickets/${id}/resolve`)]);
  assert.equal(x.status, 200);
  assert.equal(y.status, 200);
  assert.equal([x, y].filter((r) => !r.body.already_resolved).length, 1);

  await waitFor(async () => (await store.emails()).filter((e) => e.to === o.email).length === 2, { what: "two emails" });
  await sleep(1500);
  const mails = (await store.emails()).filter((e) => e.to === o.email);
  assert.equal(mails.length, 2);
  assert.deepEqual(mails.map((m) => /resolved/.test(m.subject)), [false, true]);
});

test("a burst of lookups across both copies never goes over 60 store API calls a minute", async () => {
  proxy.log.length = 0;
  // order numbers that do not exist: nothing is cached, so every lookup needs the store API
  const requests = [];
  for (let i = 0; i < 90; i++) {
    const app = i % 2 ? a : b;
    requests.push(app.post("/api/lookup", { order_number: "ORD-" + (5000 + i), contact: "9999999999" }));
  }
  const started = Date.now();
  const results = await Promise.all(requests);

  for (const r of results) assert.ok(r.status === 403 || r.status === 503, "got " + r.status);
  assert.ok(Date.now() - started < 12_000);
  assert.ok(results.some((r) => r.status === 503), "some had to be turned away");

  assert.equal(proxy.log.filter((l) => l.status === 429).length, 0, "the store API never said 429");
  const times = proxy.log.map((l) => l.at).sort((p, q) => p - q);
  let worst = 0;
  for (let i = 0; i < times.length; i++) {
    let j = i;
    while (j < times.length && times[j] - times[i] < 60_000) j++;
    worst = Math.max(worst, j - i);
  }
  assert.ok(worst <= 60, `${worst} calls in one minute`);
});
