# I7SEVEN MOBILE — Billing system

Invoicing with a database, a dashboard, and lookup by NIC or IMEI.
No npm packages, no build step, no paid services.

## Requirements

Node 22 or newer. That is the only requirement — the database is SQLite,
built into Node itself.

Check what you have:

```
node --version
```

If it prints v22 or higher you are ready. Otherwise install the current LTS
from nodejs.org.

## Running it

```
cd i7seven-billing
node server.js
```

Then open:

| Page | Address |
|---|---|
| New invoice | http://localhost:3000/ |
| Dashboard | http://localhost:3000/dashboard.html |

The database file is created automatically at `data/billing.db` on first run.

To let other machines in the shop use it, find the server machine's local IP
(`ipconfig` on Windows, `ip addr` on Linux) and have the cashiers open
`http://THAT-IP:3000/`. Everyone writes to the same database.

## What is where

```
server.js              HTTP server, database, tax engine, search API
public/index.html      New invoice screen
public/dashboard.html  Dashboard, search, invoice viewer
public/core.js         Tax engine + invoice renderer shared by both pages
public/style.css       All styling, including the print layout
public/logo.png        Your wordmark
data/billing.db        The database (created on first run)
```

## Tax treatments

Chosen per invoice, and stored on the invoice so old bills keep printing
correctly even if you change rates later.

| Mode | Calculation |
|---|---|
| No VAT | Total = value. VAT number is hidden, header reads "Invoice" |
| VAT 18% | Total = value + VAT |
| VAT + SSCL | SSCL on value first, then VAT on (value + SSCL) |
| Price includes VAT 18% | Total unchanged; VAT portion shown separately |

The VAT number only prints when a tax mode other than "No VAT" is selected.
On a No-VAT invoice it is never stored and never shown.

Rates are editable. The SSCL default is 2.5% — confirm the effective rate for
mobile phone retail with your accountant and set it in the field.

## Warranty

Set in **days**, per item, by the cashier. The system calculates the expiry
date from the issue date and prints it on the line and in the warranty table.
Enter 0 for items sold without warranty and they are left out.

## Searching

The dashboard search box takes an NIC, an IMEI, an invoice number, a customer
name or a phone number. Partial matches work — typing the last six digits of
an IMEI will find it. Use the "Search in" dropdown to restrict the field when
a general search returns too much. Click any row to open the full invoice, and
print it from there.

Press `/` anywhere on the dashboard to jump to the search box.

## Printing

Use the Print button. In the print dialog, turn on **Background graphics**
(Chrome hides this under "More settings") so the dark header band and the lime
rule appear. Choose "Save as PDF" as the destination to get a file.

## Backing up

The whole database is one file. Copy `data/billing.db` somewhere safe on a
schedule. On Linux or macOS:

```
cp data/billing.db ~/backups/billing-$(date +%F).db
```

Do this while the server is stopped, or use `sqlite3 data/billing.db ".backup
out.db"` to copy it safely while running.

## Default business details

Edit them through the settings API, or open `data/billing.db` and change the
`settings` table. Keys: `biz_name`, `biz_lines`, `vat_no`, `number_prefix`,
`currency`, `vat_rate`, `sscl_rate`, `tax_mode`, `payment_days`,
`warranty_text`, `terms`.

```
curl -X PUT http://localhost:3000/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"vat_no":"114567890-7000","biz_lines":"48 Galle Road\nDehiwala\n+94 11 273 4500 · info@iseven.lk"}'
```

## Invoice numbers

Issued by the server in an unbroken sequence, inside the same transaction that
writes the invoice. A failed or rejected save does not consume a number, so
there are no gaps in the series.

## Not built yet

Emailing the invoice to the customer. The template in `core.js` is the same one
that would render the PDF, so the send job plugs into the existing structure.

---

# Running on Supabase instead

The SQLite build keeps everything on one machine. Supabase is hosted Postgres,
which is worth switching to if you want any of these:

- more than one branch writing to the same records
- the dashboard reachable from home or from your phone
- backups handled for you rather than remembered by you

