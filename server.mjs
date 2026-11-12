// tally: links the owner's bank, card, and brokerage accounts through Plaid and keeps their data in SQLite on the server.
// Step 1 is a link test: link each institution once, pull accounts, transactions, and holdings, and show what came back.
// Node built-ins only. Listens on 127.0.0.1, so it is reached over an ssh tunnel.
import http from "node:http";
import { readFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TALLY_PORT || 3400);
const KEYS = process.env.TALLY_KEYS || join(homedir(), ".config/tally/plaid.env");
const DATA = process.env.TALLY_DATA || join(ROOT, "data");
// Plaid's Trial plan allows 10 Items for life. Removing one does not give the slot back.
const ITEM_CAP = 10;

function loadKeys() {
  if (!existsSync(KEYS)) return null;
  const env = {};
  for (const m of readFileSync(KEYS, "utf8").matchAll(/^([A-Z_]+)=(.*)$/gm)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) return null;
  // PLAID_HOST is for the tests' fake Plaid server.
  const host = env.PLAID_HOST || ((env.PLAID_ENV || "production") === "sandbox" ? "https://sandbox.plaid.com" : "https://production.plaid.com");
  return { id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, host, env: env.PLAID_ENV || "production" };
}

mkdirSync(DATA, { recursive: true, mode: 0o700 });
const dbPath = join(DATA, "tally.db");
const db = new DatabaseSync(dbPath);
chmodSync(dbPath, 0o600);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS items (
    item_id TEXT PRIMARY KEY, access_token TEXT NOT NULL, institution_id TEXT, institution_name TEXT,
    kind TEXT, created_at TEXT NOT NULL, cursor TEXT, last_sync TEXT, last_error TEXT, tx_status TEXT);
  CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT, official_name TEXT, mask TEXT, type TEXT, subtype TEXT,
    current REAL, available REAL, credit_limit REAL, currency TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS transactions (
    transaction_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, account_id TEXT NOT NULL, date TEXT, authorized_date TEXT,
    name TEXT, merchant_name TEXT, amount REAL, currency TEXT, pending INTEGER, pending_transaction_id TEXT,
    category TEXT, category_detail TEXT, payment_channel TEXT, raw TEXT);
  CREATE TABLE IF NOT EXISTS holdings (
    account_id TEXT NOT NULL, security_id TEXT NOT NULL, item_id TEXT NOT NULL, name TEXT, ticker TEXT, type TEXT,
    quantity REAL, value REAL, cost_basis REAL, updated_at TEXT, PRIMARY KEY (account_id, security_id));
`);

const now = () => new Date().toISOString();

async function plaid(path, body) {
  const k = loadKeys();
  if (!k) throw Object.assign(new Error(`No Plaid keys in ${KEYS}`), { code: "NO_KEYS" });
  const res = await fetch(k.host + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: k.id, secret: k.secret, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error_message || `Plaid ${path} returned ${res.status}`);
    e.code = json.error_code || `HTTP_${res.status}`;
    e.type = json.error_type;
    throw e;
  }
  return json;
}

const itemCount = () => db.prepare("SELECT count(*) n FROM items").get().n;

// kind "bank": banks and cards, transactions required. kind "brokerage": investments required.
// days_requested is fixed when the Item is created, so ask for the most Plaid gives (730 days) now.
async function linkToken({ kind, itemId }) {
  const base = {
    client_name: "tally",
    country_codes: ["US"],
    language: "en",
    user: { client_user_id: "tally-owner" },
  };
  if (itemId) {
    const it = db.prepare("SELECT access_token FROM items WHERE item_id = ?").get(itemId);
    if (!it) throw new Error("No such item");
    return plaid("/link/token/create", { ...base, access_token: it.access_token });
  }
  if (itemCount() >= ITEM_CAP) throw new Error(`All ${ITEM_CAP} Plaid Trial connections are used.`);
  const products = kind === "brokerage"
    ? { products: ["investments"], optional_products: ["transactions"] }
    : { products: ["transactions"], optional_products: ["investments", "liabilities"] };
  return plaid("/link/token/create", { ...base, ...products, transactions: { days_requested: 730 } });
}

async function exchange({ public_token, institution, kind }) {
  const r = await plaid("/item/public_token/exchange", { public_token });
  db.prepare(`INSERT OR REPLACE INTO items (item_id, access_token, institution_id, institution_name, kind, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run(r.item_id, r.access_token, institution?.institution_id ?? null,
    institution?.name ?? null, kind ?? null, now());
  await syncItem(r.item_id).catch(() => {});
  return { item_id: r.item_id };
}

