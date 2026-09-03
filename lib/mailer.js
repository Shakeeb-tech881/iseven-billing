/* =========================================================
   I7SEVEN MOBILE — invoice email

   Sends the invoice as a formatted HTML email. No PDF library,
   no headless browser, so it runs anywhere including Vercel.

   Environment variables:
     SMTP_HOST   e.g. smtp-relay.brevo.com
     SMTP_PORT   587
     SMTP_USER   your Brevo SMTP login
     SMTP_PASS   your Brevo SMTP key
     MAIL_FROM   I7SEVEN MOBILE <info@iseven.lk>
     MAIL_REPLY_TO   optional, defaults to MAIL_FROM

   With SMTP_HOST unset, sending is switched off and invoices
   simply save without an email. Nothing breaks.
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const mailEnabled = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

const FROM = () => process.env.MAIL_FROM || "I7SEVEN MOBILE <info@iseven.lk>";

/* One transport per warm instance. */
function getTransport() {
  if (!globalThis.__i7mail) {
    const nodemailer = require("nodemailer");
    const port = Number(process.env.SMTP_PORT || 587);
    globalThis.__i7mail = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,          // 587 uses STARTTLS, not implicit TLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 12000,
      greetingTimeout: 8000,
      socketTimeout: 20000
    });
  }
  return globalThis.__i7mail;
}

/* ---------------------------------------------------------
   Formatting
--------------------------------------------------------- */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const WTYPE = {
  shop:       { label: "Limited Warranty",           short: "Limited" },
  apple_care: { label: "AppleCare Limited warranty", short: "AppleCare" },
  company:    { label: "Company warranty",           short: "Company" }
};

const wLabel = (t) => (WTYPE[t] || WTYPE.shop).label;
const wShort = (t) => (WTYPE[t] || WTYPE.shop).short;

function money(c) {
  const neg = c < 0; c = Math.abs(Math.round(c || 0));
  const s = (c / 100).toFixed(2).split(".");
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + s[0] + "." + s[1];
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

function niceDate(v) {
  if (!v) return "\u2014";
  const p = String(v).split("-");
  if (p.length !== 3) return String(v);
  return `${p[2]} ${MON[Number(p[1]) - 1]} ${p[0]}`;
}

/* Basic sanity check. Real validation is the delivery attempt itself. */
const looksLikeEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());

/* ---------------------------------------------------------
   HTML body

   Email clients strip <style> blocks and ignore flexbox, so
   everything here is tables with inline styles. That is not
   old-fashioned, it is the only thing that renders reliably
   in Gmail, Outlook and Apple Mail.
--------------------------------------------------------- */
/* One point per line, with the label before the first colon in bold. */
function termListHtml(text, size) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  const fs2 = size || 11.5;
  if (lines.length === 1) {
    return `<p style="margin:0;font-size:${fs2}px;color:#5f6b7d;line-height:1.55">${esc(lines[0])}</p>`;
  }
  return `<table cellpadding="0" cellspacing="0" width="100%">${lines.map((line) => {
    const i = line.indexOf(":");
    const body = (i > 0 && i < 48)
      ? `<b style="color:#141b25">${esc(line.slice(0, i + 1))}</b> ${esc(line.slice(i + 1).trim())}`
      : esc(line);
    return `<tr>
      <td valign="top" width="12" style="font-size:${fs2}px;color:#ccd3de;padding:0 0 5px">&bull;</td>
      <td valign="top" style="font-size:${fs2}px;color:#5f6b7d;line-height:1.55;padding:0 0 5px">${body}</td>
    </tr>`;
  }).join("")}</table>`;
}