If it is one shop on one counter machine, SQLite is genuinely fine and simpler.

## Important: keep this server

Supabase can be called straight from the browser with its public "anon" key.
Do not do that here. Your invoices carry NIC numbers and phone numbers, and a
browser key is readable by anyone who opens the page source. Keep `server.js`
in the middle. The browser talks to your server, and only your server holds the
database password.

## Setup

1. Create a project at supabase.com (free tier is enough).
2. Open the SQL Editor, paste all of `schema.sql`, and Run.
3. Go to Settings, then Database, then Connection string. Copy the
   **Session pooler** URI on port 5432 — not the direct connection, which is
   IPv6-only and will not resolve on most home connections.
4. Put your database password into the URI where it says `[YOUR-PASSWORD]`.
5. Install the driver and start:

```
npm install

# Mac / Linux
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres" node server-supabase.js

# Windows
set DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres
node server-supabase.js
```

The pages and the API are unchanged, so `index.html` and `dashboard.html` work
exactly as before.

## What schema.sql does about security

It enables Row Level Security on all four tables and adds no policies. That
shuts the public REST API completely — anyone with your anon key gets nothing.
Your server is unaffected because it connects as the database owner, and the
owner bypasses RLS.

Never put the `service_role` key or the database URL into any file inside
`public/`. Everything in that folder is downloaded by the browser.

## Free tier limits

500 MB of database, which at 5,000 invoices a month is several years of
records. Projects on the free plan pause after a week with no activity; a shop
billing daily will never hit that, but if you close for a long holiday, open
the dashboard once to wake it.

## Backups

Supabase takes daily backups on the free plan. Take your own as well before
anything risky:

```
pg_dump "$DATABASE_URL" > backup-2026-08-30.sql
```

---

# Hosting on Vercel

Works, with two conditions: use the Supabase build, and turn the login on.
Vercel gives you a public URL, and this app holds NIC numbers and phone
numbers. Without `APP_PASSWORD` set, anyone with the link reads your whole
customer list.

The SQLite build cannot run on Vercel at all — serverless functions have no
persistent disk, so the database would be wiped between requests.

## Decide this first

Hosted means the shop cannot bill when the internet is down. For a phone shop
that is a real risk: no connection, no invoices, no sales. Two common answers:

- keep `node server-supabase.js` on the counter PC as the everyday till, and
  use the Vercel URL only for lookups from outside the shop
- or accept the risk if your connection is reliable and you have mobile data
  to fall back on

Either is fine. Choose deliberately rather than by accident.

## Deploy

1. Push the folder to GitHub. `.gitignore` is already set up.
2. On vercel.com choose Add New, then Project, and import the repository.
3. Framework preset: **Other**. No build command, no output directory.
4. Add three Environment Variables before deploying:

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase **Transaction pooler** URI, port **6543** |
| `APP_PASSWORD` | the password your staff will type |
| `SESSION_SECRET` | 32+ random characters, `openssl rand -hex 32` |

5. Deploy.

**Use the Transaction pooler on Vercel, not the Session pooler.** Serverless
functions start and stop constantly. Session pooling holds a connection per
instance and you will exhaust the connection limit within a day. Transaction
pooling returns the connection after each query. Locally the opposite applies:
one long-running process, so use the Session pooler on port 5432.

## Layout

```
api/index.js      one serverless function, all /api routes
lib/billing.js    tax engine and queries, shared with the local server
lib/auth.js       password login, signed cookies
public/           static pages, served by Vercel directly
vercel.json       routes /api/* to the function
```

`server-supabase.js` and `api/index.js` both call `lib/billing.js`, so the tax
maths cannot drift between hosted and local.

## How the login works

Staff enter the shop password once. The server compares it in constant time,
then sets a signed HttpOnly cookie valid for 12 hours. The cookie holds only an
expiry timestamp and an HMAC signature — no password, nothing readable, and
nothing that can be edited without breaking the signature. Every `/api` request
except login returns 401 unless the cookie verifies.

