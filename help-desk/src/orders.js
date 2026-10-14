// Finding an order and checking the customer's phone or email against it.
// Orders are cached for a short time: it saves store API calls (the rate
// limit) and lets a customer who just looked up their order report a problem
// even if the store API stops answering in between.

// "ord-1001 " -> "ORD-1001". Anything that is not a plausible order number is
// rejected before it reaches the store API.
function cleanOrderNumber(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(v) ? v : null;
}

// Indian mobile numbers are typed many ways: +91 98765 43210, 098765-43210 ...
// Compare the last ten digits.
function phoneDigits(value) {
  const d = String(value || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

function cleanContact(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 200) return null;
  if (v.includes("@")) return { type: "email", value: v.toLowerCase() };
  const phone = phoneDigits(v);
  return phone ? { type: "phone", value: phone } : null;
}

function contactMatches(order, contact) {
  if (!order || !contact) return false;
  if (contact.type === "email") return String(order.email || "").trim().toLowerCase() === contact.value;
  return phoneDigits(order.phone) === contact.value;
}

function createOrders({ db, store }) {
  const read = db.prepare("SELECT data, fetched_at FROM order_cache WHERE order_number = ?");
  const write = db.prepare(
    "INSERT INTO order_cache (order_number, data, fetched_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(order_number) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at"
  );
  const prune = db.prepare("DELETE FROM order_cache WHERE fetched_at < ?");

  // maxAgeMs: how old a cached copy may be. Returns the order or null;
  // throws StoreUnavailable if the store API has to be asked and cannot answer.
  async function find(orderNumber, { maxAgeMs, deadline }) {
    const cached = read.get(orderNumber);
    if (cached && Date.now() - cached.fetched_at <= maxAgeMs) return JSON.parse(cached.data);

    const order = await store.getOrder(orderNumber, deadline);
    if (order) write.run(orderNumber, JSON.stringify(order), Date.now());
    return order;
  }

  function pruneOlderThan(ms) {
    prune.run(Date.now() - ms);
  }

  return { find, pruneOlderThan };
}

module.exports = { createOrders, cleanOrderNumber, cleanContact, contactMatches, phoneDigits };
