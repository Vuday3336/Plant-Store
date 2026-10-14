// Requirement 1: nobody sees order details without the right phone or email.
const test = require("node:test");
const assert = require("node:assert");
const { startStore, startProxy, startApp, tempDb, removeDb, waitFor, sleep } = require("./helpers");

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

const ORDER_FIELDS = ["name", "phone", "email", "items", "total", "placed_at", "order_number", "status", "expected_delivery"];

function assertNoOrderData(body) {
  for (const f of ORDER_FIELDS) assert.ok(!(f in body), `403 body must not contain ${f}`);
}

test("the right phone or email shows the status and delivery date, and nothing else", async () => {
  const o = orders[0];
  const spaced = "+91 " + o.phone.slice(0, 5) + " " + o.phone.slice(5);
  for (const contact of [o.phone, spaced, o.email, o.email.toUpperCase()]) {
    const r = await app.post("/api/lookup", { order_number: o.order_number.toLowerCase(), contact });
    assert.equal(r.status, 200, `contact "${contact}"`);
    assert.deepEqual(r.body, { status: o.status, expected_delivery: o.expected_delivery });
  }
});

test("a wrong phone, a wrong email or another customer's details get 403 and no order data", async () => {
  const [o, other] = orders;
  const tries = [
    { order_number: o.order_number, contact: "9999999999" },
    { order_number: o.order_number, contact: "someone@example.com" },
    { order_number: o.order_number, contact: other.phone },
    { order_number: o.order_number, contact: other.email },
    { order_number: o.order_number, contact: o.phone.slice(0, 9) }, // part of the number
    { order_number: o.order_number, contact: "" },
    { order_number: o.order_number },
    { order_number: o.order_number, contact: { $ne: "" } },
  ];
  for (const body of tries) {
    const r = await app.post("/api/lookup", body);
    assert.equal(r.status, 403, JSON.stringify(body));
    assertNoOrderData(r.body);
  }
});

test("an order that does not exist looks the same as a wrong contact", async () => {
  const wrong = await app.post("/api/lookup", { order_number: orders[0].order_number, contact: "9999999999" });
  const missing = await app.post("/api/lookup", { order_number: "ORD-9999", contact: "9999999999" });
  assert.equal(missing.status, 403);
  assert.deepEqual(missing.body, wrong.body);
});

test("a ticket with the wrong contact is refused: no ticket, no email", async () => {
  const o = orders[1];
  const r = await app.post("/api/tickets", { order_number: o.order_number, contact: "9999999999", message: "where is it" });
  assert.equal(r.status, 403);
  assertNoOrderData(r.body);

  await sleep(800);
  assert.equal((await store.emails()).length, 0);
  await app.login();
  const list = await app.get("/api/team/tickets");
  assert.equal(list.body.tickets.length, 0);
});

test("the team pages need the team login", async () => {
  const fresh = await startApp({ storeUrl: proxy.url, dbFile: db });
  try {
    assert.equal((await fresh.get("/api/team/tickets")).status, 401);
    assert.equal((await fresh.post("/api/team/tickets/1/resolve")).status, 401);
    const bad = await fresh.post("/api/team/login", { username: "team", password: "wrong" });
    assert.equal(bad.status, 401);
    assert.equal((await fresh.get("/api/team/tickets")).status, 401);
  } finally {
    await fresh.stop();
  }
  await waitFor(() => true);
});
