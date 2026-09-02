/* =========================================================
   I7SEVEN MOBILE — SQLite backend

   Same interface as store-pg.js. Requires nothing but Node 22:
   no server to install, no account, no connection string.
   Used automatically when DATABASE_URL is not set.
   ========================================================= */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const S = require("./shared.js");

const DATA = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA, { recursive: true });
const FILE = process.env.SQLITE_FILE || path.join(DATA, "billing.db");

const db = new DatabaseSync(FILE);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  number        TEXT NOT NULL UNIQUE,
  issue_date    TEXT NOT NULL,
  due_date      TEXT,
  currency      TEXT NOT NULL DEFAULT 'LKR',
  cust_name     TEXT NOT NULL,
  cust_nic      TEXT,
  cust_phone    TEXT,
  cust_address  TEXT,
  cust_email    TEXT,
  tax_mode      TEXT NOT NULL,
  vat_rate      REAL NOT NULL DEFAULT 0,
  sscl_rate     REAL NOT NULL DEFAULT 0,
  vat_no        TEXT,
  biz_name      TEXT,
  biz_lines     TEXT,
  discount_c    INTEGER NOT NULL DEFAULT 0,
  subtotal_c    INTEGER NOT NULL,
  net_c         INTEGER NOT NULL,
  sscl_c        INTEGER NOT NULL DEFAULT 0,
  taxable_c     INTEGER NOT NULL,
  vat_c         INTEGER NOT NULL DEFAULT 0,
  incl_vat_c    INTEGER NOT NULL DEFAULT 0,
  total_c       INTEGER NOT NULL,
  warranty_text TEXT,
  terms         TEXT,
  cashier       TEXT,
  email_status  TEXT NOT NULL DEFAULT 'not_sent',
  email_sent_at TEXT,
  email_error   TEXT,
  email_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id     INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pos            INTEGER NOT NULL,
  description    TEXT NOT NULL,
  imei           TEXT,
  warranty_type  TEXT NOT NULL DEFAULT 'shop',
  warranty_days  INTEGER NOT NULL DEFAULT 0,
  warranty_until TEXT,
  qty            REAL NOT NULL,
  unit_price_c   INTEGER NOT NULL,
  amount_c       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inv_nic   ON invoices(cust_nic);
