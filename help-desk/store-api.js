// Fake store API for the developer task. Run:  node store-api.js
// Do not change this file. We test your app against our own copy.
//
// Every request needs the header   x-api-key: test-key
//
// GET  /orders/ORD-1001   one order: order_number, name, phone, email, status,
//                         items, total, placed_at, expected_delivery
// GET  /orders            all orders (for your own testing)
// POST /emails            body {to, subject, body}  -> {id}
//                         Optional header Idempotency-Key: if you send the same
//                         key again within 24 hours, no second email is sent and
//                         you get the first answer back.
// GET  /emails            every email that was really sent
// POST /reset             clears sent emails and counters
//
// How it behaves, like most real APIs:
//  - Limit of 60 requests a minute. Over that you get 429 with a Retry-After header.
//  - About 1 request in 10 is slow (5 to 9 seconds).
//  - About 1 request in 20 fails with 500. A failed email was not sent.
//  - A slow email request was still sent, even if you stopped waiting for it.
//
// Settings (env): PORT=4000  SLOW=0.1  FAIL=0.05  LIMIT=60

const http = require("http");

const PORT = Number(process.env.PORT || 4000);
const SLOW = Number(process.env.SLOW ?? 0.1);
const FAIL = Number(process.env.FAIL ?? 0.05);
const LIMIT = Number(process.env.LIMIT || 60);

const names = ["Asha Rao", "Vikram Nair", "Meera Shah", "Rohan Das", "Kavya Iyer", "Imran Khan", "Neha Jain", "Arjun Pillai", "Sana Mirza", "Dev Malhotra"];
const products = ["Tomato seeds", "Clay pot 8 inch", "Potting mix 5 kg", "Neem oil 250 ml", "Grow bag set", "Watering can", "Basil seeds", "Vermicompost 2 kg"];
const statuses = ["placed", "packed", "shipped", "out for delivery", "delivered", "cancelled"];

const orders = {};
for (let i = 1; i <= 60; i++) {
  const name = names[i % names.length];
  const number = "ORD-" + (1000 + i);
  const placed = new Date(Date.UTC(2026, 8, 1 + (i % 28), 4 + (i % 12), (i * 7) % 60));
  const count = 1 + (i % 3);
  const items = [];
  for (let j = 0; j < count; j++) items.push({ name: products[(i + j * 3) % products.length], qty: 1 + ((i + j) % 2) });
  orders[number] = {
    order_number: number,
    name,
    phone: "90000" + String(10000 + i * 137).slice(-5),
    email: name.toLowerCase().replace(" ", ".") + i + "@example.com",
    status: statuses[i % statuses.length],
    items,
    total: 199 + ((i * 53) % 1400),
    placed_at: placed.toISOString(),
    expected_delivery: new Date(placed.getTime() + 5 * 86400000).toISOString().slice(0, 10),
  };
}

let emails = [];
let keys = {};
let calls = [];

function send(res, code, data, headers) {
  res.writeHead(code, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

http
  .createServer(async (req, res) => {
    const path = req.url.split("?")[0];

    if (req.headers["x-api-key"] !== "test-key") return send(res, 401, { error: "missing or wrong x-api-key" });

    if (req.method === "POST" && path === "/reset") {
      emails = [];
      keys = {};
      calls = [];
      return send(res, 200, { ok: true });
    }

    const now = Date.now();
    calls = calls.filter((t) => now - t < 60000);
    if (calls.length >= LIMIT) {
      const retry = Math.ceil((60000 - (now - calls[0])) / 1000);
      return send(res, 429, { error: "rate limit reached" }, { "retry-after": String(retry) });
    }
    calls.push(now);

    const slow = Math.random() < SLOW;
    const fail = !slow && Math.random() < FAIL;

    if (req.method === "GET" && path === "/emails") return send(res, 200, emails);
    if (req.method === "GET" && path === "/orders") return send(res, 200, Object.values(orders));

    if (req.method === "GET" && path.startsWith("/orders/")) {
      if (slow) await wait(5000 + Math.random() * 4000);
      if (fail) return send(res, 500, { error: "something went wrong" });
      const order = orders[decodeURIComponent(path.slice(8)).toUpperCase()];
      return order ? send(res, 200, order) : send(res, 404, { error: "order not found" });
    }

    if (req.method === "POST" && path === "/emails") {
      const body = await readBody(req);
      if (!body || !body.to || !body.subject || !body.body) return send(res, 400, { error: "to, subject and body are required" });
      if (fail) return send(res, 500, { error: "something went wrong" });
      const key = req.headers["idempotency-key"];
      let email = key && keys[key];
      if (!email) {
        email = { id: "em_" + (emails.length + 1), to: body.to, subject: body.subject, body: body.body, key: key || null, sent_at: new Date().toISOString() };
        emails.push(email);
        if (key) keys[key] = email;
      }
      if (slow) await wait(8000 + Math.random() * 4000);
      return send(res, 200, { id: email.id });
    }

    send(res, 404, { error: "not found" });
  })
  .listen(PORT, () => {
    console.log("Store API on http://localhost:" + PORT);
    console.log("Try: curl -H 'x-api-key: test-key' http://localhost:" + PORT + "/orders/ORD-1001");
  });
