// Talks to the store API. Every request takes a rate-limit slot first and has
// its own timeout, so nothing here can hang.
const { immediate, setSetting } = require("./db");

class StoreUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreUnavailable";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createStoreApi({ db, limiter, baseUrl, apiKey, attemptTimeoutMs }) {
  function noteHealth(ok, detail) {
    try {
      immediate(db, () => {
        setSetting(db, ok ? "store_last_ok" : "store_last_error", Date.now());
        if (!ok) setSetting(db, "store_last_error_detail", detail);
      });
    } catch {
      // only used for the team page banner; never worth failing a request over
    }
  }

  // One HTTP request. Resolves { status, body, retryAfterMs } or throws on
  // timeout / connection failure.
  async function request(method, path, { body, headers, timeoutMs }) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { "x-api-key": apiKey, ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    return { status: res.status, body: data, retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0 };
  }

  // GET /orders/:number with retries until `deadline` (ms timestamp).
  // Returns the order, null when the store says there is no such order, or
  // throws StoreUnavailable when it cannot get an answer in time.
  // At most three tries: enough to get past one slow or failed answer, without
  // spending the shared rate limit on a store API that is down.
  async function getOrder(orderNumber, deadline) {
    let lastProblem = "no answer";
    let tries = 0;
    for (;;) {
      const left = deadline - Date.now();
      if (left < 300 || tries >= 3) throw new StoreUnavailable(lastProblem);

      const slot = limiter.take("lookup");
      if (!slot.ok) {
        if (slot.waitMs > left - 300) throw new StoreUnavailable("busy: rate limit");
        await sleep(slot.waitMs);
        continue;
      }

      tries++;
      let res;
      try {
        res = await request("GET", "/orders/" + encodeURIComponent(orderNumber), {
          timeoutMs: Math.min(attemptTimeoutMs, left - 100),
        });
      } catch (err) {
        lastProblem = err.name === "TimeoutError" ? "timeout" : "cannot connect";
        noteHealth(false, lastProblem);
        if (lastProblem !== "timeout") await pause(deadline);
        continue;
      }

      if (res.status === 200 && res.body) {
        noteHealth(true);
        return res.body;
      }
      if (res.status === 404) {
        noteHealth(true);
        return null;
      }
      if (res.status === 429) {
        limiter.blockFor(res.retryAfterMs || 5000);
        lastProblem = "rate limit";
        noteHealth(false, "429 rate limit");
        tries--; // a 429 is not the store failing; the slot wait above handles it
        continue;
      }
      lastProblem = "status " + res.status;
      noteHealth(false, lastProblem);
      await pause(deadline);
    }
  }

  // a short gap between tries, never past the deadline
  function pause(deadline) {
    return sleep(Math.min(300, Math.max(0, deadline - Date.now() - 300)));
  }

  // POST /emails once. The caller (the outbox) decides about retries.
  // Returns { ok: true, id } | { ok: false, retryAfterMs?, permanent?, error }
  async function sendEmail({ to, subject, body, idempotencyKey }, timeoutMs) {
    let res;
    try {
      res = await request("POST", "/emails", {
        body: { to, subject, body },
        headers: { "idempotency-key": idempotencyKey },
        timeoutMs,
      });
    } catch (err) {
      const error = err.name === "TimeoutError" ? "timeout (it may still have been sent; the retry uses the same key)" : "cannot connect";
      noteHealth(false, err.name === "TimeoutError" ? "timeout" : "cannot connect");
      return { ok: false, error };
    }
    if (res.status === 200 && res.body && res.body.id) {
      noteHealth(true);
      return { ok: true, id: res.body.id };
    }
    if (res.status === 429) {
      limiter.blockFor(res.retryAfterMs || 5000);
      noteHealth(false, "429 rate limit");
      return { ok: false, retryAfterMs: res.retryAfterMs || 5000, error: "rate limit" };
    }
    noteHealth(false, "status " + res.status);
    // 400 means the email itself is wrong; sending it again will not help
    return { ok: false, permanent: res.status === 400, error: "status " + res.status + (res.body && res.body.error ? ": " + res.body.error : "") };
  }

  return { getOrder, sendEmail };
}

module.exports = { createStoreApi, StoreUnavailable };