CREATE INDEX IF NOT EXISTS idx_inv_date  ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_inv_phone ON invoices(cust_phone);
CREATE INDEX IF NOT EXISTS idx_inv_email ON invoices(cust_email);
CREATE INDEX IF NOT EXISTS idx_item_imei ON items(imei);
CREATE INDEX IF NOT EXISTS idx_item_inv  ON items(invoice_id);
`);

/* Databases created before email support get the columns added. */
const icols = new Set(db.prepare("PRAGMA table_info(items)").all().map((r) => r.name));
if (!icols.has("warranty_type")) {
  db.exec("ALTER TABLE items ADD COLUMN warranty_type TEXT NOT NULL DEFAULT 'shop'");
}

const cols = new Set(db.prepare("PRAGMA table_info(invoices)").all().map((r) => r.name));
for (const [name, ddl] of [
  ["cust_email",     "ALTER TABLE invoices ADD COLUMN cust_email TEXT"],
  ["email_status",   "ALTER TABLE invoices ADD COLUMN email_status TEXT NOT NULL DEFAULT 'not_sent'"],
  ["email_sent_at",  "ALTER TABLE invoices ADD COLUMN email_sent_at TEXT"],
  ["email_error",    "ALTER TABLE invoices ADD COLUMN email_error TEXT"],
  ["email_attempts", "ALTER TABLE invoices ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0"]
]) {
  if (!cols.has(name)) db.exec(ddl);
}

const insSetting = db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)");
for (const [k, v] of Object.entries(S.DEFAULT_SETTINGS)) insSetting.run(k, v);
db.prepare("INSERT OR IGNORE INTO counters(name,value) VALUES('invoice',0)").run();

/* ---------------------------------------------------------
   Settings
--------------------------------------------------------- */
function getSettings() {
  const out = Object.assign({}, S.DEFAULT_SETTINGS);
  for (const r of db.prepare("SELECT key,value FROM settings").all()) out[r.key] = r.value;
  return out;
}

function putSettings(body) {
  const up = db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
                         ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  db.exec("BEGIN");
  try {
    for (const [k, v] of Object.entries(body || {})) {
      if (k in S.DEFAULT_SETTINGS) up.run(k, String(v));
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return getSettings();
}

/* ---------------------------------------------------------
   Create
--------------------------------------------------------- */
function createInvoice(body) {
  const st = getSettings();
  const n = S.normaliseInvoice(body);

  const ins = db.prepare(`
    INSERT INTO invoices (
      number, issue_date, due_date, currency,
      cust_name, cust_nic, cust_phone, cust_address, cust_email,
      tax_mode, vat_rate, sscl_rate, vat_no,
      biz_name, biz_lines,
      discount_c, subtotal_c, net_c, sscl_c, taxable_c, vat_c, incl_vat_c, total_c,
      warranty_text, terms, cashier, created_at
    ) VALUES (?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?,?,?,?, ?,?,?,?)`);

  const insItem = db.prepare(`
    INSERT INTO items (invoice_id,pos,description,imei,warranty_type,warranty_days,
                       warranty_until,qty,unit_price_c,amount_c)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE counters SET value = value + 1 WHERE name='invoice'").run();
    const seq = db.prepare("SELECT value FROM counters WHERE name='invoice'").get().value;
    const number = (st.number_prefix || "I7-") + S.pad(seq, 4);

    const info = ins.run(
      number, n.issue_date, n.due_date, n.currency || st.currency,
      n.cust_name, n.cust_nic, n.cust_phone, n.cust_address, n.cust_email,
      n.tax_mode, n.vat_rate, n.sscl_rate,
      n.tax_mode === "none" ? null : ((n.vat_no_raw || st.vat_no || "") || null),
      st.biz_name, st.biz_lines,
      n.totals.discount_c, n.totals.subtotal_c, n.totals.net_c, n.totals.sscl_c,
      n.totals.taxable_c, n.totals.vat_c, n.totals.incl_vat_c, n.totals.total_c,
      n.warranty_text ?? st.warranty_text,
      n.terms ?? st.terms,
      n.cashier, new Date().toISOString()
    );

    const id = Number(info.lastInsertRowid);
    for (const it of n.items) {
      insItem.run(id, it.pos, it.description, it.imei, it.warranty_type,
                  it.warranty_days, it.warranty_until, it.qty,
                  it.unit_price_c, it.amount_c);
    }
    db.exec("COMMIT");
    return { id, number, cust_email: n.cust_email };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/* ---------------------------------------------------------
   Reads
--------------------------------------------------------- */
function getInvoice(id) {
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id);
  if (!inv) return null;
  inv.items = db.prepare("SELECT * FROM items WHERE invoice_id = ? ORDER BY pos").all(id);
  return inv;
}

function searchInvoices({ q, field, from, to, limit }) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const where = [], args = [];
  const like = `%${(q || "").trim()}%`;

  if ((q || "").trim()) {
    if (field === "nic")         { where.push("i.cust_nic LIKE ?"); args.push(like); }
    else if (field === "imei")   { where.push("EXISTS (SELECT 1 FROM items x WHERE x.invoice_id = i.id AND x.imei LIKE ?)"); args.push(like); }
    else if (field === "number") { where.push("i.number LIKE ?"); args.push(like); }
    else if (field === "name")   { where.push("i.cust_name LIKE ?"); args.push(like); }
    else {
      where.push(`(i.cust_nic LIKE ? OR i.number LIKE ? OR i.cust_name LIKE ? OR i.cust_phone LIKE ?
        OR i.cust_email LIKE ?
        OR EXISTS (SELECT 1 FROM items x WHERE x.invoice_id = i.id AND x.imei LIKE ?))`);
      args.push(like, like, like, like, like, like);
    }
  }
  if (from) { where.push("i.issue_date >= ?"); args.push(from); }
  if (to)   { where.push("i.issue_date <= ?"); args.push(to); }

  return db.prepare(`
    SELECT i.id, i.number, i.issue_date, i.currency, i.cust_name, i.cust_nic,
           i.cust_phone, i.cust_email, i.email_status, i.tax_mode, i.total_c,
           (SELECT COUNT(*) FROM items x WHERE x.invoice_id = i.id) AS item_count,
           (SELECT GROUP_CONCAT(x.imei, ', ') FROM items x
              WHERE x.invoice_id = i.id AND x.imei IS NOT NULL) AS imeis
    FROM invoices i
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY i.id DESC
    LIMIT ${lim}`).all(...args);
}

