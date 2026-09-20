/* =========================================================
   I7SEVEN MOBILES — shared pieces
   Constants, the tax engine, and small helpers. No database
   code here, so both the SQLite and Postgres backends use
   exactly the same arithmetic.
   ========================================================= */
"use strict";

const DEFAULT_SETTINGS = {
  biz_name: "I7SEVEN MOBILES",
  biz_lines: "No. 64, First Floor, Liberty Plaza, Colombo 03\n+94 77 311 1999 \u00b7 info@iseven.lk",
  /* Shown at the top of the invoice. The phone and email are tappable;
     the address is plain text. */
  biz_address: "No. 64, First Floor, Liberty Plaza, Colombo 03",
  biz_phone: "+94 77 311 1999",
  biz_email: "info@iseven.lk",
  vat_no: "", number_prefix: "I7-", currency: "LKR",
  vat_rate: "18", sscl_rate: "2.5", tax_mode: "none", payment_days: "14",
  /* Which warranty an item starts on. Most sales here are Apple. */
  warranty_type_default: "apple_care",
  /* One point per line. A line starting with ! is printed on a
     highlighted band, with the text before the colon as its heading;
     the ! itself is never shown. The shipping offer leads. */
  warranty_text: "!Warranty Shipping at No Additional Cost: Simply hand over your device at our showroom, and we’ll take care of the LKR 25,000 shipping cost.\nScope & Eligibility: This warranty is non-transferable and applies strictly to the original purchaser named on this invoice. The original invoice must be produced for every claim.\nClaim Window: Warranty claims must be handed over to us no later than 14 days before the warranty end date shown above. Devices brought in during the final 14 days cannot be accepted, as there must be sufficient cover remaining for the claim to be processed.\nService Provider: All Apple warranty claims are processed through Apple Authorized Service Providers.\nReplacement Policy: Replacements cover only the defective unit or the individual part, such as an earpiece, and never a full retail boxed set. MacBooks are serviced by replacing the defective component rather than the entire device.\nProcessing & Support: Claim processing may take 45 days or longer. Loan devices are not provided under any circumstances.\nWarranty Exclusions: Physical damage, liquid contact and burn damage void the warranty entirely. Display and touch-related hardware faults are excluded from coverage.\nSoftware & Modifications: Coverage applies only to official operating system firmware. Jailbreaking or rooting the device cancels all warranty coverage immediately.\nAccessories & Battery: Battery, charger, data cable and handsfree carry a limited 6-month warranty.\nFinal Authority: Devices requiring user-direct claim handling must be taken directly to an Apple Authorized Service Provider. All decisions made by Apple are final.",
  /* Everything lives in the warranty block above, so the separate
     Terms and conditions section stays empty and is not printed. */
  terms: ""
};

/* Warranty types. "shop" is the ordinary in-house warranty and stays
   the default, so nothing changes for accessories and repairs. */
const WARRANTY_TYPES = {
  shop:       { label: "Limited Warranty",              short: "Limited" },
  apple_care: { label: "AppleCare Limited warranty",    short: "AppleCare" },
  company:    { label: "Company warranty",              short: "Company" },
  /* Sold as seen: printed on the line so there is no argument later. */
  none:       { label: "No Warranty",                   short: "None",
                noCover: true }
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
      const wtype = normaliseWarrantyType(it.warranty_type);
      /* "No Warranty" never carries days or an expiry date. */
      const days = wtype === "none"
        ? 0 : Math.max(0, parseInt(it.warranty_days, 10) || 0);
      return {
        pos: i + 1,
        description: String(it.description || "").trim() || "Item",
        imei: (it.imei || "").trim().replace(/\s+/g, "") || null,
        warranty_type: wtype,
        /* Each line decides for itself whether to print its expiry date. */
        show_expiry: it.show_expiry === undefined ? true : Boolean(it.show_expiry),
        /* Contents of a bundle, one per line, listed without prices. */
        pack_items: String(it.pack_items || "")
          .split("\n").map((l) => l.trim()).filter(Boolean).join("\n") || null,
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
    /* Default on: most customers want to see when cover ends. */
    show_warranty_expiry: body.show_warranty_expiry === undefined
      ? true : Boolean(body.show_warranty_expiry),
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