Changing `SESSION_SECRET` signs everyone out immediately. Do that if the
password leaks.

To run locally with no login, leave `APP_PASSWORD` unset. The startup banner
tells you which mode you are in.

## Still not built

Emailing invoices to customers.

---

# Roles and automatic email

## The two logins

Set two different passwords. The login page is the same for both — whoever
signs in gets the role that matches their password.

| | Cashier | Admin |
|---|---|---|
| Create invoices | yes | yes |
| Email invoices | yes | yes |
| Search by NIC, IMEI, name | yes | yes |
| Open and print any invoice | yes | yes |
| Takings, VAT and SSCL totals | **no** | yes |
| Total column in the results list | **no** | yes |
| Change business settings | **no** | yes |

Cashiers keep search because it is how a warranty claim gets handled at the
counter — the customer brings a phone, you type the IMEI, you see the expiry
date. What they do not see is money: no daily takings, no monthly VAT, no
totals column. That split is enforced on the server, not just hidden in the
page, so a cashier cannot reach the figures by editing the URL.

```
ADMIN_PASSWORD=...
CASHIER_PASSWORD=...
SESSION_SECRET=...
```

If only `ADMIN_PASSWORD` is set, there is simply no cashier login. If neither
is set, there is no login at all and everyone is admin — fine on a closed shop
LAN, never on a public host.

## Automatic email

Add the customer's email address on the invoice screen and the bill is sent the
moment it saves, from `info@iseven.lk`. Leave the field blank and nothing is
sent; the invoice saves exactly as before.

The email is the invoice itself, laid out in HTML: dark header with your
wordmark, the item lines with IMEI and warranty days, the full SSCL and VAT
breakdown, the warranty table with expiry dates, and your terms. A plain-text
version is included for clients that block HTML. The logo travels with the
message as an embedded attachment, so it displays even when a client blocks
remote images.

### Setting it up with Brevo

1. Sign up at brevo.com. The free tier sends 300 a day, about 9,000 a month.
2. Add and verify the domain `iseven.lk`, then add the SPF and DKIM records
   Brevo gives you to your DNS. Skip this and your invoices land in spam.
3. Go to SMTP & API, then SMTP, and create a key. This is not your Brevo
   account password.
4. Set the five `SMTP_*` variables from `.env.example`.

To switch sending off, leave `SMTP_HOST` empty. The startup banner tells you
which mode you are in.

### When sending fails

A failed email never undoes a sale. The invoice is committed to the database
first, and only then is the email attempted. If it fails, the invoice is still
saved and numbered, and the cashier sees a red bar with a Retry button.

Every attempt is recorded on the invoice row in `email_status`:

| Status | Meaning |
|---|---|
| `sent` | delivered to the mail provider |
| `not_sent` | no email address was entered |
| `bad_address` | the address is malformed |
| `failed` | the provider rejected it or the connection failed |
| `disabled` | SMTP is not configured on this server |

The dashboard shows this as a pill next to each customer's address, so an admin
can spot bills that never reached anyone. `sent` means your provider accepted
the message — it does not prove the customer opened it. For that you would add
Brevo's bounce webhook, which is not built yet.

## Upgrading an existing database

`schema.sql` is safe to re-run. The email columns are added with
`ADD COLUMN IF NOT EXISTS`, so running it again on a database that already has
invoices adds the new columns and leaves your data untouched.

---

# Running with no database setup

`server.js` picks its storage automatically:

- **`DATABASE_URL` not set** → SQLite, a file at `data/billing.db`. Nothing to
  install, no account, no connection string.
- **`DATABASE_URL` set** → PostgreSQL / Supabase.

Roles, email, search, the dashboard and the tax engine are identical either
way, because both backends sit behind the same interface in `lib/`. Develop on
SQLite, deploy on Supabase, and nothing about the app changes.

## Fastest possible start

1. Copy `.env.local.example` to `.env.local`.
2. Leave the `DATABASE_URL` line commented out.
3. `npm install`
4. `npm run dev`