function stats() {
  const today = S.todayIso();
  const month = today.slice(0, 7);
  const one = (sql, ...a) => db.prepare(sql).get(...a);

  const d = one("SELECT COUNT(*) n, COALESCE(SUM(total_c),0) t FROM invoices WHERE issue_date = ?", today);
  const m = one(`SELECT COUNT(*) n, COALESCE(SUM(total_c),0) t,
                        COALESCE(SUM(vat_c),0) v, COALESCE(SUM(sscl_c),0) s
                 FROM invoices WHERE substr(issue_date,1,7) = ?`, month);
  const a = one("SELECT COUNT(*) n FROM invoices");
  const w = one(`SELECT COUNT(*) n FROM items
                 WHERE warranty_until IS NOT NULL AND warranty_until >= ?`, today);

  return {
    today_count: d.n, today_total_c: d.t,
    month_count: m.n, month_total_c: m.t, month_vat_c: m.v, month_sscl_c: m.s,
    all_count: a.n, active_warranties: w.n,
    currency: getSettings().currency
  };
}

/* Editing keeps the invoice number and issue date. Only an admin can
   reach this, and the original number is never reissued. */
function updateInvoice(id, body) {
  const st = getSettings();
  const existing = db.prepare("SELECT number, issue_date FROM invoices WHERE id = ?").get(id);
  if (!existing) throw new Error("Invoice not found");

  const n = S.normaliseInvoice(Object.assign({}, body, { issue_date: body.issue_date || existing.issue_date }));

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE invoices SET
        issue_date=?, due_date=?, currency=?,
        cust_name=?, cust_nic=?, cust_phone=?, cust_address=?, cust_email=?,
        tax_mode=?, vat_rate=?, sscl_rate=?, vat_no=?,
        discount_c=?, subtotal_c=?, net_c=?, sscl_c=?, taxable_c=?,
        vat_c=?, incl_vat_c=?, total_c=?,
        warranty_text=?, terms=?, cashier=?
      WHERE id=?`).run(
      n.issue_date, n.due_date, n.currency || st.currency,
      n.cust_name, n.cust_nic, n.cust_phone, n.cust_address, n.cust_email,
      n.tax_mode, n.vat_rate, n.sscl_rate,
      n.tax_mode === "none" ? null : ((n.vat_no_raw || st.vat_no || "") || null),
      n.totals.discount_c, n.totals.subtotal_c, n.totals.net_c, n.totals.sscl_c,
      n.totals.taxable_c, n.totals.vat_c, n.totals.incl_vat_c, n.totals.total_c,
      n.warranty_text ?? st.warranty_text, n.terms ?? st.terms, n.cashier, id);

    db.prepare("DELETE FROM items WHERE invoice_id = ?").run(id);
    const insItem = db.prepare(`
      INSERT INTO items (invoice_id,pos,description,imei,warranty_type,warranty_days,
                         warranty_until,qty,unit_price_c,amount_c)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const it of n.items) {
      insItem.run(id, it.pos, it.description, it.imei, it.warranty_type,
                  it.warranty_days, it.warranty_until, it.qty,
                  it.unit_price_c, it.amount_c);
    }
    db.exec("COMMIT");
    return { id, number: existing.number, cust_email: n.cust_email };
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

function deleteInvoice(id) {
  const row = db.prepare("SELECT number FROM invoices WHERE id = ?").get(id);
  if (!row) throw new Error("Invoice not found");
  db.prepare("DELETE FROM invoices WHERE id = ?").run(id);
  return { deleted: true, number: row.number };
}

function recordEmail(id, status, error) {
  db.prepare(`UPDATE invoices
                 SET email_status = ?, email_error = ?,
                     email_attempts = email_attempts + 1,
                     email_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE email_sent_at END
               WHERE id = ?`)
    .run(status, error || null, status, new Date().toISOString(), id);
}

function healthCheck() {
  db.prepare("SELECT 1 FROM counters WHERE name='invoice'").get();
}

const describe = () => `SQLite  ${FILE}`;

/* Async wrappers so the interface matches the Postgres backend exactly. */
module.exports = {
  getSettings:    async () => getSettings(),
  putSettings:    async (b) => putSettings(b),
  createInvoice:  async (b) => createInvoice(b),
  updateInvoice:  async (id, b) => updateInvoice(id, b),
  deleteInvoice:  async (id) => deleteInvoice(id),
  getInvoice:     async (id) => getInvoice(id),
  searchInvoices: async (o) => searchInvoices(o),
  stats:          async () => stats(),
  recordEmail:    async (id, s, e) => recordEmail(id, s, e),
  healthCheck:    async () => healthCheck(),
  describe
};
