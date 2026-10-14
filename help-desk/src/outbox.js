// Sends the emails waiting in the emails table.
//
// Every copy of the app runs this loop. A copy claims one email at a time with
// a conditional UPDATE (only one copy can win), sends it with the email's
// fixed Idempotency-Key, then marks it sent. If the copy dies after sending
// but before marking, the claim runs out and another copy sends again with the
// same key, and the store API does not send a second email.
const crypto = require("crypto");
const { immediate } = require("./db");

function createOutbox({ db, store, limiter, pollMs, emailTimeoutMs, lockMs, retryBaseMs, retryMaxMs, log = () => {} }) {
  const worker = crypto.randomBytes(4).toString("hex") + "-" + process.pid;

  const nextDue = db.prepare(
    "SELECT id FROM emails WHERE status = 'pending' AND next_attempt_at <= ? AND locked_until <= ? ORDER BY next_attempt_at, id LIMIT 1"
  );
  const claim = db.prepare(
    "UPDATE emails SET locked_until = ?, locked_by = ? WHERE id = ? AND status = 'pending' AND locked_until <= ?"
  );
  const load = db.prepare("SELECT * FROM emails WHERE id = ?");
  const markSent = db.prepare(
    "UPDATE emails SET status = 'sent', sent_at = ?, store_email_id = ?, attempts = attempts + 1, last_error = NULL, locked_until = 0 WHERE id = ? AND status = 'pending'"
  );
  const markFailed = db.prepare(
    "UPDATE emails SET status = 'failed', attempts = attempts + 1, last_error = ?, locked_until = 0 WHERE id = ?"
  );
  const later = db.prepare(
    "UPDATE emails SET next_attempt_at = ?, attempts = attempts + ?, last_error = ?, locked_until = 0 WHERE id = ? AND status = 'pending'"
  );
  const waiting = db.prepare("SELECT COUNT(*) AS n FROM emails WHERE status = 'pending'");

  let timer = null;
  let running = false;
  let stopped = false;
  let current = null;

  function claimOne() {
    return immediate(db, () => {
      const now = Date.now();
      const row = nextDue.get(now, now);
      if (!row) return null;
      const info = claim.run(now + lockMs, worker, row.id, now);
      return info.changes === 1 ? load.get(row.id) : null;
    });
  }

  function backoff(attempts) {
    const ms = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(attempts, 10));
    return Math.round(ms * (0.75 + Math.random() * 0.5));
  }

  async function deliver(email) {
    const slot = limiter.take("email");
    if (!slot.ok) {
      // not an attempt; just come back when the rate limit has room
      later.run(Date.now() + slot.waitMs, 0, email.last_error, email.id);
      return false;
    }
    const result = await store.sendEmail(
      { to: email.to_addr, subject: email.subject, body: email.body, idempotencyKey: email.idempotency_key },
      emailTimeoutMs
    );
    if (result.ok) {
      markSent.run(Date.now(), result.id, email.id);
      log(`email ${email.id} (${email.kind}, ticket ${email.ticket_id}) sent as ${result.id}`);
      return true;
    }
    if (result.permanent) {
      markFailed.run(result.error, email.id);
      log(`email ${email.id} failed for good: ${result.error}`);
      return true;
    }
    const wait = result.retryAfterMs || backoff(email.attempts);
    later.run(Date.now() + wait, 1, result.error, email.id);
    log(`email ${email.id} not sent (${result.error}), next try in ${wait} ms`);
    return false;
  }

  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      for (let i = 0; i < 20 && !stopped; i++) {
        const email = claimOne();
        if (!email) break;
        current = deliver(email);
        const keepGoing = await current;
        current = null;
        if (!keepGoing) break; // store is struggling; give it a moment
      }
    } catch (err) {
      log("outbox error: " + err.message);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      stopped = false;
      timer = setInterval(tick, pollMs);
      timer.unref();
      tick();
    },
    nudge() {
      setImmediate(tick);
    },
    // wait for an email that is being sent right now, then stop
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (current) await current.catch(() => {});
    },
    pending() {
      return waiting.get().n;
    },
  };
}

module.exports = { createOutbox };
