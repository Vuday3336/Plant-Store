// Every setting comes from the environment. Only PORT and STORE_API_URL are
// needed; the rest have defaults that suit the task's store-api.js.
const path = require("path");

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
}

const storeLimit = num("STORE_API_LIMIT", 60); // requests a minute the store API allows

module.exports = {
  port: num("PORT", 3000),
  storeApiUrl: (process.env.STORE_API_URL || "http://localhost:4000").replace(/\/+$/, ""),
  storeApiKey: process.env.STORE_API_KEY || "test-key",
  dbFile: process.env.DB_FILE || path.join(__dirname, "..", "data", "helpdesk.db"),

  team: {
    user: process.env.TEAM_USER || "team",
    password: process.env.TEAM_PASSWORD || "plants-2026",
    sessionHours: num("TEAM_SESSION_HOURS", 12),
  },
  sessionSecret: process.env.SESSION_SECRET || "", // empty: one is made and kept in the database
  secureCookies: process.env.COOKIE_SECURE === "1",
  trustProxy: process.env.TRUST_PROXY === "1",

  // Our share of the store API's limit, counted across every copy of the app.
  // We stay under it on purpose: other things (people checking /emails, clock
  // drift between copies) also use the same limit.
  rate: {
    windowMs: 60_000,
    total: Math.max(1, Math.floor(storeLimit * 0.85)),
    // emails can use only part of it, so customers looking up orders always get a turn
    emails: Math.max(1, Math.floor(storeLimit * 0.6)),
  },

  // A customer-facing request gives up on the store API after this long and
  // answers 503. Must stay under 10 seconds.
  lookupDeadlineMs: num("LOOKUP_DEADLINE_MS", 9000),
  attemptTimeoutMs: num("STORE_ATTEMPT_TIMEOUT_MS", 4000),
  orderCacheMs: num("ORDER_CACHE_MS", 30_000), // how fresh a status must be to show it
  verifyCacheMs: num("VERIFY_CACHE_MS", 24 * 3600_000), // phone/email on an order do not change

  ticketDedupeMs: num("TICKET_DEDUPE_MS", 60_000),
  lookupsPerMinutePerIp: num("LOOKUP_LIMIT_PER_MIN", 20),

  outbox: {
    pollMs: num("OUTBOX_POLL_MS", 1000),
    emailTimeoutMs: num("EMAIL_TIMEOUT_MS", 10_000),
    // a claimed email is left alone this long; if the copy that claimed it
    // dies, another copy picks it up afterwards
    lockMs: num("EMAIL_LOCK_MS", num("EMAIL_TIMEOUT_MS", 10_000) + 20_000),
    retryBaseMs: num("EMAIL_RETRY_BASE_MS", 2000),
    retryMaxMs: num("EMAIL_RETRY_MAX_MS", 60_000),
  },
};
