/* ==========================================================
   I7SEVEN MOBILE — shared client library
   Tax engine, formatting, and the printed-document renderer.
   Used by both the new-invoice page and the dashboard.
   ========================================================== */
(function (global) {
  "use strict";

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  /* Warranty types. "shop" stays the default for accessories and repairs. */
  const WARRANTY_TYPES = {
    shop:       { label: "Warranty",           short: "Shop" },
    apple_care: { label: "AppleCare warranty", short: "AppleCare" },
    company:    { label: "Company warranty",   short: "Company" }
  };
  const warrantyLabel = (t) => (WARRANTY_TYPES[t] || WARRANTY_TYPES.shop).label;
  const warrantyShort = (t) => (WARRANTY_TYPES[t] || WARRANTY_TYPES.shop).short;

  const cents = (n) => Math.round((Number(n) || 0) * 100);

  function money(c) {
    const neg = c < 0; c = Math.abs(Math.round(c || 0));
    const s = (c / 100).toFixed(2).split(".");
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + s[0] + "." + s[1];
  }

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const pad = (n, w) => String(n).padStart(w, "0");

  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  }

  function addDays(isoDate, n) {
    if (!isoDate) return null;
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + Number(n || 0));
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1, 2)}-${pad(dt.getDate(), 2)}`;
  }

  function niceDate(v) {
    if (!v) return "\u2014";
    const p = String(v).split("-");
    if (p.length !== 3) return v;
    return `${p[2]} ${MON[Number(p[1]) - 1]} ${p[0]}`;
  }

  /* -------------------------------------------------------
     Tax engine — mirrors server.js exactly.
       none      total = net
       vat       VAT charged on net
       vat_sscl  SSCL on net first, then VAT on (net + SSCL)
       incl      prices already contain VAT; back it out
  ------------------------------------------------------- */
  function computeTotals(o) {
    let subtotal_c = 0;
    for (const it of (o.items || [])) subtotal_c += Math.round(it.amount_c || 0);

    const discount_c = Math.min(Math.max(0, o.discount_c || 0), subtotal_c);
    const net_c = subtotal_c - discount_c;
    const v = Number(o.vat_rate) || 0;
    const s = Number(o.sscl_rate) || 0;

    let sscl_c = 0, taxable_c = net_c, vat_c = 0, incl_vat_c = 0, total_c = net_c;

    if (o.tax_mode === "vat") {
      vat_c = Math.round(net_c * v / 100);
      total_c = net_c + vat_c;
    } else if (o.tax_mode === "vat_sscl") {
      sscl_c = Math.round(net_c * s / 100);
      taxable_c = net_c + sscl_c;
      vat_c = Math.round(taxable_c * v / 100);
      total_c = taxable_c + vat_c;
    } else if (o.tax_mode === "incl") {
      incl_vat_c = Math.round(net_c * v / (100 + v));
      total_c = net_c;
    }
    return { subtotal_c, discount_c, net_c, sscl_c, taxable_c, vat_c, incl_vat_c, total_c };
  }

  const TAX_NOTES = {
    none:     "No tax added. The total is simply the value of the goods. The VAT number is left off the invoice.",
    vat:      "<b>VAT</b> is added on top of the item value.<br>Total = Value + VAT",
    vat_sscl: "<b>SSCL is calculated first</b> on the item value. VAT is then charged on the value <i>plus</i> the SSCL.<br>Total = Value + SSCL + VAT&nbsp;on&nbsp;(Value&nbsp;+&nbsp;SSCL)",
    incl:     "Item prices <b>already contain VAT</b>. Nothing is added \u2014 the VAT portion is shown separately for the customer's records."
  };

  /* -------------------------------------------------------
     Document renderer
     Accepts a normalised invoice and returns the paper HTML.
  ------------------------------------------------------- */
  /* A counter sale is settled on the spot, so a due date pointing at the
     same day is noise. Show it only when the customer genuinely owes
     money later. */
  const showDue = (d) => Boolean(d.due_date) && d.due_date !== d.issue_date;

  const telHref = (phone) => "tel:" + String(phone || "").replace(/[^\d+]/g, "");

  /* Address as plain text; phone and email tappable. */
  function contactBlock(d) {
    const rows = [];
    if ((d.biz_address || "").trim()) {
      rows.push(`<div class="c-row">${esc(d.biz_address)}</div>`);
    }
    const line2 = [];
    if ((d.biz_phone || "").trim()) {
      line2.push(`<a class="c-row" href="${esc(telHref(d.biz_phone))}">${esc(d.biz_phone)}</a>`);
    }
    if ((d.biz_email || "").trim()) {
      line2.push(`<a class="c-row" href="mailto:${esc(d.biz_email)}">${esc(d.biz_email)}</a>`);
    }
    if (!rows.length && !line2.length) return `<div class="biz">${esc(d.biz_lines || "")}</div>`;
    return `<div class="biz">${rows.join("")}${line2.length ? `<div class="c-line">${line2.join('<span class="c-sep">\u00b7</span>')}</div>` : ""}</div>`;
  }

  function renderPaper(d) {
    const cur = d.currency || "";
    const mode = d.tax_mode || "none";
    const t = d.totals || computeTotals(d);
    const items = (d.items || []);

    /* --- head band: VAT number only appears when a tax type is selected --- */
    const vatBlock = (mode !== "none" && (d.vat_no || "").trim())
      ? `<div class="vatno">VAT Reg. No.<b>${esc(d.vat_no)}</b></div>`
      : "";

    const head = `
      <div class="head-band">
        <div class="mark">
          <img src="logo.png" alt="I7SEVEN">
          <div class="sub">Mobile</div>
        </div>
        <div class="doc">
          <div class="word">${mode === "none" ? "Invoice" : "Tax invoice"}</div>
          <div class="num">${esc(d.number || "\u2014")}</div>
          ${vatBlock}
        </div>
      </div>
      <div class="lime-rule"></div>`;

    /* --- billed-to, including NIC --- */
    const custLines = [d.cust_name || "\u2014", d.cust_address || "", d.cust_phone || ""]
      .filter(Boolean).join("\n");
    const nicChip = (d.cust_nic || "").trim()
      ? `<div class="nic-chip"><span>NIC</span>${esc(d.cust_nic)}</div>`
      : "";

    /* --- line items --- */
    let lines;
    if (!items.length) {
      lines = `<tr><td colspan="5" class="empty-note">Add an item and it appears here.</td></tr>`;
    } else {
      lines = items.map((it, i) => {
        const days = Number(it.warranty_days) || 0;
        const until = it.warranty_until || (days ? addDays(d.issue_date, days) : null);
        const imei = (it.imei || "").trim()
          ? `<span class="imei-line">IMEI <b>${esc(it.imei)}</b></span>` : "";
        const w = days > 0
          ? `<span class="wtag ${esc(it.warranty_type || "shop")}">${esc(warrantyLabel(it.warranty_type))} <b>${days}</b> days \u00b7 valid to ${niceDate(until)}</span>` : "";
        return `<tr>
          <td class="idx">${pad(i + 1, 2)}</td>
          <td class="desc">${esc(it.description || "\u2014")}${imei}${w ? "<br>" + w : ""}</td>
          <td class="r">${Number(it.qty) || 0}</td>
          <td class="r">${money(it.unit_price_c)}</td>
          <td class="r">${money(it.amount_c)}</td>
        </tr>`;
      }).join("");
    }

    /* --- totals --- */
    let rows = "";
    rows += `<tr><td class="lab">${mode === "incl" ? "Subtotal (VAT inclusive)" : "Subtotal"}</td>
             <td class="val">${cur} ${money(t.subtotal_c)}</td></tr>`;
    if (t.discount_c) {
      rows += `<tr><td class="lab">Discount</td><td class="val">-${cur} ${money(t.discount_c)}</td></tr>`;
    }
    if (mode === "vat_sscl") {
      if (t.discount_c) {
        rows += `<tr class="sep"><td class="lab">Value of goods</td><td class="val">${cur} ${money(t.net_c)}</td></tr>`;
      }
      rows += `<tr><td class="lab">SSCL ${Number(d.sscl_rate) || 0}%</td><td class="val">${cur} ${money(t.sscl_c)}</td></tr>`;
      rows += `<tr class="sep"><td class="lab">Value liable to VAT</td><td class="val">${cur} ${money(t.taxable_c)}</td></tr>`;
      rows += `<tr><td class="lab">VAT ${Number(d.vat_rate) || 0}%</td><td class="val">${cur} ${money(t.vat_c)}</td></tr>`;
    } else if (mode === "vat") {
      rows += `<tr><td class="lab">VAT ${Number(d.vat_rate) || 0}%</td><td class="val">${cur} ${money(t.vat_c)}</td></tr>`;
    }
    rows += `<tr class="grand"><td class="lab">Total due</td><td class="val">${cur} ${money(t.total_c)}</td></tr>`;

    const inclNote = mode === "incl"
      ? `<div class="vat-incl-note">Includes VAT ${Number(d.vat_rate) || 0}% of ${cur} ${money(t.incl_vat_c)}</div>`
      : "";

    /* --- warranty panel --- */
    const wItems = items.filter((it) => (Number(it.warranty_days) || 0) > 0);
    let warranty = "";
    if (wItems.length || (d.warranty_text || "").trim()) {
      const wt = wItems.length ? `<table>
          <tr><th>Item</th><th>Type</th><th class="r">Days</th><th class="r">Covered until</th></tr>
          ${wItems.map((it) => {
            const until = it.warranty_until || addDays(d.issue_date, it.warranty_days);
            const label = esc(it.description) + ((it.imei || "").trim() ? ` \u00b7 ${esc(it.imei)}` : "");
            return `<tr><td>${label}</td><td class="wtype">${esc(warrantyShort(it.warranty_type))}</td><td class="r">${Number(it.warranty_days)}</td><td class="r">${niceDate(until)}</td></tr>`;
          }).join("")}
        </table>` : "";
      warranty = `<div class="warranty">
          <div class="wh">Warranty</div>
          <div class="wb">${wt}<p>${esc(d.warranty_text || "")}</p></div>
        </div>`;
    }

    const terms = (d.terms || "").trim()
      ? `<div class="terms"><h3>Terms and conditions</h3><p>${esc(d.terms)}</p></div>` : "";

    const footer = `<div class="footline">
        <div>Thank you for your business.</div>
        <div class="mono">${d.cashier ? "Served by " + esc(d.cashier) + " \u00b7 " : ""}info@iseven.lk</div>
      </div>`;

    return `${head}
      <div class="pbody">
        ${contactBlock(d)}
        <div class="inv-meta">
          <div class="meta-cell bill">
            <div class="k">Billed to</div>
            <div class="v">${esc(custLines)}</div>
            ${nicChip}
          </div>
          <div class="meta-cell"><div class="k">Issued</div><div class="v mono">${niceDate(d.issue_date)}</div></div>
          ${showDue(d) ? `<div class="meta-cell"><div class="k">Due</div><div class="v mono">${niceDate(d.due_date)}</div></div>` : ""}
        </div>
        <table class="lines">
          <thead><tr><th></th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <div class="sums"><table><tbody>${rows}</tbody></table></div>
        ${inclNote}
        ${warranty}
        ${terms}
        ${footer}
      </div>`;
  }

  /* -------------------------------------------------------
     Tiny fetch helper
  ------------------------------------------------------- */
  async function api(url, opts) {
    const res = await fetch(url, Object.assign({
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin"
    }, opts));
    if (res.status === 401) {
      location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
      throw new Error("Signing in\u2026");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  global.I7 = { cents, money, esc, pad, isoToday, addDays, niceDate,
                computeTotals, TAX_NOTES, renderPaper, api,
                WARRANTY_TYPES, warrantyLabel, warrantyShort };
})(window);
