/* =========================================================
   I7SEVEN MOBILE — authentication and roles

   Two roles, two passwords:
     ADMIN_PASSWORD    sees everything: takings, VAT totals, settings
     CASHIER_PASSWORD  writes invoices, emails them, looks up warranties

   Environment variables:
     ADMIN_PASSWORD
     CASHIER_PASSWORD
     SESSION_SECRET     long random string (openssl rand -hex 32)

   If neither password is set, auth is OFF and everyone is treated as
   admin. Deliberate for a closed shop LAN. Never do that on a public host.
   ========================================================= */
"use strict";

const crypto = require("node:crypto");

const COOKIE = "i7s";
const MAX_AGE = 60 * 60 * 12; // 12 hours

/* APP_PASSWORD was the older single-password variable. If it is the
   only one set it still works, and grants admin. */
const adminPw   = () => process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || "";
const cashierPw = () => process.env.CASHIER_PASSWORD || "";

const authEnabled = () => Boolean(adminPw() || cashierPw());

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET must be set to at least 16 characters.");
  }
  return s;
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const body = token.slice(0, dot);
  const mac  = token.slice(dot + 1);
  const expect = crypto.createHmac("sha256", secret()).update(body).digest("base64url");

  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!data.exp || Date.now() / 1000 > data.exp) return null;
    if (data.role !== "admin" && data.role !== "cashier") return null;
    return data;
  } catch { return null; }
}

/* Constant-time comparison so response timing cannot reveal the password. */
function sameSecret(given, real) {
  if (!real) return false;
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

/* Both comparisons always run, so a wrong password takes the same
   time whichever role it failed against. */
function roleForPassword(given) {
  const isAdmin   = sameSecret(given, adminPw());
  const isCashier = sameSecret(given, cashierPw());
  if (isAdmin) return "admin";
  if (isCashier) return "cashier";
  return null;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(role, secure) {
  const token = sign({ exp: Math.floor(Date.now() / 1000) + MAX_AGE, role });
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}` +
         (secure ? "; Secure" : "");
}

function clearCookie(secure) {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` + (secure ? "; Secure" : "");
}

/* "admin", "cashier", or null. With auth off, everyone is admin. */
function sessionRole(req) {
  if (!authEnabled()) return "admin";
  const data = verify(parseCookies(req.headers.cookie)[COOKIE]);
  return data ? data.role : null;
}

const isAuthed = (req) => Boolean(sessionRole(req));
const isAdmin  = (req) => sessionRole(req) === "admin";

/* Routes only an admin may touch. Everything else is open to both. */
const ADMIN_ONLY = [
  { method: "GET",    path: /^\/api\/stats$/ },
  { method: "PUT",    path: /^\/api\/settings$/ },
  { method: "PUT",    path: /^\/api\/invoices\/\d+$/ },
  { method: "DELETE", path: /^\/api\/invoices\/\d+$/ }
];

const requiresAdmin = (method, pathname) =>
  ADMIN_ONLY.some((r) => r.method === method && r.path.test(pathname));

module.exports = {
  COOKIE, MAX_AGE, authEnabled, sign, verify,
  roleForPassword, parseCookies, sessionCookie, clearCookie,
  sessionRole, isAuthed, isAdmin, requiresAdmin
};
