// Starts the help desk:  PORT=3000 STORE_API_URL=http://localhost:4000 node src/server.js
const config = require("./config");
const { open } = require("./db");
const { createRateLimiter } = require("./rateLimit");
const { createStoreApi } = require("./storeApi");
const { createOrders } = require("./orders");
const { createTickets } = require("./tickets");
const { createOutbox } = require("./outbox");
const { createAuth } = require("./auth");
const { createApp } = require("./app");

const log = (msg) => console.log(new Date().toISOString(), msg);

const db = open(config.dbFile);
const limiter = createRateLimiter(db, config.rate);
const store = createStoreApi({ db, limiter, baseUrl: config.storeApiUrl, apiKey: config.storeApiKey, attemptTimeoutMs: config.attemptTimeoutMs });
const orders = createOrders({ db, store });
const tickets = createTickets({ db, dedupeMs: config.ticketDedupeMs });
const outbox = createOutbox({ db, store, limiter, log, ...config.outbox });
const auth = createAuth({ db, team: config.team, sessionSecret: config.sessionSecret, secureCookies: config.secureCookies });
const app = createApp({ config, orders, tickets, outbox, auth, db });

const server = app.listen(config.port, () => {
  log(`help desk on http://localhost:${config.port} (store API ${config.storeApiUrl}, database ${config.dbFile})`);
  outbox.start();
});

// cached orders hold names and addresses; keep them no longer than needed
setInterval(() => orders.pruneOlderThan(config.verifyCacheMs), 3600_000).unref();

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: finishing requests and the email being sent, then stopping`);
  setTimeout(() => process.exit(1), 15_000).unref();
  await Promise.all([new Promise((resolve) => server.close(resolve)), outbox.stop()]);
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