function saveAccounts(itemId, accounts) {
  const st = db.prepare(`INSERT OR REPLACE INTO accounts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const a of accounts) st.run(a.account_id, itemId, a.name, a.official_name ?? null, a.mask ?? null, a.type, a.subtype ?? null,
    a.balances?.current ?? null, a.balances?.available ?? null, a.balances?.limit ?? null, a.balances?.iso_currency_code ?? null, now());
}

async function syncTransactions(item) {
  const up = db.prepare(`INSERT OR REPLACE INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const del = db.prepare("DELETE FROM transactions WHERE transaction_id = ?");
  let cursor = item.cursor ?? undefined, added = 0, modified = 0, removed = 0, status = null;
  for (let page = 0; page < 200; page++) {
    const r = await plaid("/transactions/sync", { access_token: item.access_token, cursor, count: 500 });
    db.exec("BEGIN");
    try {
      for (const t of [...r.added, ...r.modified]) up.run(t.transaction_id, item.item_id, t.account_id, t.date, t.authorized_date ?? null,
        t.name, t.merchant_name ?? null, t.amount, t.iso_currency_code ?? null, t.pending ? 1 : 0, t.pending_transaction_id ?? null,
        t.personal_finance_category?.primary ?? null, t.personal_finance_category?.detailed ?? null, t.payment_channel ?? null, JSON.stringify(t));
      for (const t of r.removed) del.run(t.transaction_id);
      cursor = r.next_cursor;
      db.prepare("UPDATE items SET cursor = ? WHERE item_id = ?").run(cursor, item.item_id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    added += r.added.length; modified += r.modified.length; removed += r.removed.length;
    status = r.transactions_update_status ?? status;
    if (r.accounts?.length) saveAccounts(item.item_id, r.accounts);
    if (!r.has_more) break;
  }
  return { added, modified, removed, status };
}

async function syncHoldings(item) {
  const r = await plaid("/investments/holdings/get", { access_token: item.access_token });
  saveAccounts(item.item_id, r.accounts);
  const sec = new Map(r.securities.map((s) => [s.security_id, s]));
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM holdings WHERE item_id = ?").run(item.item_id);
    const st = db.prepare(`INSERT OR REPLACE INTO holdings VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const h of r.holdings) {
      const s = sec.get(h.security_id) ?? {};
      st.run(h.account_id, h.security_id, item.item_id, s.name ?? null, s.ticker_symbol ?? null, s.type ?? null,
        h.quantity, h.institution_value, h.cost_basis ?? null, now());
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return r.holdings.length;
}

// Not-supported errors are expected (a card has no holdings, some brokerages have no transactions), so they are noted, not failures.
const NOT_SUPPORTED = new Set(["PRODUCTS_NOT_SUPPORTED", "NO_INVESTMENT_ACCOUNTS", "NO_INVESTMENT_AUTH_ACCOUNTS", "PRODUCT_NOT_ENABLED", "INVALID_PRODUCT", "ADDITIONAL_CONSENT_REQUIRED"]);

async function syncItem(itemId) {
  const item = db.prepare("SELECT * FROM items WHERE item_id = ?").get(itemId);
  const out = { item_id: itemId, notes: [] };
  const errors = [];
  try {
    saveAccounts(itemId, (await plaid("/accounts/get", { access_token: item.access_token })).accounts);
  } catch (e) { errors.push(`${e.code}: ${e.message}`); }
  try { out.transactions = await syncTransactions(item); }
  catch (e) { (NOT_SUPPORTED.has(e.code) ? out.notes : errors).push(`transactions ${e.code}: ${e.message}`); }
  try { out.holdings = await syncHoldings(item); }
  catch (e) { (NOT_SUPPORTED.has(e.code) ? out.notes : errors).push(`holdings ${e.code}: ${e.message}`); }
  db.prepare("UPDATE items SET last_sync = ?, last_error = ?, tx_status = ? WHERE item_id = ?")
    .run(now(), errors.join("\n") || null, out.transactions?.status ?? null, itemId);
  out.errors = errors;
  return out;
}

function status() {
  const items = db.prepare("SELECT item_id, institution_name, kind, created_at, last_sync, last_error, tx_status FROM items ORDER BY created_at").all();
  for (const it of items) {
    it.accounts = db.prepare("SELECT account_id, name, mask, type, subtype, current, available, credit_limit FROM accounts WHERE item_id = ? ORDER BY type, name").all(it.item_id);
    it.tx = db.prepare("SELECT count(*) n, min(date) first, max(date) last, sum(pending) pending FROM transactions WHERE item_id = ?").get(it.item_id);
    it.recent = db.prepare("SELECT date, coalesce(merchant_name, name) who, amount, category, pending FROM transactions WHERE item_id = ? ORDER BY date DESC LIMIT 5").all(it.item_id);
    it.holdings = db.prepare("SELECT count(*) n, sum(value) value FROM holdings WHERE item_id = ?").get(it.item_id);
  }
  const k = loadKeys();
  return { keys: !!k, env: k?.env ?? null, keysPath: KEYS, used: items.length, cap: ITEM_CAP, items };
}

// Loopback Host, or a host named in TALLY_HOSTS (the tailscale serve address), and same-origin POSTs only,
// so another site in the browser can't drive this page and a rebound DNS name can't reach it.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EXTRA_HOSTS = new Set((process.env.TALLY_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean));
function allowed(req) {
  const host = req.headers.host ?? "";
  if (!LOOPBACK.test(host) && !EXTRA_HOSTS.has(host)) return false;
  if (req.method === "GET") return true;
  const origin = req.headers.origin;
  try { return !!origin && new URL(origin).host === req.headers.host; } catch { return false; }
}

const readBody = (req) => new Promise((ok, bad) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } }); req.on("error", bad);
});

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

const routes = {
  "GET /": (_q, res) => send(res, 200, readFileSync(join(ROOT, "public/index.html")), "text/html; charset=utf-8"),
  "GET /api/status": () => status(),
  "POST /api/link-token": async (body) => ({ link_token: (await linkToken(body)).link_token }),
  "POST /api/exchange": (body) => exchange(body),
  "POST /api/sync": async (body) => {
    const ids = body.item_id ? [body.item_id] : db.prepare("SELECT item_id FROM items").all().map((r) => r.item_id);
    const results = [];
    for (const id of ids) results.push(await syncItem(id));
    return { results };
  },
};

const server = http.createServer(async (req, res) => {
  if (!allowed(req)) return send(res, 403, { error: "localhost only" });
  const route = routes[`${req.method} ${new URL(req.url, "http://x").pathname}`];
  if (!route) return send(res, 404, { error: "not found" });
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const out = await route(body, res);
    if (!res.headersSent) send(res, 200, out);
  } catch (e) {
    console.error(now(), req.method, req.url, e.code ?? "", e.message);
    send(res, e.code === "NO_KEYS" ? 412 : 500, { error: e.message, code: e.code ?? null });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`${now()} tally on http://localhost:${PORT} (keys ${loadKeys() ? "found" : "missing"})`));
