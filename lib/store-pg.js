/* =========================================================
   I7SEVEN MOBILE — PostgreSQL / Supabase backend
   Same interface as store-sqlite.js.
   ========================================================= */
"use strict";

const { Pool } = require("pg");
const S = require("./shared.js");

function getPool() {
  if (!globalThis.__i7pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    globalThis.__i7pool = new Pool({
      connectionString: url,
      ssl: /supabase|amazonaws|render|neon/.test(url) ? { rejectUnauthorized: false } : false,
      max: Number(process.env.PG_MAX || 5),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });
    globalThis.__i7pool.on("error", (e) => console.error("Postgres pool error:", e.message));
  }
  return globalThis.__i7pool;
}
const q = (text, params) => getPool().query(text, params);
const num = S.num;

const NUM_COLS = ["discount_c","subtotal_c","net_c","sscl_c","taxable_c","vat_c",
                  "incl_vat_c","total_c","unit_price_c","amount_c","id","invoice_id",
                  "item_count","warranty_days","qty","pos","vat_rate","sscl_rate",
                  "email_attempts"];
function coerce(row) {
  if (!row) return row;
  for (const k of NUM_COLS) if (k in row && row[k] !== null) row[k] = num(row[k]);
  return row;
}

async function getSettings() {
  const { rows } = await q("SELECT key, value FROM settings");
  const out = Object.assign({}, S.DEFAULT_SETTINGS);
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function putSettings(body) {
  for (const [k, v] of Object.entries(body || {})) {
    if (!(k in S.DEFAULT_SETTINGS)) continue;
    await q(`INSERT INTO settings(key,value) VALUES($1,$2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, String(v)]);
  }
  return getSettings();
}

async function createInvoice(body) {
  const st = await getSettings();
  const n = S.normaliseInvoice(body);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT value FROM counters WHERE name = 'invoice' FOR UPDATE");
    if (!lock.rows.length) throw new Error("Counter row missing. Run schema.sql first.");
    const seq = num(lock.rows[0].value) + 1;
    await client.query("UPDATE counters SET value = $1 WHERE name = 'invoice'", [seq]);
    const number = (st.number_prefix || "I7-") + S.pad(seq, 4);

    const inv = await client.query(`
      INSERT INTO invoices (
        number, issue_date, due_date, currency,
        cust_name, cust_nic, cust_phone, cust_address, cust_email,
        tax_mode, vat_rate, sscl_rate, vat_no,
        biz_name, biz_lines,
        discount_c, subtotal_c, net_c, sscl_c, taxable_c, vat_c, incl_vat_c, total_c,
        warranty_text, terms, cashier, show_warranty_expiry
      ) VALUES ($1,$2,$3,$4, $5,$6,$7,$8,$9, $10,$11,$12,$13, $14,$15,
                $16,$17,$18,$19,$20,$21,$22,$23, $24,$25,$26,$27)
      RETURNING id, number`, [
      number, n.issue_date, n.due_date, n.currency || st.currency,
      n.cust_name, n.cust_nic, n.cust_phone, n.cust_address, n.cust_email,
      n.tax_mode, n.vat_rate, n.sscl_rate,
      n.tax_mode === "none" ? null : ((n.vat_no_raw || st.vat_no || "") || null),
      st.biz_name, st.biz_lines,
      n.totals.discount_c, n.totals.subtotal_c, n.totals.net_c, n.totals.sscl_c,
      n.totals.taxable_c, n.totals.vat_c, n.totals.incl_vat_c, n.totals.total_c,
      n.warranty_text ?? st.warranty_text, n.terms ?? st.terms, n.cashier,
      n.show_warranty_expiry
    ]);

    const invId = inv.rows[0].id;
    const vals = [];
    const ph = n.items.map((it, i) => {
      const b = i * 10;
      vals.push(invId, it.pos, it.description, it.imei, it.warranty_type,
                it.warranty_days, it.warranty_until, it.qty, it.unit_price_c, it.amount_c);
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`;
    }).join(",");
    await client.query(`INSERT INTO items (invoice_id,pos,description,imei,warranty_type,
                        warranty_days,warranty_until,qty,unit_price_c,amount_c) VALUES ${ph}`, vals);

    await client.query("COMMIT");
    return { id: num(invId), number: inv.rows[0].number, cust_email: n.cust_email };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* Editing keeps the invoice number and never reissues it. */
async function updateInvoice(id, body) {
  const st = await getSettings();
  const cur = await q("SELECT number, issue_date FROM invoices WHERE id = $1", [id]);
  if (!cur.rows.length) throw new Error("Invoice not found");

  const n = S.normaliseInvoice(Object.assign({}, body,
    { issue_date: body.issue_date || cur.rows[0].issue_date }));

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      UPDATE invoices SET
        issue_date=$1, due_date=$2, currency=$3,
        cust_name=$4, cust_nic=$5, cust_phone=$6, cust_address=$7, cust_email=$8,
        tax_mode=$9, vat_rate=$10, sscl_rate=$11, vat_no=$12,
        discount_c=$13, subtotal_c=$14, net_c=$15, sscl_c=$16, taxable_c=$17,
        vat_c=$18, incl_vat_c=$19, total_c=$20,
        warranty_text=$21, terms=$22, cashier=$23, show_warranty_expiry=$25
      WHERE id=$24`, [
      n.issue_date, n.due_date, n.currency || st.currency,
      n.cust_name, n.cust_nic, n.cust_phone, n.cust_address, n.cust_email,
      n.tax_mode, n.vat_rate, n.sscl_rate,
      n.tax_mode === "none" ? null : ((n.vat_no_raw || st.vat_no || "") || null),
      n.totals.discount_c, n.totals.subtotal_c, n.totals.net_c, n.totals.sscl_c,
      n.totals.taxable_c, n.totals.vat_c, n.totals.incl_vat_c, n.totals.total_c,
      n.warranty_text ?? st.warranty_text, n.terms ?? st.terms, n.cashier, id,
      n.show_warranty_expiry]);

    await client.query("DELETE FROM items WHERE invoice_id = $1", [id]);
    const vals = [];
    const ph = n.items.map((it, i) => {
      const b = i * 10;
      vals.push(id, it.pos, it.description, it.imei, it.warranty_type,
                it.warranty_days, it.warranty_until, it.qty, it.unit_price_c, it.amount_c);
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`;
    }).join(",");
    await client.query(`INSERT INTO items (invoice_id,pos,description,imei,warranty_type,
                        warranty_days,warranty_until,qty,unit_price_c,amount_c) VALUES ${ph}`, vals);

    await client.query("COMMIT");
    return { id: num(id), number: cur.rows[0].number, cust_email: n.cust_email };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function deleteInvoice(id) {
  const r = await q("DELETE FROM invoices WHERE id = $1 RETURNING number", [id]);
  if (!r.rows.length) throw new Error("Invoice not found");
  return { deleted: true, number: r.rows[0].number };
}

async function getInvoice(id) {
  const { rows } = await q("SELECT * FROM invoices WHERE id = $1", [id]);
  if (!rows.length) return null;
  const inv = coerce(rows[0]);
  const it = await q("SELECT * FROM items WHERE invoice_id = $1 ORDER BY pos", [id]);
  inv.items = it.rows.map(coerce);
  return inv;
}

async function searchInvoices({ q: term, field, from, to, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const where = [], args = [];
  const add = (v) => { args.push(v); return "$" + args.length; };
  const like = `%${(term || "").trim()}%`;

  if ((term || "").trim()) {
    if (field === "nic")         where.push(`i.cust_nic ILIKE ${add(like)}`);
    else if (field === "imei")   where.push(`EXISTS (SELECT 1 FROM items x WHERE x.invoice_id = i.id AND x.imei ILIKE ${add(like)})`);
    else if (field === "number") where.push(`i.number ILIKE ${add(like)}`);
    else if (field === "name")   where.push(`i.cust_name ILIKE ${add(like)}`);
    else {
      const p = add(like);
      where.push(`(i.cust_nic ILIKE ${p} OR i.number ILIKE ${p} OR i.cust_name ILIKE ${p}
        OR i.cust_phone ILIKE ${p} OR i.cust_email ILIKE ${p}
        OR EXISTS (SELECT 1 FROM items x WHERE x.invoice_id = i.id AND x.imei ILIKE ${p}))`);
    }
  }
  if (from) where.push(`i.issue_date >= ${add(from)}`);
  if (to)   where.push(`i.issue_date <= ${add(to)}`);

  const { rows } = await q(`
    SELECT i.id, i.number, i.issue_date, i.currency, i.cust_name, i.cust_nic,
           i.cust_phone, i.cust_email, i.email_status, i.tax_mode, i.total_c,
           (SELECT COUNT(*) FROM items x WHERE x.invoice_id = i.id) AS item_count,
           (SELECT string_agg(x.imei, ', ' ORDER BY x.pos) FROM items x
              WHERE x.invoice_id = i.id AND x.imei IS NOT NULL) AS imeis
    FROM invoices i
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY i.id DESC
    LIMIT ${lim}`, args);
  return rows.map(coerce);
}

async function stats() {
  const today = S.todayIso();
  const month = today.slice(0, 7);
  const d = await q("SELECT COUNT(*) n, COALESCE(SUM(total_c),0) t FROM invoices WHERE issue_date = $1", [today]);
  const m = await q(`SELECT COUNT(*) n, COALESCE(SUM(total_c),0) t,
                            COALESCE(SUM(vat_c),0) v, COALESCE(SUM(sscl_c),0) s
                     FROM invoices WHERE left(issue_date,7) = $1`, [month]);
  const a = await q("SELECT COUNT(*) n FROM invoices");
  const w = await q(`SELECT COUNT(*) n FROM items
                     WHERE warranty_until IS NOT NULL AND warranty_until >= $1`, [today]);
  const st = await getSettings();
  return {
    today_count: num(d.rows[0].n), today_total_c: num(d.rows[0].t),
    month_count: num(m.rows[0].n), month_total_c: num(m.rows[0].t),
    month_vat_c: num(m.rows[0].v), month_sscl_c: num(m.rows[0].s),
    all_count: num(a.rows[0].n), active_warranties: num(w.rows[0].n),
    currency: st.currency
  };
}

async function recordEmail(id, status, error) {
  await q(`UPDATE invoices
              SET email_status = $2, email_error = $3,
                  email_attempts = email_attempts + 1,
                  email_sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE email_sent_at END
            WHERE id = $1`, [id, status, error || null]);
}

async function healthCheck() { await q("SELECT 1 FROM counters WHERE name = 'invoice'"); }

const describe = () => {
  const u = process.env.DATABASE_URL || "";
  const host = (u.match(/@([^:/?]+)/) || [])[1] || "unknown host";
  return `PostgreSQL  ${host}`;
};

module.exports = { getPool, getSettings, putSettings, createInvoice, updateInvoice,
                   deleteInvoice, getInvoice, searchInvoices, stats, recordEmail,
                   healthCheck, describe };
