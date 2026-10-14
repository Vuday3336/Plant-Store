// A sliding one-minute window shared by every copy of the app through the
// database. Before each store API request we take a slot; if the window is
// full we get told how long to wait instead.
const { immediate, getSetting, setSetting } = require("./db");

function createRateLimiter(db, { windowMs, total, emails }) {
  const prune = db.prepare("DELETE FROM store_calls WHERE at <= ?");
  const count = db.prepare("SELECT COUNT(*) AS n FROM store_calls");
  const nth = db.prepare("SELECT at FROM store_calls ORDER BY at LIMIT 1 OFFSET ?");
  const insert = db.prepare("INSERT INTO store_calls (at) VALUES (?)");

  // kind: "lookup" (a person is waiting) or "email" (the background worker)
  function take(kind) {
    return immediate(db, () => {
      const now = Date.now();
      const blockedUntil = Number(getSetting(db, "store_blocked_until") || 0);
      if (blockedUntil > now) return { ok: false, waitMs: blockedUntil - now };

      prune.run(now - windowMs);
      const used = count.get().n;
      const limit = kind === "email" ? emails : total;
      if (used < limit) {
        insert.run(now);
        return { ok: true };
      }
      // the slot frees when the (used - limit + 1)th oldest call leaves the window
      const row = nth.get(used - limit);
      return { ok: false, waitMs: Math.max(50, row.at + windowMs - now + 50) };
    });
  }

  // the store API said 429: everybody stops until Retry-After has passed
  function blockFor(ms) {
    immediate(db, () => {
      const until = Date.now() + ms;
      const current = Number(getSetting(db, "store_blocked_until") || 0);
      if (until > current) setSetting(db, "store_blocked_until", until);
    });
  }

  return { take, blockFor };
}

module.exports = { createRateLimiter };
