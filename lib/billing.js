/* =========================================================
   I7SEVEN MOBILE — billing core

   Picks a storage backend and adds the email step on top.

     DATABASE_URL set    -> PostgreSQL / Supabase
     DATABASE_URL unset  -> SQLite file in ./data

   Everything above this line is identical either way, so you
   can develop on SQLite and deploy on Supabase without the
   tax maths or the API changing at all.
   ========================================================= */
"use strict";

const S = require("./shared.js");

const usingPg = Boolean(process.env.DATABASE_URL);
const store = usingPg ? require("./store-pg.js") : require("./store-sqlite.js");

const {
  getSettings, putSettings, createInvoice, updateInvoice, deleteInvoice,
  getInvoice: rawGetInvoice, searchInvoices, stats, recordEmail,
  healthCheck, describe
} = store;

/* The shop's address and phone live in settings, not on each invoice,
   so a change of premises is reflected everywhere at once. */
async function getInvoice(id) {
  const inv = await rawGetInvoice(id);
  if (!inv) return inv;
  const st = await getSettings();
  inv.biz_address  = st.biz_address;
  inv.biz_phone    = st.biz_phone;
  inv.biz_email    = st.biz_email;
  return inv;
}

/* ---------------------------------------------------------
   Email delivery. Recorded on the invoice so a failed send is
   visible on the dashboard rather than silently lost.
--------------------------------------------------------- */
async function emailInvoice(id) {
  const mailer = require("./mailer.js");
  const inv = await getInvoice(id);
  if (!inv) throw new Error("Invoice not found");

  if (!inv.cust_email) {
    await recordEmail(id, "no_address", "No customer email address.");
    return { sent: false, reason: "no_address", error: "No customer email address." };
  }
  if (!mailer.mailEnabled()) {
    await recordEmail(id, "disabled", "Email is not configured.");
    return { sent: false, reason: "disabled", error: "Email is not configured on this server." };
  }

  try {
    const out = await mailer.sendInvoiceEmail(inv);
    if (out.sent) {
      await recordEmail(id, "sent", null);
      return { sent: true, to: out.to };
    }
    await recordEmail(id, out.reason || "failed", out.error);
    return out;
  } catch (e) {
    await recordEmail(id, "failed", e.message);
    return { sent: false, reason: "failed", error: e.message };
  }
}

/* ---------------------------------------------------------
   Route dispatcher, shared by the local server and Vercel.
--------------------------------------------------------- */
async function handleApi(method, pathname, searchParams, body) {
  if (pathname === "/api/settings" && method === "GET")
    return { code: 200, body: await getSettings() };

  if (pathname === "/api/settings" && method === "PUT")
    return { code: 200, body: await putSettings(body || {}) };

  if (pathname === "/api/invoices" && method === "POST") {
    const created = await createInvoice(body || {});
    /* Saving never sends. The cashier decides, using the Send email
       button, so a bill is not fired off before it has been checked. */
    return { code: 201, body: {
      id: created.id, number: created.number,
      email: { sent: false, reason: created.cust_email ? "not_sent" : "no_address" }
    } };
  }

  const em = pathname.match(/^\/api\/invoices\/(\d+)\/email$/);
  if (em && method === "POST")
    return { code: 200, body: await emailInvoice(Number(em[1])) };

  const pd = pathname.match(/^\/api\/invoices\/(\d+)\/pdf$/);
  if (pd && method === "GET") {
    const inv = await getInvoice(Number(pd[1]));
    if (!inv) return { code: 404, body: { error: "Invoice not found" } };
    const buf = await require("./pdf.js").buildInvoicePdf(inv);
    return { code: 200, binary: buf, contentType: "application/pdf",
             filename: `${inv.number}.pdf` };
  }

  const up = pathname.match(/^\/api\/invoices\/(\d+)$/);
  if (up && method === "PUT") {
    const out = await updateInvoice(Number(up[1]), body || {});
    let email = { sent: false, reason: "no_address" };
    if (out.cust_email && body && body.resend) email = await emailInvoice(out.id);
    return { code: 200, body: { id: out.id, number: out.number, email } };
  }
  if (up && method === "DELETE")
    return { code: 200, body: await deleteInvoice(Number(up[1])) };

  if (pathname === "/api/invoices" && method === "GET")
    return { code: 200, body: await searchInvoices({
      q: searchParams.get("q"),
      field: searchParams.get("field") || "all",
      from: searchParams.get("from"),
      to: searchParams.get("to"),
      limit: searchParams.get("limit")
    }) };

  const m = pathname.match(/^\/api\/invoices\/(\d+)$/);
  if (m && method === "GET") {
    const inv = await getInvoice(Number(m[1]));
    return inv ? { code: 200, body: inv } : { code: 404, body: { error: "Invoice not found" } };
  }

  if (pathname === "/api/stats" && method === "GET")
    return { code: 200, body: await stats() };

  return { code: 404, body: { error: "Unknown endpoint" } };
}

module.exports = {
  DEFAULT_SETTINGS: S.DEFAULT_SETTINGS,
  computeTotals: S.computeTotals,
  usingPg, describe,
  getSettings, putSettings, createInvoice, updateInvoice, deleteInvoice,
  getInvoice, searchInvoices, stats, recordEmail, healthCheck,
  emailInvoice, handleApi
};