function renderEmail(inv, attachmentName) {
  const cur = inv.currency || "LKR";
  const mode = inv.tax_mode || "none";
  const items = inv.items || [];
  /* Only show Due when the customer actually owes money later. */
  const showDue = Boolean(inv.due_date) && inv.due_date !== inv.issue_date;

  const telHref = (p2) => "tel:" + String(p2 || "").replace(/[^\d+]/g, "");
  const A = "color:#5f6b7d;text-decoration:none";

  const lines = items.map((it) => {
    const imei = (it.imei || "").trim()
      ? `<div style="font-family:Consolas,monospace;font-size:11px;color:#5f6b7d;margin-top:2px">IMEI ${esc(it.imei)}</div>` : "";
    const w = Number(it.warranty_days) > 0
      ? `<div style="font-size:11px;color:#5f6b7d;margin-top:4px;border-left:3px solid ${it.warranty_type === "apple_care" ? "#111111" : it.warranty_type === "company" ? "#7a8699" : "#c6fa02"};padding-left:7px;line-height:1.45">${esc(wLabel(it.warranty_type))} <b style="color:#141b25">${Number(it.warranty_days)}</b> days &middot; valid to ${niceDate(it.warranty_until)}</div>` : "";
    return `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #e7eaf1;font-size:13px;color:#141b25">
        ${esc(it.description)}${imei}${w}
      </td>
      <td width="40"  style="padding:9px 0 9px 14px;border-bottom:1px solid #e7eaf1;font-size:13px;text-align:right;font-family:Consolas,monospace;color:#141b25;white-space:nowrap">${Number(it.qty) || 0}</td>
      <td width="105" style="padding:9px 0 9px 14px;border-bottom:1px solid #e7eaf1;font-size:13px;text-align:right;font-family:Consolas,monospace;color:#141b25;white-space:nowrap">${money(it.unit_price_c)}</td>
      <td width="105" style="padding:9px 0 9px 14px;border-bottom:1px solid #e7eaf1;font-size:13px;text-align:right;font-family:Consolas,monospace;color:#141b25;white-space:nowrap">${money(it.amount_c)}</td>
    </tr>`;
  }).join("");

  const row = (label, value, opts = {}) => `<tr>
    <td style="padding:4px 20px 4px 0;font-size:13px;color:${opts.strong ? "#141b25" : "#5f6b7d"};${opts.top ? "border-top:1px solid #ccd3de;padding-top:8px;" : ""}${opts.grand ? "border-top:2px solid #10161f;padding-top:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;font-size:11px;" : ""}">${label}</td>
    <td style="padding:4px 0;font-size:${opts.grand ? "17px;font-weight:bold" : "13px"};text-align:right;font-family:Consolas,monospace;color:#141b25;${opts.top ? "border-top:1px solid #ccd3de;padding-top:8px;" : ""}${opts.grand ? "border-top:2px solid #10161f;padding-top:10px;" : ""}">${value}</td>
  </tr>`;

  let sums = row(mode === "incl" ? "Subtotal (VAT inclusive)" : "Subtotal", `${cur} ${money(inv.subtotal_c)}`);
  if (inv.discount_c) sums += row("Discount", `-${cur} ${money(inv.discount_c)}`);
  if (mode === "vat_sscl") {
    if (inv.discount_c) sums += row("Value of goods", `${cur} ${money(inv.net_c)}`, { top: true });
    sums += row(`SSCL ${Number(inv.sscl_rate) || 0}%`, `${cur} ${money(inv.sscl_c)}`);
    sums += row("Value liable to VAT", `${cur} ${money(inv.taxable_c)}`, { top: true, strong: true });
    sums += row(`VAT ${Number(inv.vat_rate) || 0}%`, `${cur} ${money(inv.vat_c)}`);
  } else if (mode === "vat") {
    sums += row(`VAT ${Number(inv.vat_rate) || 0}%`, `${cur} ${money(inv.vat_c)}`);
  }
  sums += row("Total due", `${cur} ${money(inv.total_c)}`, { grand: true });

  const inclNote = mode === "incl"
    ? `<div style="text-align:right;margin-top:6px;font-size:11px;color:#5f6b7d;font-family:Consolas,monospace">Includes VAT ${Number(inv.vat_rate) || 0}% of ${cur} ${money(inv.incl_vat_c)}</div>` : "";

  const wItems = items.filter((it) => Number(it.warranty_days) > 0);
  const warranty = wItems.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border:1px solid #10161f;border-collapse:collapse">
      <tr><td style="background:#c6fa02;color:#10161f;padding:6px 13px;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">Warranty terms &amp; conditions</td></tr>
      <tr><td style="padding:12px 13px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding-bottom:5px;border-bottom:1px solid #e7eaf1">Item</td>
            <td style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding:0 0 5px 12px;border-bottom:1px solid #e7eaf1">Type</td>
            <td width="50"  style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding:0 0 5px 12px;border-bottom:1px solid #e7eaf1;text-align:right">Days</td>
            <td width="105" style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding:0 0 5px 12px;border-bottom:1px solid #e7eaf1;text-align:right">Covered until</td>
          </tr>
          ${wItems.map((it) => `<tr>
            <td style="font-size:12px;padding:5px 0;border-bottom:1px solid #f2f4f8;color:#141b25">${esc(it.description)}</td>
            <td style="font-size:10px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:5px 0 5px 12px;border-bottom:1px solid #f2f4f8;color:#5f6b7d;white-space:nowrap">${esc(wShort(it.warranty_type))}</td>
            <td style="font-size:12px;padding:5px 0 5px 12px;border-bottom:1px solid #f2f4f8;text-align:right;font-family:Consolas,monospace;color:#141b25">${Number(it.warranty_days)}</td>
            <td style="font-size:12px;padding:5px 0 5px 12px;border-bottom:1px solid #f2f4f8;text-align:right;font-family:Consolas,monospace;color:#141b25;white-space:nowrap">${niceDate(it.warranty_until)}</td>
          </tr>`).join("")}
        </table>
        <div style="margin-top:10px">${termListHtml(inv.warranty_text, 11)}</div>
      </td></tr>
    </table>` : "";

  const vatLine = (mode !== "none" && (inv.vat_no || "").trim())
    ? `<div style="margin-top:7px;padding-top:6px;border-top:1px solid #2a3646;font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#8d99aa">VAT Reg. No.<br><span style="font-family:Consolas,monospace;font-size:12px;color:#e8edf4;letter-spacing:0">${esc(inv.vat_no)}</span></div>` : "";

  const nic = (inv.cust_nic || "").trim()
    ? `<div style="margin-top:5px;display:inline-block;font-family:Consolas,monospace;font-size:11px;background:#f2f5e3;border:1px solid #d9e5a0;padding:2px 8px;color:#141b25"><span style="font-family:Arial,sans-serif;font-weight:bold;font-size:8px;letter-spacing:1px;color:#5f6b7d">NIC</span> ${esc(inv.cust_nic)}</div>` : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#e9ecf2;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e9ecf2;padding:20px 10px">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff">

  <tr><td style="background:#10161f;padding:20px 32px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top">
        <img src="cid:i7logo" alt="I7SEVEN" width="150" style="display:block;border:0">
        <div style="font-size:9px;font-weight:bold;letter-spacing:5px;text-transform:uppercase;color:#e8edf4;margin-top:6px;padding-left:2px">Mobile</div>
      </td>
      <td valign="top" align="right">
        <div style="font-size:10px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:#8d99aa">${mode === "none" ? "Invoice" : "Tax invoice"}</div>
        <div style="font-family:Consolas,monospace;font-size:19px;font-weight:bold;color:#c6fa02;margin-top:2px">${esc(inv.number)}</div>
        ${vatLine}
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#c6fa02;height:3px;line-height:3px;font-size:0">&nbsp;</td></tr>

  <tr><td style="padding:24px 32px 32px">

    ${(inv.biz_address || inv.biz_phone || inv.biz_email) ? `
    <div style="font-size:12px;color:#5f6b7d;line-height:1.6">
      ${inv.biz_address ? `${esc(inv.biz_address)}<br>` : ""}
      ${inv.biz_phone ? `<a href="${esc(telHref(inv.biz_phone))}" style="${A}">${esc(inv.biz_phone)}</a>` : ""}
      ${inv.biz_phone && inv.biz_email ? `<span style="color:#ccd3de">&nbsp;&middot;&nbsp;</span>` : ""}
      ${inv.biz_email ? `<a href="mailto:${esc(inv.biz_email)}" style="${A}">${esc(inv.biz_email)}</a>` : ""}
    </div>` : `
    <div style="font-size:12px;color:#5f6b7d;line-height:1.5">${esc(inv.biz_lines || "").replace(/\n/g, "<br>")}</div>`}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:2px solid #10161f;border-bottom:1px solid #ccd3de">
      <tr>
        <td valign="top" style="padding:13px 20px 13px 0">
          <div style="font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#5f6b7d;margin-bottom:3px">Billed to</div>
          <div style="font-size:13px;color:#141b25;line-height:1.5">${esc(inv.cust_name)}${inv.cust_address ? "<br>" + esc(inv.cust_address).replace(/\n/g, "<br>") : ""}${inv.cust_phone ? "<br>" + esc(inv.cust_phone) : ""}</div>
          ${nic}
        </td>
        <td valign="top" style="padding:13px 20px 13px 0">
          <div style="font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#5f6b7d;margin-bottom:3px">Issued</div>
          <div style="font-size:13px;font-family:Consolas,monospace;color:#141b25">${niceDate(inv.issue_date)}</div>
        </td>
        ${showDue ? `<td valign="top" style="padding:13px 0">
          <div style="font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#5f6b7d;margin-bottom:3px">Due</div>
          <div style="font-size:13px;font-family:Consolas,monospace;color:#141b25">${niceDate(inv.due_date)}</div>
        </td>` : ""}
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-collapse:collapse">
      <tr>
        <td style="font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#5f6b7d;padding-bottom:6px;border-bottom:1px solid #10161f">Description</td>
        <td width="40"  style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding:0 0 6px 14px;border-bottom:1px solid #10161f;text-align:right">Qty</td>
        <td width="105" style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding:0 0 6px 14px;border-bottom:1px solid #10161f;text-align:right">Unit price</td>
        <td width="105" style="font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#5f6b7d;padding:0 0 6px 14px;border-bottom:1px solid #10161f;text-align:right">Amount</td>
      </tr>
      ${lines}
    </table>

    <table cellpadding="0" cellspacing="0" align="right" style="margin-top:14px;min-width:290px">${sums}</table>
    <div style="clear:both"></div>
    ${inclNote}
    ${warranty}

    ${(inv.terms || "").trim() ? `<div style="margin-top:22px;padding-top:12px;border-top:1px solid #ccd3de">
      <div style="font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#5f6b7d;margin-bottom:5px">Terms and conditions</div>
      ${termListHtml(inv.terms, 11)}
    </div>` : ""}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;background:#f4f6fa;border:1px solid #ccd3de">
      <tr><td style="padding:13px 15px;font-size:12px;color:#141b25;line-height:1.55">
        <b>Keep a copy.</b> Your invoice is attached as
        <span style="font-family:Consolas,monospace">${esc(attachmentName || inv.number + ".pdf")}</span>.
        Save it — you will need it to make a warranty claim.
      </td></tr>
    </table>

    <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e7eaf1;font-size:11px;color:#5f6b7d">
      Thank you for your business. Questions about this invoice? Reply to this email.
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* Plain-text fallback for clients that refuse HTML. */
function renderText(inv) {
  const cur = inv.currency || "LKR";
  const L = [];
  L.push(`${inv.biz_name || "I7SEVEN MOBILE"}`);
  if (inv.biz_address) L.push(inv.biz_address);
  if (inv.biz_phone || inv.biz_email)
    L.push([inv.biz_phone, inv.biz_email].filter(Boolean).join("  \u00b7  "));
  L.push(`${inv.tax_mode === "none" ? "Invoice" : "Tax invoice"} ${inv.number}`);
  L.push(`Issued ${niceDate(inv.issue_date)}` +
         (inv.due_date && inv.due_date !== inv.issue_date ? `   Due ${niceDate(inv.due_date)}` : ""));
  L.push("");
  L.push(`Billed to: ${inv.cust_name}${inv.cust_nic ? ` (NIC ${inv.cust_nic})` : ""}`);
  L.push("");
  for (const it of (inv.items || [])) {
    L.push(`${it.description}  x${Number(it.qty) || 0}  ${cur} ${money(it.amount_c)}`);
    if (it.imei) L.push(`   IMEI ${it.imei}`);
    if (Number(it.warranty_days) > 0)
      L.push(`   ${wLabel(it.warranty_type)} ${it.warranty_days} days, valid to ${niceDate(it.warranty_until)}`);
  }
  L.push("");
  L.push(`Subtotal        ${cur} ${money(inv.subtotal_c)}`);
  if (inv.discount_c) L.push(`Discount       -${cur} ${money(inv.discount_c)}`);
  if (inv.tax_mode === "vat_sscl") {
    L.push(`SSCL ${inv.sscl_rate}%      ${cur} ${money(inv.sscl_c)}`);
    L.push(`Liable to VAT   ${cur} ${money(inv.taxable_c)}`);
    L.push(`VAT ${inv.vat_rate}%        ${cur} ${money(inv.vat_c)}`);
  } else if (inv.tax_mode === "vat") {
    L.push(`VAT ${inv.vat_rate}%        ${cur} ${money(inv.vat_c)}`);
  } else if (inv.tax_mode === "incl") {
    L.push(`Includes VAT ${inv.vat_rate}% of ${cur} ${money(inv.incl_vat_c)}`);
  }
  L.push(`TOTAL DUE       ${cur} ${money(inv.total_c)}`);
  L.push("");
  L.push("Thank you for your business.");
  return L.join("\n");
}

/* ---------------------------------------------------------
   Send
--------------------------------------------------------- */
/* A self-contained copy the customer can open and print to PDF.
   No PDF library and no public URL needed, so it works anywhere. */
function invoiceAttachment(inv) {
  const html = renderEmail(inv, `${inv.number}.html`)
    .replace('<img src="cid:i7logo" alt="I7SEVEN" width="150" style="display:block;border:0">',
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;font-style:italic;color:#c6fa02;letter-spacing:-1px">I7SEVEN</div>')
    .replace("</body>",
      `<div style="text-align:center;padding:14px;font-family:Arial,sans-serif;font-size:12px;color:#5f6b7d">
         Use your browser's Print option, then choose "Save as PDF".
       </div></body>`);
  return {
    filename: `${inv.number}.html`,
    content: html,
    contentType: "text/html; charset=utf-8"
  };
}

function logoAttachment() {
  const p = path.join(__dirname, "..", "public", "logo.png");
  try {
    if (fs.existsSync(p)) {
      return [{ filename: "logo.png", path: p, cid: "i7logo" }];
    }
  } catch { /* fall through */ }
  return [];
}

async function sendInvoiceEmail(inv) {
  if (!mailEnabled()) {
    return { sent: false, reason: "disabled", error: "Email is not configured." };
  }
  const to = String(inv.cust_email || "").trim();
  if (!to) return { sent: false, reason: "no_address", error: "No customer email address." };
  if (!looksLikeEmail(to)) {
    return { sent: false, reason: "bad_address", error: `"${to}" does not look like an email address.` };
  }

  let pdf = null;
  try {
    pdf = await require("./pdf.js").invoicePdfAttachment(inv);
  } catch (e) {
    /* A PDF failure must never stop the invoice reaching the customer.
       The email still goes out with the HTML copy attached instead. */
    console.error("PDF generation failed for " + inv.number + ":", e.stack || e.message);
  }

  const info = await getTransport().sendMail({
    from: FROM(),
    to,
    replyTo: process.env.MAIL_REPLY_TO || FROM(),
    subject: `${inv.tax_mode === "none" ? "Invoice" : "Tax invoice"} ${inv.number} from ${inv.biz_name || "I7SEVEN MOBILE"}`,
    text: renderText(inv),
    html: renderEmail(inv, pdf ? `${inv.number}.pdf` : `${inv.number}.html`),
    attachments: logoAttachment().concat(pdf ? [pdf] : [invoiceAttachment(inv)])
  });

  return { sent: true, messageId: info.messageId, to };
}

async function verifyConnection() {
  if (!mailEnabled()) throw new Error("SMTP_HOST and SMTP_USER are not set.");
  return getTransport().verify();
}

module.exports = { mailEnabled, sendInvoiceEmail, renderEmail, renderText,
                   looksLikeEmail, verifyConnection, FROM };
