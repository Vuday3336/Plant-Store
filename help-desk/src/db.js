// SQLite through Node's built-in driver. Two copies of the app can open the
// same file: WAL mode lets readers and one writer work at once, and every
// read-then-write runs inside BEGIN IMMEDIATE so only one copy does it at a time.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number   TEXT NOT NULL,
  contact        TEXT NOT NULL,          -- what the customer typed, cleaned up
  customer_name  TEXT,
  customer_email TEXT NOT NULL,          -- emails go to the address on the order
  message        TEXT NOT NULL,
  message_key    TEXT NOT NULL,          -- the message with case and spaces ignored
  request_id     TEXT UNIQUE,            -- sent by the page so a retry finds the same ticket
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     INTEGER NOT NULL,
  resolved_at    INTEGER,
  resolved_by    TEXT
);
CREATE INDEX IF NOT EXISTS tickets_same_message ON tickets (order_number, message_key, created_at);
CREATE INDEX IF NOT EXISTS tickets_newest ON tickets (created_at DESC, id DESC);

-- outbox: an email is written here in the same transaction as the change
-- that needs it, and the worker sends it later
CREATE TABLE IF NOT EXISTS emails (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id),
  kind            TEXT NOT NULL,         -- confirmation | resolved
  idempotency_key TEXT NOT NULL UNIQUE,
  to_addr         TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  locked_until    INTEGER NOT NULL DEFAULT 0,
  locked_by       TEXT,
  last_error      TEXT,
  store_email_id  TEXT,
  created_at      INTEGER NOT NULL,
  sent_at         INTEGER,
  UNIQUE (ticket_id, kind)
);
CREATE INDEX IF NOT EXISTS emails_due ON emails (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS order_cache (
  order_number TEXT PRIMARY KEY,
  data         TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL
);

-- one row per request we made to the store API, for the shared rate limit
CREATE TABLE IF NOT EXISTS store_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS store_calls_at ON store_calls (at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function open(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000");
  // switching a new file to WAL ignores busy_timeout, so when two copies start
  // on a fresh database at the same moment one of them has to wait and retry
  whenNotBusy(() => db.exec("PRAGMA journal_mode = WAL"));
  db.exec("PRAGMA synchronous = FULL"); // a ticket we said 201 to survives a power cut
  db.exec("PRAGMA foreign_keys = ON");

  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version < SCHEMA_VERSION) {
    whenNotBusy(() => immediate(db, () => {
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }));
  }
  // made once per database; part of every email idempotency key so a wiped
  // database can never reuse a key the store API already remembers
  immediate(db, () => {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('db_id', ?)").run(crypto.randomBytes(6).toString("hex"));
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)").run(crypto.randomBytes(32).toString("hex"));
  });
  return db;
}

function whenNotBusy(fn) {
  const until = Date.now() + 10_000;
  for (;;) {
    try {
      return fn();
    } catch (err) {
      if (!/locked|busy/i.test(err.message) || Date.now() > until) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // short blocking pause, only at start-up
    }
  }
}

// Runs fn inside BEGIN IMMEDIATE: takes the write lock up front, so two copies
// of the app doing check-then-insert cannot both see "not there yet".
function immediate(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already rolled back
    }
    throw err;
  }
}

function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

module.exports = { open, immediate, getSetting, setSetting };