The banner tells you which backend you got:

```
Database:       SQLite  /path/to/data/billing.db
Login required: yes
Email sending:  off — set SMTP_HOST
```

## Moving to Supabase later

Uncomment `DATABASE_URL` in `.env.local`, run `schema.sql` in the Supabase SQL
Editor, restart. The banner will read `PostgreSQL` instead. Your SQLite file
stays on disk untouched, so you can switch back by commenting the line out
again.

Existing SQLite databases are upgraded automatically — the email columns are
added on startup if they are missing.

## Which file to run

`server.js` is the only entry point you need. `server-supabase.js` still works
and simply calls it, so older instructions do not break.

---

# Warranty types, CRUD, and the emailed copy

## Three warranty types

Chosen per item from a dropdown next to the days field.

| Option | Prints as |
|---|---|
| Normal warranty | `Warranty 30 days · valid to 01 Oct 2026` |
| AppleCare | `AppleCare warranty 365 days · valid to 01 Sep 2027` |
| Company warranty | `Company warranty 180 days · valid to 28 Feb 2027` |

Days are typed by the cashier in every case. Normal warranty stays the default,
so accessories and repairs behave exactly as before. The warranty table at the
foot of the invoice gains a Type column, and the same labels appear in the email
and in the plain-text version.

## No tax by default

New installs start on **No VAT**. The header reads "Invoice" rather than "Tax
invoice" and the VAT number is left off entirely. Switch an individual invoice
to VAT, VAT + SSCL, or VAT-inclusive from the Tax dropdown, or change the
default in the settings table once you register. Existing databases keep the
default they already had.

## Editing and deleting

Both are **admin only**, enforced on the server, so a cashier cannot reach them
by editing the URL.

- **Edit** — from the dashboard row or the invoice viewer. Opens the invoice in
  the till screen. The invoice number never changes. Tick "Email the customer
  again after saving" to send the corrected copy.
- **Delete** — asks for confirmation, then removes the invoice and its items.

One thing to understand about deleting: the number is **not** reused, so your
sequence will show a gap. Most tax authorities expect an unbroken series, so
prefer editing a wrong invoice over deleting it.

## The emailed copy

Every invoice email carries an `I7-0001.html` attachment: a standalone copy the
customer can open and print to PDF from their browser. A banner in the email
explains how. No PDF library and no public URL, so it behaves identically on
your counter machine, on Supabase, and on Vercel.

## Alignment

The printed invoice keeps its header on one row instead of stacking, the line
number no longer runs into the description, and the money columns have fixed
widths in the email so they line up in Gmail and Outlook.

---

# PDF invoices

Every invoice email now carries a real `I7-0001.pdf`, and there is a
**Download PDF** button on the dashboard viewer and on the till screen after
saving.

PDFs are drawn with PDFKit, a pure-JavaScript library. No headless browser, so
the whole thing runs on your counter machine and on Vercel's free tier alike.
About 26 MB installed, well inside Vercel's 250 MB function limit, and
generation takes a fraction of a second.

The text is selectable and searchable, and Gmail previews the invoice inline
without the customer downloading anything.

## What it contains

The dark header with your wordmark, the VAT number when a tax mode is set,
billed-to with the NIC chip, line items with IMEI and the warranty line
colour-coded by type, the full SSCL and VAT breakdown, the warranty table with
expiry dates, your terms, and the cashier name. Long invoices paginate and pick
up a page number; short ones stay on a single page with no page number at all.

## If PDF generation ever fails

The email still goes out. A failure is logged and the older self-contained HTML
copy is attached instead, so a customer never misses their invoice because of a
layout problem.

## Endpoint

```
GET /api/invoices/:id/pdf
```

Available to both roles, since a cashier may need to reprint a customer's copy
at the counter. Requires a session, like everything else.

## Adjusting the layout

All of it lives in `lib/pdf.js`. The palette constants are at the top, and the
column positions are in the `COL` object, so moving a money column or changing
a font size is a one-line edit.
