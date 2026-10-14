// Test helpers: start the real store-api.js, a small proxy in front of it that
// can make it fail / hang / be slow on demand, and copies of our app.
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForLine(proc, text) {
  return new Promise((resolve, reject) => {
    let seen = "";
    const onData = (chunk) => {
      seen += chunk;
      if (seen.includes(text)) resolve();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", (c) => (seen += c));
    proc.on("exit", (code) => reject(new Error(`exited with ${code} before "${text}":\n${seen}`)));
  });
}

async function waitFor(check, { timeout = 15000, every = 100, what = "condition" } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error("timed out waiting for " + what);
    await sleep(every);
  }
}

// The real store API with no random slowness or failures, so the tests decide
// when things go wrong (through the proxy).
async function startStore({ limit = 60 } = {}) {
  const port = await freePort();
  const proc = spawn(process.execPath, ["store-api.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SLOW: "0", FAIL: "0", LIMIT: String(limit) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForLine(proc, "Store API on");
  const url = `http://127.0.0.1:${port}`;
  const get = async (p) => (await fetch(url + p, { headers: { "x-api-key": "test-key" } })).json();
  return {
    url,
    orders: () => get("/orders"),
    emails: () => get("/emails"),
    stop: () => proc.kill(),
  };
}

// Sits between our app and the store API.
//   proxy.rule = (method, path) => "pass" | "refuse" | "error" | "hang" | "slow" | "send-then-hang"
// "slow" forwards at once and answers after slowMs, like the real slow emails.
// "send-then-hang" forwards (so the email really goes out) and never answers.
// proxy.log has every request with the status the store API gave.
async function startProxy(target) {
  const port = await freePort();
  const proxy = { rule: () => "pass", slowMs: 3000, log: [], url: `http://127.0.0.1:${port}` };
  const held = new Set();

  function forward(req, body) {
    return new Promise((resolve, reject) => {
      const out = http.request(target + req.url, { method: req.method, headers: req.headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      });
      out.on("error", reject);
      out.end(body);
    });
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const rule = proxy.rule(req.method, req.url.split("?")[0]);
      const entry = { at: Date.now(), method: req.method, path: req.url, rule, status: null };
      proxy.log.push(entry);
      if (rule === "refuse") return req.socket.destroy();
      if (rule === "error") {
        entry.status = 500;
        res.writeHead(500, { "content-type": "application/json" });
        return res.end('{"error":"injected failure"}');
      }
      if (rule === "hang") {
        held.add(res);
        return;
      }
      const answer = await forward(req, body);
      entry.status = answer.status;
      if (rule === "send-then-hang") {
        held.add(res);
        return;
      }
      if (rule === "slow") await sleep(proxy.slowMs);
      if (res.destroyed) return;
      res.writeHead(answer.status, answer.headers);
      res.end(answer.body);
    });
  });
  await new Promise((r) => server.listen(port, r));
  proxy.stop = () => {
    for (const res of held) res.destroy();
    server.closeAllConnections();
    server.close();
  };
  return proxy;
}

function tempDb() {
  return path.join(os.tmpdir(), `helpdesk-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function removeDb(file) {
  for (const f of [file, file + "-wal", file + "-shm"]) fs.rmSync(f, { force: true });
}

// One copy of our app.
async function startApp({ storeUrl, dbFile, env = {} }) {
  const port = await freePort();
  const proc = spawn(process.execPath, ["src/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      STORE_API_URL: storeUrl,
      DB_FILE: dbFile,
      OUTBOX_POLL_MS: "200",
      EMAIL_TIMEOUT_MS: "1500",
      EMAIL_LOCK_MS: "3000",
      EMAIL_RETRY_BASE_MS: "200",
      EMAIL_RETRY_MAX_MS: "1000",
      LOOKUP_LIMIT_PER_MIN: "1000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (c) => (output += c));
  proc.stderr.on("data", (c) => (output += c));
  await waitForLine(proc, "help desk on");
  const url = `http://127.0.0.1:${port}`;
  let cookie = "";

  async function call(method, p, body) {
    const res = await fetch(url + p, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  return {
    url,
    proc,
    output: () => output,
    post: (p, body) => call("POST", p, body),
    get: (p) => call("GET", p),
    login: async () => {
      const r = await call("POST", "/api/team/login", { username: "team", password: "plants-2026" });
      if (r.status !== 200) throw new Error("login failed " + r.status);
    },
    // "kill" is the crash case: no clean shutdown, nothing gets finished
    stop: (signal = "SIGTERM") =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", resolve);
        proc.kill(signal);
      }),
  };
}

module.exports = { startStore, startProxy, startApp, tempDb, removeDb, waitFor, sleep };
