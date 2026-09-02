/* =========================================================
   I7SEVEN MOBILE — local server (Supabase / PostgreSQL)

   Uses the same lib/billing.js as the Vercel functions, so the
   tax engine and queries can never drift between the two.

     npm install
     DATABASE_URL="postgresql://..." node server-supabase.js

   Optional login (recommended if the machine is reachable
   beyond your own LAN):
     APP_PASSWORD="..." SESSION_SECRET="..." node server-supabase.js
   ========================================================= */
"use strict";

const http = require("node:http");
const fs   = require("node:fs");
const path = require("node:path");

const billing = require("./lib/billing.js");
const auth    = require("./lib/auth.js");

const PORT   = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json"
};

function json(res, code, obj, cookie) {
  const b = JSON.stringify(obj);
  const h = { "Content-Type": "application/json; charset=utf-8",
              "Content-Length": Buffer.byteLength(b), "Cache-Control": "no-store" };
  if (cookie) h["Set-Cookie"] = cookie;
  res.writeHead(code, h);
  res.end(b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) { reject(new Error("Body too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end("Forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const secure = (req.headers["x-forwarded-proto"] || "http") === "https";

  try {
    if (p.startsWith("/api/")) {
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};

      if (p === "/api/login" && req.method === "POST") {
        if (!auth.authEnabled()) return json(res, 200, { ok: true, authDisabled: true });
        const role = auth.roleForPassword(body.password);
        if (!role) {
          await new Promise((r) => setTimeout(r, 400));
          return json(res, 401, { error: "Wrong password." });
        }
        return json(res, 200, { ok: true, role }, auth.sessionCookie(role, secure));
      }
      if (p === "/api/logout") return json(res, 200, { ok: true }, auth.clearCookie(secure));
      if (p === "/api/session")
        return json(res, 200, {
          authed: auth.isAuthed(req), role: auth.sessionRole(req),
          required: auth.authEnabled(), mail: require("./lib/mailer.js").mailEnabled()
        });

      if (!auth.isAuthed(req)) return json(res, 401, { error: "Not signed in." });
      if (auth.requiresAdmin(req.method, p) && !auth.isAdmin(req))
        return json(res, 403, { error: "Admin access only." });

      const out = await billing.handleApi(req.method, p, url.searchParams, body);
      if (out.binary) {
        res.writeHead(out.code, {
          "Content-Type": out.contentType,
          "Content-Length": out.binary.length,
          "Content-Disposition": `attachment; filename="${out.filename}"`
        });
        return res.end(out.binary);
      }
      return json(res, out.code, out.body);
    }
    serveStatic(res, p);
  } catch (err) {
    console.error(err);
    json(res, 400, { error: err.message || "Request failed" });
  }
});

(async () => {
  try {
    await billing.healthCheck();
  } catch (e) {
    console.error(`\n  Could not reach the database.\n\n  ${e.message}\n` +
      (billing.usingPg ? "\n  Using PostgreSQL. Check DATABASE_URL and that schema.sql has been run.\n" : ""));
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`\n  I7SEVEN billing`);
    console.log(`  Database:       ${billing.describe()}`);
    console.log(`  Login required: ${auth.authEnabled() ? "yes" : "NO — set ADMIN_PASSWORD to enable"}`);
    console.log(`  Email sending:  ${require("./lib/mailer.js").mailEnabled() ? "on, from " + require("./lib/mailer.js").FROM() : "off — set SMTP_HOST"}`);
    console.log(`  New invoice   http://localhost:${PORT}/`);
    console.log(`  Dashboard     http://localhost:${PORT}/dashboard.html\n`);
  });
})();
