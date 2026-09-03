/* =========================================================
   I7SEVEN MOBILE — shared pieces
   Constants, the tax engine, and small helpers. No database
   code here, so both the SQLite and Postgres backends use
   exactly the same arithmetic.
   ========================================================= */
"use strict";

const DEFAULT_SETTINGS = {
  biz_name: "I7SEVEN MOBILE",
  biz_lines: "No. 64, First Floor, Liberty Plaza, Colombo 03\n+94 77 311 1999 \u00b7 info@iseven.lk",
  /* Shown at the top of the invoice. The phone and email are tappable;
     the address is plain text. */
  biz_address: "No. 64, First Floor, Liberty Plaza, Colombo 03",
  biz_phone: "+94 77 311 1999",
  biz_email: "info@iseven.lk",
  vat_no: "", number_prefix: "I7-", currency: "LKR",
  vat_rate: "18", sscl_rate: "2.5", tax_mode: "none", payment_days: "14",
  warranty_text: "Warranty covers manufacturing defects only. Physical damage, liquid damage, burn marks and any unauthorised repair void the warranty. The original invoice must be produced to make a claim. Software issues and consumable parts are not covered.",
  terms: "Payment is due by the date shown above.\nGoods remain the property of I7SEVEN MOBILE until paid for in full.\nGoods once sold are not returnable or exchangeable except under warranty.\nPlease quote the invoice number with your payment."
};

/* Warranty types. "shop" is the ordinary in-house warranty and stays
   the default, so nothing changes for accessories and repairs. */
const WARRANTY_TYPES = {
  shop:       { label: "Limited Warranty",              short: "Limited" },
  apple_care: { label: "AppleCare Limited warranty",    short: "AppleCare" },
  company:    { label: "Company warranty",              short: "Company" }
};

const warrantyLabel = (t) => (WARRANTY_TYPES[t] || WARRANTY_TYPES.shop).label;
const warrantyShort = (t) => (WARRANTY_TYPES[t] || WARRANTY_TYPES.shop).short;
const normaliseWarrantyType = (t) =>
  Object.prototype.hasOwnProperty.call(WARRANTY_TYPES, t) ? t : "shop";

/* tel: links must have no spaces or punctuation. */
const telHref = (phone) => "tel:" + String(phone || "").replace(/[^\d+]/g, "");

const toC = (n) => Math.round((Number(n) || 0) * 100);
const pad = (n, w) => String(n).padStart(w, "0");
const num = (v) => Number(v);

function addDaysIso(isoDate, days) {
  if (!isoDate || !days) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Number(days));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1, 2)}-${pad(dt.getDate(), 2)}`;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
};

/* ---------------------------------------------------------
   Tax engine
     none      total = net
     vat       VAT charged on net
     vat_sscl  SSCL on net first, then VAT on (net + SSCL)
     incl      prices already contain VAT; back it out
--------------------------------------------------------- */
function computeTotals({ items, discount_c, tax_mode, vat_rate, sscl_rate }) {
  let subtotal_c = 0;
  for (const it of items) subtotal_c += it.amount_c;

  const disc  = Math.min(Math.max(0, Number(discount_c) || 0), subtotal_c);
  const net_c = subtotal_c - disc;
  const v = Number(vat_rate) || 0;
  const s = Number(sscl_rate) || 0;

  let sscl_c = 0, taxable_c = net_c, vat_c = 0, incl_vat_c = 0, total_c = net_c;

  if (tax_mode === "vat") {
    vat_c = Math.round(net_c * v / 100);
    total_c = net_c + vat_c;
  } else if (tax_mode === "vat_sscl") {
    sscl_c = Math.round(net_c * s / 100);
    taxable_c = net_c + sscl_c;
    vat_c = Math.round(taxable_c * v / 100);
    total_c = taxable_c + vat_c;
  } else if (tax_mode === "incl") {
    incl_vat_c = Math.round(net_c * v / (100 + v));
    total_c = net_c;
  }
  return { subtotal_c, discount_c: disc, net_c, sscl_c, taxable_c, vat_c, incl_vat_c, total_c };
}

/* Turn the request body into validated, priced line items.
   Shared so both backends store identical rows. */
function normaliseInvoice(body) {
  const issue_date = body.issue_date || todayIso();

  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((it) => (it.description || "").trim() || Number(it.qty) || Number(it.unit_price))
    .map((it, i) => {
      const qty = Number(it.qty) || 0;
      const unit_price_c = toC(it.unit_price);
      const days = Math.max(0, parseInt(it.warranty_days, 10) || 0);
      return {
        pos: i + 1,
        description: String(it.description || "").trim() || "Item",
        imei: (it.imei || "").trim().replace(/\s+/g, "") || null,
        warranty_type: normaliseWarrantyType(it.warranty_type),
        warranty_days: days,
        warranty_until: days > 0 ? addDaysIso(issue_date, days) : null,
        qty, unit_price_c,
        amount_c: Math.round(qty * unit_price_c)
      };
    });

  if (!items.length) throw new Error("An invoice needs at least one item.");
  if (!(body.cust_name || "").trim()) throw new Error("Customer name is required.");

  const tax_mode  = ["none","vat","vat_sscl","incl"].includes(body.tax_mode) ? body.tax_mode : "none";
  const vat_rate  = tax_mode === "none" ? 0 : (Number(body.vat_rate) || 0);
  const sscl_rate = tax_mode === "vat_sscl" ? (Number(body.sscl_rate) || 0) : 0;

  const totals = computeTotals({ items, discount_c: toC(body.discount), tax_mode, vat_rate, sscl_rate });

  return {
    issue_date,
    due_date: body.due_date || null,
    currency: body.currency || null,
    cust_name: String(body.cust_name).trim(),
    cust_nic: (body.cust_nic || "").trim().toUpperCase() || null,
    cust_phone: (body.cust_phone || "").trim() || null,
    cust_address: (body.cust_address || "").trim() || null,
    cust_email: (body.cust_email || "").trim().toLowerCase() || null,
    tax_mode, vat_rate, sscl_rate,
    vat_no_raw: (body.vat_no || "").trim(),
    cashier: (body.cashier || "").trim() || null,
    warranty_text: body.warranty_text,
    terms: body.terms,
    items, totals
  };
}

module.exports = { DEFAULT_SETTINGS, WARRANTY_TYPES, telHref,
                   warrantyLabel, warrantyShort,
                   normaliseWarrantyType, toC, pad, num, addDaysIso, todayIso,
                   computeTotals, normaliseInvoice };
