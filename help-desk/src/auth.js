// One fixed team user. The session is a signed cookie, so any copy of the app
// can check it: the signing secret is SESSION_SECRET, or one kept in the
// shared database.
const crypto = require("crypto");
const { getSetting } = require("./db");

const COOKIE = "hd_team";

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function createAuth({ db, team, sessionSecret, secureCookies }) {
  const secret = sessionSecret || getSetting(db, "session_secret");
  const failures = new Map(); // ip -> [timestamps]

  function sign(payload) {
    const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const mac = crypto.createHmac("sha256", secret).update(data).digest("base64url");
    return data + "." + mac;
  }

  function verify(token) {
    if (!token || typeof token !== "string") return null;
    const [data, mac] = token.split(".");
    if (!data || !mac) return null;
    const expected = crypto.createHmac("sha256", secret).update(data).digest("base64url");
    if (!safeEqual(mac, expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(data, "base64url").toString());
      return payload.exp > Date.now() ? payload : null;
    } catch {
      return null;
    }
  }

  function tooManyFailures(ip) {
    const now = Date.now();
    const recent = (failures.get(ip) || []).filter((t) => now - t < 15 * 60_000);
    failures.set(ip, recent);
    return recent.length >= 10;
  }

  function cookieFlags(req) {
    const secure = secureCookies || req.secure ? "; Secure" : "";
    return `; Path=/; HttpOnly; SameSite=Strict${secure}`;
  }

  // POST /api/team/login {username, password}
  function login(req, res) {
    const ip = req.ip;
    if (tooManyFailures(ip)) {
      return res.status(429).json({ error: "too_many_attempts", message: "Too many wrong passwords. Wait 15 minutes and try again." });
    }
    const { username, password } = req.body || {};
    const ok = safeEqual(username || "", team.user) & safeEqual(password || "", team.password);
    if (!ok) {
      failures.get(ip).push(Date.now());
      return res.status(401).json({ error: "wrong_login", message: "That username and password do not match." });
    }
    const exp = Date.now() + team.sessionHours * 3600_000;
    res.setHeader("Set-Cookie", `${COOKIE}=${sign({ u: team.user, exp })}; Max-Age=${team.sessionHours * 3600}${cookieFlags(req)}`);
    res.json({ user: team.user });
  }

  function logout(req, res) {
    res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0${cookieFlags(req)}`);
    res.json({ ok: true });
  }

  function requireTeam(req, res, next) {
    const session = verify(readCookie(req, COOKIE));
    if (!session) return res.status(401).json({ error: "login_needed", message: "Please log in." });
    req.teamUser = session.u;
    next();
  }

  return { login, logout, requireTeam };
}

module.exports = { createAuth };
