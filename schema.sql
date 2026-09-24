-- ===========================================================
-- I7SEVEN MOBILES — Supabase / PostgreSQL schema
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
  ('biz_name',              'I7SEVEN MOBILES'),
  ('biz_lines',             E'No. 63, First Floor, Liberty Plaza, Colombo 03\n+94 77 311 1999 · info@iseven.lk'),
  ('biz_address',           'No. 63, First Floor, Liberty Plaza, Colombo 03'),
  ('biz_phone',             '+94 77 311 1999'),
  ('biz_email',             'info@iseven.lk'),
  ('vat_no',                ''),
  ('number_prefix',         'I7-'),
  ('currency',              'LKR'),
  ('vat_rate',              '18'),
  ('sscl_rate',             '2.5'),
  ('tax_mode',              'none'),
  ('payment_days',          '14'),
  ('warranty_type_default', 'apple_care'),
  ('warranty_text',         E'!Warranty Shipping at No Additional Cost: Simply hand over your device at our showroom, and we’ll take care of the LKR 25,000 shipping cost.\nScope & Eligibility: This warranty is non-transferable and applies strictly to the original purchaser named on this invoice. The original invoice must be produced for every claim.\nClaim Window: Warranty claims must be handed over to us no later than 14 days before the warranty end date shown above. Devices brought in during the final 14 days cannot be accepted, as there must be sufficient cover remaining for the claim to be processed.\nService Provider: All Apple warranty claims are processed through Apple Authorized Service Providers.\nReplacement Policy: Replacements cover only the defective unit or the individual part, such as an earpiece, and never a full retail boxed set. MacBooks are serviced by replacing the defective component rather than the entire device.\nProcessing & Support: Claim processing may take 45 days or longer. Loan devices are not provided under any circumstances.\nWarranty Exclusions: Physical damage, liquid contact and burn damage void the warranty entirely. Display and touch-related hardware faults are excluded from coverage.\nSoftware & Modifications: Coverage applies only to official operating system firmware. Jailbreaking or rooting the device cancels all warranty coverage immediately.\nAccessories & Battery: Battery, charger, data cable and handsfree carry a limited 6-month warranty.\nFinal Authority: Devices requiring user-direct claim handling must be taken directly to an Apple Authorized Service Provider. All decisions made by Apple are final.'),
  ('terms',                 '')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================
-- Added for email delivery. Safe to run on an existing database.
-- ===========================================================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cust_email    text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_status  text NOT NULL DEFAULT 'not_sent';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_error   text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_attempts int NOT NULL DEFAULT 0;
-- Delivery result reported back by Brevo's webhook.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_message_id  text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS email_delivered_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_inv_emsgid ON invoices (email_message_id);

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

-- ===========================================================
-- Per-item expiry choice, and pack contents: the things inside a
-- bundle, listed on the invoice without individual prices.
-- Safe to run on an existing database.
-- ===========================================================
ALTER TABLE items ADD COLUMN IF NOT EXISTS show_expiry boolean NOT NULL DEFAULT true;
ALTER TABLE items ADD COLUMN IF NOT EXISTS show_days   boolean NOT NULL DEFAULT true;
ALTER TABLE items ADD COLUMN IF NOT EXISTS pack_items  text;
