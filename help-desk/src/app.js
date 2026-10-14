const path = require("path");
const express = require("express");
const { StoreUnavailable } = require("./storeApi");
const { cleanOrderNumber, cleanContact, contactMatches } = require("./orders");

const NO_MATCH = {
  error: "no_match",
  message: "We could not find an order with that number and phone or email. Please check both and try again.",
};
const UNAVAILABLE = {
  error: "store_unavailable",
  message: "We cannot reach our order system right now. Nothing you typed is lost. Please try again in a minute.",
};

// in-memory, per copy of the app: stops one visitor from spending the whole
// store API rate limit by guessing
function perIpLimit(perMinute) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [ip, list] of hits) {
      const recent = list.filter((t) => t > cutoff);
      if (recent.length) hits.set(ip, recent);
      else hits.delete(ip);
    }
  }, 60_000).unref();

  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < 60_000);
    if (list.length >= perMinute) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ error: "too_many_requests", message: "Too many tries from your connection. Please wait a minute." });
    }
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

function createApp({ config, orders, tickets, outbox, auth, db }) {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (req, res) => res.json({ ok: true }));

  const limit = perIpLimit(config.lookupsPerMinutePerIp);

  // Finds the order and checks the contact. Sends 403/503 itself and returns
  // null in that case. Wrong contact and unknown order get the same answer,
  // so nobody can tell which order numbers exist.
  async function verifiedOrder(req, res, maxAgeMs) {
    const orderNumber = cleanOrderNumber(req.body && req.body.order_number);
    const contact = cleanContact(req.body && req.body.contact);
    if (!orderNumber || !contact) {
      res.status(403).json(NO_MATCH);
      return null;
    }
    let order;
    try {
      order = await orders.find(orderNumber, { maxAgeMs, deadline: req.startedAt + config.lookupDeadlineMs });
    } catch (err) {
      if (!(err instanceof StoreUnavailable)) throw err;
      res.set("Retry-After", "30").status(503).json(UNAVAILABLE);
      return null;
    }
    if (!order || !contactMatches(order, contact)) {
      res.status(403).json(NO_MATCH);
      return null;
    }
    return { order, orderNumber, contact };
  }

  app.use("/api", (req, res, next) => {
    req.startedAt = Date.now();
    next();
  });

  app.post("/api/lookup", limit, async (req, res, next) => {
    try {
      const found = await verifiedOrder(req, res, config.orderCacheMs);
      if (!found) return;
      res.json({ status: found.order.status, expected_delivery: found.order.expected_delivery });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/tickets", limit, async (req, res, next) => {
    try {
      const message = req.body && req.body.message;
      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "message_required", message: "Please tell us what went wrong." });
      }
      if (message.length > 2000) {
        return res.status(400).json({ error: "message_too_long", message: "Please keep the message under 2000 characters." });
      }
      const requestId = typeof req.body.request_id === "string" && /^[\w-]{8,64}$/.test(req.body.request_id) ? req.body.request_id : null;

      const found = await verifiedOrder(req, res, config.verifyCacheMs);
      if (!found) return;
      const { ticket, created } = tickets.create({
        order: found.order,
        orderNumber: found.orderNumber,
        contact: found.contact.value,
        message,
        requestId,
      });
      if (created) outbox.nudge();
      res.status(201).json({ ticket_id: ticket.id, duplicate: !created });
    } catch (err) {
      next(err);
    }
  });

  // ---- team
  app.post("/api/team/login", auth.login);
  app.post("/api/team/logout", auth.logout);
  app.get("/api/team/me", auth.requireTeam, (req, res) => res.json({ user: req.teamUser }));

  app.get("/api/team/tickets", auth.requireTeam, (req, res) => {
    const setting = (k) => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k);
      return row ? row.value : null;
    };
    res.json({
      tickets: tickets.list(),
      store_api: {
        last_ok: Number(setting("store_last_ok")) || null,
        last_error: Number(setting("store_last_error")) || null,
        last_error_detail: setting("store_last_error_detail"),
        emails_waiting: outbox.pending(),
      },
    });
  });

  app.get("/api/team/tickets/:id", auth.requireTeam, (req, res) => {
    const ticket = tickets.get(Number(req.params.id));
    if (!ticket) return res.status(404).json({ error: "not_found", message: "No such ticket." });
    res.json(ticket);
  });

  app.post("/api/team/tickets/:id/resolve", auth.requireTeam, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "not_found", message: "No such ticket." });
    const result = tickets.resolve(id, req.teamUser);
    if (!result) return res.status(404).json({ error: "not_found", message: "No such ticket." });
    if (result.changed) outbox.nudge();
    res.json({ ...tickets.get(id), already_resolved: !result.changed });
  });

  // ---- pages
  const pub = path.join(__dirname, "..", "public");
  app.get("/", (req, res) => res.sendFile(path.join(pub, "index.html")));
  app.get("/team", (req, res) => res.sendFile(path.join(pub, "team.html")));
  // no long cache: browsers revalidate with the ETag, so a new release shows at once
  app.use(express.static(pub, { index: false, maxAge: 0 }));

  app.use("/api", (req, res) => res.status(404).json({ error: "not_found", message: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "bad_json", message: "The request was not valid JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "too_large", message: "The request is too large." });
    console.error(err);
    res.status(500).json({ error: "server_error", message: "Something went wrong on our side. Please try again." });
  });

  return app;
}

module.exports = { createApp };
