-- ===========================================================
-- I7SEVEN MOBILE — Supabase / PostgreSQL schema
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to run more than once.
-- ===========================================================

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name  text PRIMARY KEY,
  value bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number        text NOT NULL UNIQUE,

  -- dates are stored as ISO text (YYYY-MM-DD) on purpose: it keeps the
  -- shop's local calendar day intact regardless of any server timezone.
  issue_date    text NOT NULL,
  due_date      text,
  currency      text NOT NULL DEFAULT 'LKR',

  cust_name     text NOT NULL,
  cust_nic      text,
  cust_phone    text,
  cust_address  text,

  tax_mode      text NOT NULL CHECK (tax_mode IN ('none','vat','vat_sscl','incl')),
  vat_rate      numeric(6,3) NOT NULL DEFAULT 0,
  sscl_rate     numeric(6,3) NOT NULL DEFAULT 0,
  vat_no        text,

  biz_name      text,
  biz_lines     text,

  -- all money is stored as integer cents, never floats
  discount_c    bigint NOT NULL DEFAULT 0,
  subtotal_c    bigint NOT NULL,
  net_c         bigint NOT NULL,
  sscl_c        bigint NOT NULL DEFAULT 0,
  taxable_c     bigint NOT NULL,
  vat_c         bigint NOT NULL DEFAULT 0,
  incl_vat_c    bigint NOT NULL DEFAULT 0,
  total_c       bigint NOT NULL,

  warranty_text text,
  terms         text,
  cashier       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id     bigint NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pos            int NOT NULL,
  description    text NOT NULL,
  imei           text,
  warranty_days  int NOT NULL DEFAULT 0,
  warranty_until text,
  qty            numeric(12,3) NOT NULL,
  unit_price_c   bigint NOT NULL,
  amount_c       bigint NOT NULL
);

-- ----------------------------------------------------------
-- Indexes. The NIC and IMEI ones are what make the dashboard
-- lookups fast once you have tens of thousands of rows.
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inv_nic   ON invoices (upper(cust_nic));
CREATE INDEX IF NOT EXISTS idx_inv_date  ON invoices (issue_date);
CREATE INDEX IF NOT EXISTS idx_inv_phone ON invoices (cust_phone);
CREATE INDEX IF NOT EXISTS idx_inv_name  ON invoices (lower(cust_name));
CREATE INDEX IF NOT EXISTS idx_item_imei ON items (imei);
CREATE INDEX IF NOT EXISTS idx_item_inv  ON items (invoice_id);

-- Trigram indexes make partial searches fast — typing the last six
-- digits of an IMEI instead of the whole thing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_item_imei_trgm ON items USING gin (imei gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_inv_nic_trgm   ON invoices USING gin (cust_nic gin_trgm_ops);

-- ===========================================================
-- SECURITY — read this part
--
-- Supabase automatically publishes every table through a public REST
-- API. Without RLS, anyone holding your anon key (which is designed to
-- be public) could download every customer's NIC number and phone.
--
-- Turning RLS on with NO policies closes that door completely: the
-- REST API returns nothing to anyone. Your billing server is unaffected,
-- because it connects straight to Postgres as the database owner, and
-- the owner bypasses RLS.
-- ===========================================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;

-- Belt and braces: also revoke the API roles' table rights.
REVOKE ALL ON invoices, items, settings, counters FROM anon, authenticated;

-- ----------------------------------------------------------
-- Seed data
-- ----------------------------------------------------------
INSERT INTO counters (name, value) VALUES ('invoice', 0)
  ON CONFLICT (name) DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('biz_name',      'I7SEVEN MOBILE'),
  ('biz_lines',     E'Colombo, Sri Lanka\n+94 00 000 0000 \u00b7 info@iseven.lk'),
  ('vat_no',        ''),
  ('number_prefix', 'I7-'),
  ('currency',      'LKR'),
  ('vat_rate',      '18'),
  ('sscl_rate',     '2.5'),
  ('tax_mode',      'none'),
  ('payment_days',  '14'),
  ('warranty_text', 'Warranty covers manufacturing defects only. Physical damage, liquid damage, burn marks and any unauthorised repair void the warranty. The original invoice must be produced to make a claim. Software issues and consumable parts are not covered.'),
  ('terms',         E'Payment is due by the date shown above.\nGoods remain the property of I7SEVEN MOBILE until paid for in full.\nGoods once sold are not returnable or exchangeable except under warranty.\nPlease quote the invoice number with your payment.')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================
-- Added for email delivery. Safe to run on an existing database.
-- ===========================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cust_email    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_status  text NOT NULL DEFAULT 'not_sent';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_error   text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_attempts int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inv_email  ON invoices (lower(cust_email));
CREATE INDEX IF NOT EXISTS idx_inv_estat  ON invoices (email_status);

-- ===========================================================
-- Warranty types (shop / apple_care / company).
-- Safe to run on an existing database.
-- ===========================================================
ALTER TABLE items ADD COLUMN IF NOT EXISTS warranty_type text NOT NULL DEFAULT 'shop';
CREATE INDEX IF NOT EXISTS idx_item_wtype ON items (warranty_type);

-- New installs default to no tax; change it in Settings when you register.
UPDATE settings SET value = 'none' WHERE key = 'tax_mode' AND value = 'vat'
  AND NOT EXISTS (SELECT 1 FROM invoices);
