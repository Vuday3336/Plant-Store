// Requirements 2, 3 and 4: every ticket gets its email, never twice, and no
// ticket is lost, when the store API fails, is slow, or our app crashes.
const test = require("node:test");
const assert = require("node:assert");
const { startStore, startProxy, startApp, tempDb, removeDb, waitFor, sleep } = require("./helpers");

let store, proxy, orders;
let next = 0;
// a different order for each test, so email counts do not mix
const order = () => orders[next++];

test.before(async () => {
  store = await startStore();
  proxy = await startProxy(store.url);
  orders = await store.orders();
});
test.after(() => {
  proxy.stop();
  store.stop();
});

async function emailsTo(address) {
  return (await store.emails()).filter((e) => e.to === address);
}

async function withApp(fn, env) {
  const db = tempDb();
  const app = await startApp({ storeUrl: proxy.url, dbFile: db, env });
  try {
    await fn(app, db);
  } finally {
    await app.stop();
    proxy.rule = () => "pass";
    removeDb(db);
  }
}

test("double click: same order and message is one ticket and one email", async () => {
  await withApp(async (app) => {
    const o = order();
    const body = { order_number: o.order_number, contact: o.email, message: "The pot arrived broken" };
    const [a, b] = await Promise.all([app.post("/api/tickets", body), app.post("/api/tickets", body)]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.ticket_id, b.body.ticket_id);

    // spaces and capitals do not make it a new message
    const c = await app.post("/api/tickets", { ...body, message: "  the pot ARRIVED   broken " });
    assert.equal(c.body.ticket_id, a.body.ticket_id);

    // a different message is a different ticket
    const d = await app.post("/api/tickets", { ...body, message: "Also the soil was wet" });
    assert.notEqual(d.body.ticket_id, a.body.ticket_id);

    await waitFor(async () => (await emailsTo(o.email)).length === 2, { what: "two confirmations" });
    await sleep(1000);
    assert.equal((await emailsTo(o.email)).length, 2);
  });
});

test("the same message after the minute is a new ticket", async () => {
  await withApp(
    async (app) => {
      const o = order();
      const body = { order_number: o.order_number, contact: o.phone, message: "Still waiting" };
      const first = await app.post("/api/tickets", body);
      await sleep(1200);
      const second = await app.post("/api/tickets", body);
      assert.notEqual(second.body.ticket_id, first.body.ticket_id);
    },
    { TICKET_DEDUPE_MS: "1000" } // a one-minute wait made short for the test
  );
});

test("store API failing when the ticket is made: ticket is kept, email goes out once it is back", async () => {
  await withApp(async (app) => {
    const o = order();
    // the customer looks the order up first, as on the page
    assert.equal((await app.post("/api/lookup", { order_number: o.order_number, contact: o.phone })).status, 200);

    proxy.rule = () => "error"; // every store API call fails from now on
    const r = await app.post("/api/tickets", { order_number: o.order_number, contact: o.phone, message: "Leaves are yellow" });
    assert.equal(r.status, 201);

    await app.login();
    await waitFor(async () => {
      const t = (await app.get("/api/team/tickets")).body.tickets.find((x) => x.id === r.body.ticket_id);
      return t && t.emails[0].attempts >= 2;
    }, { what: "a few failed send attempts" });
    assert.equal((await emailsTo(o.email)).length, 0);

    proxy.rule = () => "pass";
    await waitFor(async () => (await emailsTo(o.email)).length === 1, { what: "the confirmation" });
    const t = (await app.get("/api/team/tickets")).body.tickets.find((x) => x.id === r.body.ticket_id);
    assert.equal(t.emails[0].status, "sent");
  });
});

test("store API slow to answer: we stop waiting, retry, and still send one email", async () => {
  await withApp(async (app) => {
    const o = order();
    proxy.log.length = 0;
    proxy.slowMs = 2500; // longer than EMAIL_TIMEOUT_MS (1500) in the tests
    proxy.rule = (method, path) => (method === "POST" && path === "/emails" ? "slow" : "pass");
    const r = await app.post("/api/tickets", { order_number: o.order_number, contact: o.email, message: "Slow day" });
    assert.equal(r.status, 201);

    await waitFor(() => proxy.log.filter((l) => l.path === "/emails" && l.status === 200).length >= 2, {
      what: "the email to be tried twice",
    });
    proxy.rule = () => "pass";
    await app.login();
    await waitFor(async () => {
      const t = (await app.get("/api/team/tickets")).body.tickets[0];
      return t.emails[0].status === "sent";
    }, { what: "email marked sent" });
    assert.equal((await emailsTo(o.email)).length, 1);
  });
});

test("app crashes while sending: after restart the email is not sent twice and the ticket is still there", async () => {
  const o = order();
  const db = tempDb();
  try {
    proxy.log.length = 0;
    // the email reaches the store API and goes out, but the answer never comes back
    proxy.rule = (method, path) => (method === "POST" && path === "/emails" ? "send-then-hang" : "pass");
    const first = await startApp({ storeUrl: proxy.url, dbFile: db });
    const r = await first.post("/api/tickets", { order_number: o.order_number, contact: o.phone, message: "Crash test" });
    assert.equal(r.status, 201);
    await waitFor(() => proxy.log.some((l) => l.path === "/emails" && l.status === 200), { what: "email in flight" });
    await first.stop("SIGKILL");
    assert.equal((await emailsTo(o.email)).length, 1, "the store API did send it");

    proxy.rule = () => "pass";
    const second = await startApp({ storeUrl: proxy.url, dbFile: db });
    try {
      await second.login();
      await waitFor(async () => {
        const t = (await second.get("/api/team/tickets")).body.tickets.find((x) => x.id === r.body.ticket_id);
        return t && t.emails[0].status === "sent";
      }, { what: "the new copy to finish the email" });
      assert.equal((await emailsTo(o.email)).length, 1, "still exactly one email");

      // resolving twice sends one email
      const [x, y] = await Promise.all([
        second.post(`/api/team/tickets/${r.body.ticket_id}/resolve`),
        second.post(`/api/team/tickets/${r.body.ticket_id}/resolve`),
      ]);
      assert.equal(x.status, 200);
      assert.equal(y.status, 200);
      await waitFor(async () => (await emailsTo(o.email)).length === 2, { what: "resolved email" });
      await sleep(800);
      const mails = await emailsTo(o.email);
      assert.equal(mails.length, 2);
      assert.match(mails[1].subject, /resolved/);
    } finally {
      await second.stop();
    }
  } finally {
    proxy.rule = () => "pass";
    removeDb(db);
  }
});
