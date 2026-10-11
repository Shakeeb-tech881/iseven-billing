/* =========================================================
   I7SEVEN MOBILES — billing core

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
      /* The message id is kept so Brevo's webhook can report back later
         whether this exact message was delivered or bounced. */
      const at = new Date().toISOString();
      await recordEmail(id, "sent", null, out.messageId);
      return { sent: true, to: out.to, sent_at: at };
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
/* ---------------------------------------------------------
   Brevo delivery reports.

   "Sent" only means Brevo accepted the message. Whether it reached the
   customer is known a minute or two later, and Brevo reports it to this
   webhook. Only the events that change the answer are recorded; opens
   and clicks are ignored, and "deferred" is a retry, not a verdict.
--------------------------------------------------------- */
const BREVO_EVENTS = {
  delivered:     "delivered",
  hard_bounce:   "bounced",
  invalid_email: "bounced",
  soft_bounce:   "soft_bounce",
  blocked:       "blocked",
  spam:          "spam",
  error:         "failed",
  unsubscribed:  "unsubscribed"
};

async function brevoWebhook(body) {
  const status = BREVO_EVENTS[String(body && body.event || "").toLowerCase()];
  if (!status) return { ignored: String(body && body.event || "") };

  const at = body.ts_epoch ? new Date(Number(body.ts_epoch)).toISOString()
                           : new Date().toISOString();
  const ids = await store.recordDelivery({
    messageId: body["message-id"] || body.message_id || null,
    email: body.email || null,
    status,
    reason: body.reason || null,
    at
  });
  return { status, matched: ids.length };
}

/* ---------------------------------------------------------
   Cashiers work on today's invoices only.

   "Today" is the shop's calendar day in Colombo, and it is judged by
   when the invoice was created, not by its issue date: the issue date
   is a field the cashier can type, so it could be set to reach an old
   invoice. The time of creation is written by the server and cannot.
--------------------------------------------------------- */
const SHOP_TZ = "Asia/Colombo";
const shopDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: SHOP_TZ });
function startOfShopDayIso() {
  const day = shopDay(Date.now());                          // e.g. 2026-09-21
  const offset = new Date(Date.now()).toLocaleString("en-US",
    { timeZone: SHOP_TZ, timeZoneName: "longOffset" }).match(/GMT([+-]\d\d:\d\d)/);
  return new Date(`${day}T00:00:00${offset ? offset[1] : "+05:30"}`).toISOString();
}
const createdToday = (inv) => inv && inv.created_at && shopDay(inv.created_at) === shopDay(Date.now());

/* An invoice is finished when the customer has it: the email was
   delivered, it was handed over on WhatsApp or in print, or it was
   emailed long enough ago that no delivery report is ever coming —
   everything sent before the Brevo webhook existed falls in that last
   group, and would otherwise sit in the list for ever. */
const SETTLED_HOURS = 48;
function isFinished(inv) {
  if ((inv.email_status || "not_sent") === "delivered") return true;
  if (inv.handed_over_at) return true;
  return inv.email_status === "sent" && inv.email_sent_at &&
         new Date(inv.email_sent_at).getTime() < Date.now() - SETTLED_HOURS * 3600000;
}

/* A cashier works on today's invoices, and on the unfinished business of
   any day. Finished ones drop out of their view; the back history
   belongs to the owner. */
const cashierMayOpen = (inv) => createdToday(inv) || !isFinished(inv);

const NOT_TODAY = { code: 403, body: { error:
  "That invoice has already been delivered. Cashiers see today's invoices "
  + "and anything still waiting to be sent. Ask the owner for the rest." } };

async function handleApi(method, pathname, searchParams, body, role) {
  if (role === "cashier") {
    /* Any route aimed at one invoice: view, PDF, email, edit, handover. */
    const one = pathname.match(/^\/api\/invoices\/(\d+)(?:\/(?:pdf|email|handover))?$/);
    if (one) {
      const inv = await getInvoice(Number(one[1]));
      if (!inv) return { code: 404, body: { error: "Invoice not found" } };
      /* Marking an invoice as given takes it out of the cashier's list,
         which would otherwise lock them out of undoing their own
         mistake. Today's handovers stay reversible by them. */
      const undoingToday = pathname.endsWith("/handover") && inv.handed_over_at
        && shopDay(inv.handed_over_at) === shopDay(Date.now());
      if (!cashierMayOpen(inv) && !undoingToday) return NOT_TODAY;
    }
    if (pathname === "/api/invoices" && method === "GET")
      return { code: 200, body: await searchInvoices({
        q: searchParams.get("q"),
        field: searchParams.get("field") || "all",
        /* The date boxes work for cashiers too now, inside their scope. */
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        limit: searchParams.get("limit"),
        createdSince: startOfShopDayIso(),
        orUndelivered: true
      }) };
  }
  return routeApi(method, pathname, searchParams, body);
}

async function routeApi(method, pathname, searchParams, body) {
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

  /* The invoice reached the customer without email — sent on WhatsApp or
     printed at the counter. Recorded so it counts as done. */
  const hv = pathname.match(/^\/api\/invoices\/(\d+)\/handover$/);
  if (hv && method === "POST") {
    const how = ["whatsapp", "printed", "other"].includes((body || {}).how)
      ? body.how : "other";
    if ((body || {}).undo) {
      await store.clearHandover(Number(hv[1]));
      return { code: 200, body: { handed_over: false } };
    }
    const out = await store.recordHandover(Number(hv[1]), how, (body || {}).by || null);
    if (!out) return { code: 404, body: { error: "Invoice not found" } };
    return { code: 200, body: { handed_over: true, how, at: out.handed_over_at,
                                number: out.number } };
  }

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
    /* "not_sent" when there is somewhere to send it, so the till offers
       the Send button after an edit. It used to always say no_address,
       which hid the button even when an address had just been typed. */
    let email = { sent: false,
                  reason: out.cust_email ? "not_sent" : "no_address" };
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
  emailInvoice, handleApi, brevoWebhook
};
