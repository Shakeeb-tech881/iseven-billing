/* =========================================================
   I7SEVEN MOBILE — PDF invoice

   Draws the invoice directly with PDFKit. No headless browser,
   so it runs on the counter machine and on Vercel alike.
   Output is a real PDF with selectable text.
   ========================================================= */
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const PDFDocument = require("pdfkit");

/* ---------- palette, matching the printed invoice ---------- */
const INK       = "#10161f";
const LIME      = "#c6fa02";
const TEXT      = "#141b25";
const SOFT      = "#5f6b7d";
const RULE      = "#ccd3de";
const RULE_SOFT = "#e7eaf1";
const APPLE     = "#111111";
const COMPANY   = "#7a8699";

const PAGE_W = 595.28;                 // A4 at 72dpi
const M = 42;                          // margin
const CONTENT_W = PAGE_W - M * 2;

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const telHref = (phone) => "tel:" + String(phone || "").replace(/[^\d+]/g, "");

const WTYPE = {
  shop:       { label: "Warranty",           short: "Shop",      colour: LIME },
  apple_care: { label: "AppleCare warranty", short: "AppleCare", colour: APPLE },
  company:    { label: "Company warranty",   short: "Company",   colour: COMPANY }
};
const wt = (t) => WTYPE[t] || WTYPE.shop;

function money(c) {
  const neg = c < 0; c = Math.abs(Math.round(c || 0));
  const s = (c / 100).toFixed(2).split(".");
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + s[0] + "." + s[1];
}

function niceDate(v) {
  if (!v) return "\u2014";
  const p = String(v).split("-");
  if (p.length !== 3) return String(v);
  return `${p[2]} ${MON[Number(p[1]) - 1]} ${p[0]}`;
}

/* Column geometry. Right-aligned money columns share one grid so
   every figure on the page lines up under the one above it. */
const COL = {
  idx:    M,
  desc:   M + 24,
  qty:    { x: M + 300, w: 42 },
  unit:   { x: M + 348, w: 78 },
  amount: { x: M + 432, w: CONTENT_W - 432 }
};

function buildInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true,
                                  info: { Title: `Invoice ${inv.number}`,
                                          Author: inv.biz_name || "I7SEVEN MOBILE" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cur  = inv.currency || "LKR";
    const mode = inv.tax_mode || "none";
    const items = inv.items || [];

    /* ---------------- header band ---------------- */
    doc.rect(0, 0, PAGE_W, 96).fill(INK);

    const logo = path.join(__dirname, "..", "public", "logo.png");
    let usedLogo = false;
    try {
      if (fs.existsSync(logo)) { doc.image(logo, M, 26, { width: 132 }); usedLogo = true; }
    } catch { /* fall through to text */ }
    if (!usedLogo) {
      doc.font("Helvetica-BoldOblique").fontSize(23).fillColor(LIME).text("I7SEVEN", M, 30);
    }
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#e8edf4")
       .text("M O B I L E", M + 2, 70, { characterSpacing: 2.4 });

    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#8d99aa")
       .text(mode === "none" ? "INVOICE" : "TAX INVOICE", M, 26,
             { width: CONTENT_W, align: "right", characterSpacing: 2 });
    doc.font("Courier-Bold").fontSize(16).fillColor(LIME)
       .text(inv.number || "", M, 40, { width: CONTENT_W, align: "right" });

    if (mode !== "none" && (inv.vat_no || "").trim()) {
      doc.font("Helvetica-Bold").fontSize(6).fillColor("#8d99aa")
         .text("VAT REG. NO.", M, 64, { width: CONTENT_W, align: "right", characterSpacing: 1.2 });
      doc.font("Courier").fontSize(8.5).fillColor("#e8edf4")
         .text(inv.vat_no, M, 74, { width: CONTENT_W, align: "right" });
    }

    doc.rect(0, 96, PAGE_W, 3).fill(LIME);

    /* ---------------- business block ---------------- */
    /* Phone and email are tappable; the address is plain text. The
       wordmark above already carries the shop name. */
    let y = 122;
    const addr  = (inv.biz_address || "").trim();
    const phone = (inv.biz_phone || "").trim();
    const mail  = (inv.biz_email || "").trim();

    if (addr || phone || mail) {
      doc.font("Helvetica").fontSize(8.5).fillColor(SOFT);
      if (addr) {
        doc.text(addr, M, y, { width: 320, lineGap: 1.5 });
        y = doc.y + 1;
      }
      if (phone || mail) {
        let x = M;
        if (phone) {
          doc.text(phone, x, y, { lineBreak: false, link: telHref(phone) });
          x += doc.widthOfString(phone);
          if (mail) { doc.text("  \u00b7  ", x, y, { lineBreak: false });
                      x += doc.widthOfString("  \u00b7  "); }
        }
        if (mail) doc.text(mail, x, y, { lineBreak: false, link: "mailto:" + mail });
        y += 12;
      }
      y += 12;
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(SOFT)
         .text(inv.biz_lines || "", M, y, { width: 320, lineGap: 1.5 });
      y = doc.y + 14;
    }

    /* ---------------- billed-to strip ---------------- */
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1.4).strokeColor(INK).stroke();
    y += 11;

    let billBottom = y;
    const labelled = (label, value, x, w, mono) => {
      doc.font("Helvetica-Bold").fontSize(6).fillColor(SOFT)
         .text(label.toUpperCase(), x, y, { width: w, characterSpacing: 1.2 });
      doc.font(mono ? "Courier" : "Helvetica").fontSize(9.5).fillColor(TEXT)
         .text(value, x, y + 10, { width: w, lineGap: 1 });
      if (doc.y > billBottom) billBottom = doc.y;
    };

    const billTo = [inv.cust_name || "\u2014", inv.cust_address || "", inv.cust_phone || ""]
      .filter(Boolean).join("\n");
    /* Only show Due when the customer actually owes money later. */
    const showDue = Boolean(inv.due_date) && inv.due_date !== inv.issue_date;
    labelled("Billed to", billTo, M, 280, false);
    labelled("Issued", niceDate(inv.issue_date), showDue ? M + 330 : M + 400, 110, true);
    if (showDue) labelled("Due", niceDate(inv.due_date), M + 440, 110, true);

    y = billBottom + 5;

    if ((inv.cust_nic || "").trim()) {
      const nic = `NIC  ${inv.cust_nic}`;
      const w = doc.font("Courier").fontSize(8.5).widthOfString(nic) + 12;
      doc.roundedRect(M, y, w, 15, 2).lineWidth(0.7)
         .fillAndStroke("#f2f5e3", "#d9e5a0");
      doc.fillColor(TEXT).font("Courier").fontSize(8.5).text(nic, M + 6, y + 4);
      y += 21;
    }

    y += 4;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.7).strokeColor(RULE).stroke();
    y += 16;

    /* ---------------- line items ---------------- */
    const head = (label, x, w, align) =>
      doc.font("Helvetica-Bold").fontSize(6).fillColor(SOFT)
         .text(label.toUpperCase(), x, y, { width: w, align, characterSpacing: 1.1 });

    head("Description", COL.desc, 260, "left");
    head("Qty",        COL.qty.x,    COL.qty.w,    "right");
    head("Unit price", COL.unit.x,   COL.unit.w,   "right");
    head("Amount",     COL.amount.x, COL.amount.w, "right");
    y += 10;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(1).strokeColor(INK).stroke();
    y += 9;

    const BOTTOM = 800;                          // A4 842pt less the 42pt margin
    const pageBreak = (needed) => {
      if (y + needed < BOTTOM) return;
      doc.addPage();
      y = M;
    };

    items.forEach((it, i) => {
      const days = Number(it.warranty_days) || 0;
      const hasImei = (it.imei || "").trim();
      pageBreak(hasImei || days ? 52 : 26);

      const rowTop = y;
      doc.font("Courier").fontSize(7.5).fillColor(SOFT)
         .text(String(i + 1).padStart(2, "0"), COL.idx, y + 1.5, { width: 20 });
      doc.font("Helvetica").fontSize(9.5).fillColor(TEXT)
         .text(it.description || "\u2014", COL.desc, y, { width: 250 });
      let lineY = doc.y;

      if (hasImei) {
        doc.font("Courier").fontSize(7.5).fillColor(SOFT)
           .text(`IMEI  ${it.imei}`, COL.desc, lineY + 2, { width: 250 });
        lineY = doc.y;
      }

      if (days > 0) {
        const t = wt(it.warranty_type);
        const barY = lineY + 4;
        doc.font("Helvetica-Bold").fontSize(7.5);
        const txt = `${t.label} ${days} days  \u00b7  valid to ${niceDate(it.warranty_until)}`;
        const h = doc.heightOfString(txt, { width: 240 });
        doc.rect(COL.desc, barY, 2.2, h).fill(t.colour);
        doc.fillColor(SOFT).text(txt, COL.desc + 7, barY, { width: 240 });
        lineY = doc.y;
      }

      /* money columns sit on the row's first baseline */
      doc.font("Courier").fontSize(9.5).fillColor(TEXT);
      doc.text(String(Number(it.qty) || 0), COL.qty.x,    rowTop, { width: COL.qty.w,    align: "right" });
      doc.text(money(it.unit_price_c),      COL.unit.x,   rowTop, { width: COL.unit.w,   align: "right" });
      doc.text(money(it.amount_c),          COL.amount.x, rowTop, { width: COL.amount.w, align: "right" });

      y = Math.max(lineY, rowTop + 12) + 8;
      doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE_SOFT).stroke();
      y += 9;
    });

    /* ---------------- totals ---------------- */
    pageBreak(140);
    y += 6;
    /* Wide enough for a seven-figure total in Courier-Bold 13pt without
       wrapping. Right edges still line up with the Amount column above. */
    const LAB_X = M + 160, LAB_W = 164;          // ends at M+324
    const VAL_X = M + 330, VAL_W = CONTENT_W - 330;

    const sumRow = (label, value, opts = {}) => {
      if (opts.rule) {
        doc.moveTo(LAB_X, y).lineTo(M + CONTENT_W, y)
           .lineWidth(opts.heavy ? 1.4 : 0.5)
           .strokeColor(opts.heavy ? INK : RULE).stroke();
        y += opts.heavy ? 9 : 6;
      }
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica")
         .fontSize(opts.bold ? 7.5 : 9).fillColor(opts.bold ? TEXT : SOFT)
         .text(opts.bold ? label.toUpperCase() : label, LAB_X, y + (opts.bold ? 3 : 0),
               { width: LAB_W, align: "right", characterSpacing: opts.bold ? 1.1 : 0 });
      doc.font(opts.bold ? "Courier-Bold" : "Courier")
         .fontSize(opts.bold ? 12.5 : 9.5).fillColor(TEXT)
         .text(value, VAL_X, y, { width: VAL_W, align: "right", lineBreak: false });
      y += opts.bold ? 20 : 15;
    };

    sumRow(mode === "incl" ? "Subtotal (VAT inclusive)" : "Subtotal", `${cur} ${money(inv.subtotal_c)}`);
    if (inv.discount_c) sumRow("Discount", `-${cur} ${money(inv.discount_c)}`);

    if (mode === "vat_sscl") {
      if (inv.discount_c) sumRow("Value of goods", `${cur} ${money(inv.net_c)}`, { rule: true });
      sumRow(`SSCL ${Number(inv.sscl_rate) || 0}%`, `${cur} ${money(inv.sscl_c)}`);
      sumRow("Value liable to VAT", `${cur} ${money(inv.taxable_c)}`, { rule: true });
      sumRow(`VAT ${Number(inv.vat_rate) || 0}%`, `${cur} ${money(inv.vat_c)}`);
    } else if (mode === "vat") {
      sumRow(`VAT ${Number(inv.vat_rate) || 0}%`, `${cur} ${money(inv.vat_c)}`);
    }

    sumRow("Total due", `${cur} ${money(inv.total_c)}`, { rule: true, heavy: true, bold: true });

    if (mode === "incl") {
      doc.font("Courier").fontSize(7.5).fillColor(SOFT)
         .text(`Includes VAT ${Number(inv.vat_rate) || 0}% of ${cur} ${money(inv.incl_vat_c)}`,
               LAB_X, y, { width: LAB_W + VAL_W, align: "right" });
      y += 14;
    }

    /* ---------------- warranty ---------------- */
    const wItems = items.filter((it) => Number(it.warranty_days) > 0);
    if (wItems.length || (inv.warranty_text || "").trim()) {
      pageBreak(120);
      y += 14;
      const boxTop = y;

      doc.rect(M, y, CONTENT_W, 16).fill(LIME);
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(INK)
         .text("WARRANTY", M + 10, y + 5, { characterSpacing: 2 });
      y += 24;

      if (wItems.length) {
        const c = { item: M + 10, type: M + 288, days: M + 372, until: M + 412 };
        doc.font("Helvetica-Bold").fontSize(5.8).fillColor(SOFT);
        doc.text("ITEM", c.item, y, { characterSpacing: 1 });
        doc.text("TYPE", c.type, y, { characterSpacing: 1 });
        doc.text("DAYS", c.days, y, { width: 32, align: "right", characterSpacing: 1 });
        doc.text("COVERED UNTIL", c.until, y, { width: 90, align: "right", characterSpacing: 1 });
        y += 9;
        doc.moveTo(M + 10, y).lineTo(M + CONTENT_W - 10, y)
           .lineWidth(0.5).strokeColor(RULE_SOFT).stroke();
        y += 6;

        for (const it of wItems) {
          pageBreak(26);
          const label = (it.description || "") + (it.imei ? `  \u00b7  ${it.imei}` : "");
          doc.font("Helvetica").fontSize(8).fillColor(TEXT)
             .text(label, c.item, y, { width: 270 });
          const rowH = doc.y - y;
          doc.font("Helvetica-Bold").fontSize(6.5).fillColor(SOFT)
             .text(wt(it.warranty_type).short.toUpperCase(), c.type, y + 1,
                   { width: 78, characterSpacing: 0.8 });
          doc.font("Courier").fontSize(8).fillColor(TEXT)
             .text(String(it.warranty_days), c.days, y, { width: 32, align: "right" });
          doc.text(niceDate(it.warranty_until), c.until, y, { width: 90, align: "right" });
          y += Math.max(rowH, 10) + 5;
        }
        y += 2;
      }

      if ((inv.warranty_text || "").trim()) {
        doc.font("Helvetica").fontSize(7.5).fillColor(SOFT)
           .text(inv.warranty_text, M + 10, y, { width: CONTENT_W - 20, lineGap: 1.5 });
        y = doc.y;
      }
      y += 10;
      doc.rect(M, boxTop, CONTENT_W, y - boxTop).lineWidth(0.8).strokeColor(INK).stroke();
      y += 6;
    }

    /* ---------------- terms ---------------- */
    if ((inv.terms || "").trim()) {
      /* Terms and the footer belong together. Measure both and move the
         whole block to the next page rather than splitting it. */
      doc.font("Helvetica").fontSize(7.5);
      const termsH = doc.heightOfString(inv.terms, { width: CONTENT_W, lineGap: 2 });
      pageBreak(12 + 9 + 10 + termsH + 42);
      y += 12;
      doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE).stroke();
      y += 9;
      doc.font("Helvetica-Bold").fontSize(6).fillColor(SOFT)
         .text("TERMS AND CONDITIONS", M, y, { characterSpacing: 1.3 });
      y += 10;
      doc.font("Helvetica").fontSize(7.5).fillColor(SOFT)
         .text(inv.terms, M, y, { width: CONTENT_W, lineGap: 2 });
      y = doc.y;
    }

    /* ---------------- footer ---------------- */
    pageBreak(34);
    y += 16;
    doc.moveTo(M, y).lineTo(M + CONTENT_W, y).lineWidth(0.5).strokeColor(RULE_SOFT).stroke();
    y += 8;
    doc.font("Helvetica").fontSize(8).fillColor(SOFT)
       .text("Thank you for your business.", M, y, { width: 260 });
    doc.font("Courier").fontSize(8).fillColor(SOFT)
       .text((inv.cashier ? `Served by ${inv.cashier}  \u00b7  ` : "") + "info@iseven.lk",
             M + 260, y, { width: CONTENT_W - 260, align: "right" });

    /* page numbers, only when it runs to more than one page */
    const range = doc.bufferedPageRange();
    if (range.count > 1) {
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const keep = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(7).fillColor(SOFT)
           .text(`${inv.number}   \u00b7   Page ${i + 1} of ${range.count}`,
                 M, doc.page.height - 28,
                 { width: CONTENT_W, align: "center", lineBreak: false });
        doc.page.margins.bottom = keep;
      }
    }

    doc.end();
  });
}

async function invoicePdfAttachment(inv) {
  return {
    filename: `${inv.number}.pdf`,
    content: await buildInvoicePdf(inv),
    contentType: "application/pdf"
  };
}

module.exports = { buildInvoicePdf, invoicePdfAttachment };