/* =========================================================
   Vercel serverless function — all /api/* routes.
   vercel.json rewrites /api/(.*) to this file.
   ========================================================= */
"use strict";

const billing = require("../lib/billing.js");
const auth = require("../lib/auth.js");

function send(res, code, obj, cookie) {
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const p = url.pathname;
  const secure = (req.headers["x-forwarded-proto"] || "https") === "https";

  /* Vercel parses JSON bodies for us, but be defensive. */
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    if (p === "/api/login" && req.method === "POST") {
      if (!auth.authEnabled()) return send(res, 200, { ok: true, authDisabled: true });
      const role = auth.roleForPassword(body.password);
      if (!role) {
        await new Promise((r) => setTimeout(r, 400));
        return send(res, 401, { error: "Wrong password." });
      }
      return send(res, 200, { ok: true, role }, auth.sessionCookie(role, secure));
    }

    if (p === "/api/logout") {
      return send(res, 200, { ok: true }, auth.clearCookie(secure));
    }

    if (p === "/api/session") {
      return send(res, 200, {
        authed: auth.isAuthed(req), role: auth.sessionRole(req),
        required: auth.authEnabled(), mail: require("../lib/mailer.js").mailEnabled()
      });
    }

    if (!auth.isAuthed(req)) return send(res, 401, { error: "Not signed in." });
    if (auth.requiresAdmin(req.method, p) && !auth.isAdmin(req))
      return send(res, 403, { error: "Admin access only." });

    const out = await billing.handleApi(req.method, p, url.searchParams, body);
    if (out.binary) {
      res.statusCode = out.code;
      res.setHeader("Content-Type", out.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      return res.end(out.binary);
    }
    return send(res, out.code, out.body);
  } catch (err) {
    console.error(err);
    return send(res, 400, { error: err.message || "Request failed" });
  }
};
