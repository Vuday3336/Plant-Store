// Requirement 5: if the store API cannot answer, we answer 503 within 10 seconds.
const test = require("node:test");
const assert = require("node:assert");
const { startStore, startProxy, startApp, tempDb, removeDb } = require("./helpers");

let store, proxy, app, db, orders;

test.before(async () => {
  store = await startStore();
  proxy = await startProxy(store.url);
  db = tempDb();
  app = await startApp({ storeUrl: proxy.url, dbFile: db });
  orders = await store.orders();
});
test.after(async () => {
  await app.stop();
  proxy.stop();
  store.stop();
  removeDb(db);
});

async function timed(fn) {
  const start = Date.now();
  const r = await fn();
  return { ...r, ms: Date.now() - start };
}

for (const rule of ["hang", "refuse", "error"]) {
  test(`store API ${rule === "hang" ? "never answers" : rule === "refuse" ? "is stopped" : "keeps failing"}: 503 in under 10 s`, async () => {
    proxy.rule = () => rule;
    try {
      const o = orders[{ hang: 10, refuse: 11, error: 12 }[rule]];
      const lookup = await timed(() => app.post("/api/lookup", { order_number: o.order_number, contact: o.phone }));
      assert.equal(lookup.status, 503);
      assert.ok(lookup.ms < 10_000, `took ${lookup.ms} ms`);
      assert.equal(lookup.body.error, "store_unavailable");

      // a ticket for an order we have not seen yet cannot be checked, so it is a 503 too
      const ticket = await timed(() => app.post("/api/tickets", { order_number: o.order_number, contact: o.phone, message: "hi" }));
      assert.equal(ticket.status, 503);
      assert.ok(ticket.ms < 10_000, `took ${ticket.ms} ms`);
    } finally {
      proxy.rule = () => "pass";
    }
  });
}

test("one slow answer is retried within the 10 s", async () => {
  const o = orders[13];
  let first = true;
  proxy.rule = (method, path) => {
    if (path.startsWith("/orders/") && first) {
      first = false;
      return "hang";
    }
    return "pass";
  };
  try {
    const r = await timed(() => app.post("/api/lookup", { order_number: o.order_number, contact: o.phone }));
    assert.equal(r.status, 200);
    assert.ok(r.ms < 10_000);
  } finally {
    proxy.rule = () => "pass";
  }
});
