const ErrorLog = require("../models/ErrorLog");

// Simple in-memory limiter. On a serverless host each running copy keeps its own counts, so this is a
// safety net against abuse, not an exact quota.
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return (forwarded ? String(forwarded).split(",")[0].trim() : req.ip) || "unknown";
}

function limiter({ windowMs, max, key = (req) => clientIp(req), message = "Too many requests. Please slow down." }) {
  const hits = new Map();
  return function (req, res, next) {
    const now = Date.now();
    const k = key(req);
    const entry = hits.get(k);
    if (!entry || now > entry.resetAt) hits.set(k, { count: 1, resetAt: now + windowMs });
    else if (++entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, message, code: "rate_limited" });
    }
    if (hits.size > 5000) for (const [id, e] of hits) if (now > e.resetAt) hits.delete(id);
    next();
  };
}

/** Counts only FAILED logins per address+email, so real farmers who type it right are never blocked. */
function loginGuard({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map();
  const keyOf = (req) => `${clientIp(req)}|${String((req.body && req.body.email) || "").toLowerCase()}`;
  return {
    check(req, res, next) {
      const e = fails.get(keyOf(req));
      if (e && Date.now() < e.resetAt && e.count >= max) {
        res.set("Retry-After", String(Math.ceil((e.resetAt - Date.now()) / 1000)));
        return res.status(429).json({ success: false, message: "Too many wrong attempts. Please wait 15 minutes, or use “Forgot password”.", code: "rate_limited" });
      }
      res.on("finish", () => {
        const k = keyOf(req);
        if (res.statusCode === 401) { const cur = fails.get(k); if (!cur || Date.now() > cur.resetAt) fails.set(k, { count: 1, resetAt: Date.now() + windowMs }); else cur.count++; }
        else if (res.statusCode < 400) fails.delete(k);
      });
      next();
    },
  };
}

/** Records server errors (500+) and very slow requests so the admin can see problems early. */
function requestLogger(req, res, next) {
  const started = Date.now();
  let lastMessage = "";
  const json = res.json.bind(res);
  res.json = (body) => { if (body && body.message) lastMessage = String(body.message).slice(0, 160); return json(body); };
  res.on("finish", () => {
    const ms = Date.now() - started;
    if (res.statusCode >= 500 || ms > 4000) {
      ErrorLog.create({ method: req.method, path: String(req.originalUrl || req.url).split("?")[0].slice(0, 120), status: res.statusCode, ms, message: lastMessage, kind: res.statusCode >= 500 ? "error" : "slow" }).catch(() => {});
    }
  });
  next();
}

module.exports = { limiter, loginGuard, requestLogger, clientIp };
