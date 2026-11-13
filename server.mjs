// tally: links your bank, card, and brokerage accounts through Plaid and keeps their data in SQLite on your machine.
// Node built-ins only. Listens on 127.0.0.1; reach it from other devices through tailscale serve or an ssh tunnel.
import http from "node:http";
import { readFileSync, mkdirSync, chmodSync, existsSync, rmSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import * as report from "./lib/report.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TALLY_PORT || 3400);
const KEYS = process.env.TALLY_KEYS || join(homedir(), ".config/tally/plaid.env");
// A Discord webhook from before the Settings page could hold one. Read by webhook() below.
const DISCORD = process.env.TALLY_DISCORD || join(homedir(), ".config/tally/discord.env");
const DATA = process.env.TALLY_DATA || join(ROOT, "data");
// Gig payout rules, off unless the file exists. See payouts() in lib/report.mjs.
const PAYOUTS = process.env.TALLY_PAYOUTS || join(homedir(), ".config/tally/payouts.mjs");
const payoutSources = existsSync(PAYOUTS) ? (await import(pathToFileURL(PAYOUTS).href)).default(report) : {};
// Plaid's Trial plan allows 10 Items for life. Removing one does not give the slot back.

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
// Plaid's test bank never shares a file with real banks: sandbox keys open data/sandbox.db, production keys data/tally.db.
// Switching is a keys edit and a restart, with nothing to move.
const dbName = loadKeys()?.env === "sandbox" ? "sandbox" : "tally";
const dbPath = join(DATA, `${dbName}.db`);
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
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
report.setupViews(db);

const now = () => new Date().toISOString();

const PLAID_TIMEOUT_MS = Number(process.env.TALLY_PLAID_TIMEOUT_MS || 60000);
async function plaid(path, body) {
  const k = loadKeys();
  if (!k) throw Object.assign(new Error(`No Plaid keys in ${KEYS}`), { code: "NO_KEYS" });
  // A Plaid call that hangs would hold up every bank after it and the backup snapshot, so each try gets 60 seconds.
  const req = () => fetch(k.host + path, {
    method: "POST",
    signal: AbortSignal.timeout(PLAID_TIMEOUT_MS),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: k.id, secret: k.secret, ...body }),
  });
  // A dropped connection ("fetch failed") gets one retry after 2 seconds, then is reported as NETWORK_ERROR.
  let res;
  try { res = await req(); }
  catch {
    await new Promise((r) => setTimeout(r, 2000));
    try { res = await req(); }
    catch (e) { throw Object.assign(new Error(`couldn't reach Plaid (${e.cause?.code ?? e.message})`), { code: "NETWORK_ERROR" }); }
  }
  const json = await res.json().catch((e) => {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw Object.assign(new Error(`Plaid ${path} timed out`), { code: "NETWORK_ERROR" });
    return {};
  });
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
  const cap = Number(settings().itemCap);
  if (itemCount() >= cap) throw new Error(`All ${cap} connections are used. Raise the limit in Settings only if your Plaid plan allows more.`);
  const products = kind === "brokerage"
    ? { products: ["investments"], optional_products: ["transactions"] }
    : { products: ["transactions"], optional_products: ["investments"] };
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
  const st = db.prepare(`INSERT OR REPLACE INTO accounts (account_id, item_id, name, official_name, mask, type, subtype, current, available,
    credit_limit, currency, updated_at, closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`);
  for (const a of accounts) st.run(a.account_id, itemId, a.name, a.official_name ?? null, a.mask ?? null, a.type, a.subtype ?? null,
    a.balances?.current ?? null, a.balances?.available ?? null, a.balances?.limit ?? null, a.balances?.iso_currency_code ?? null, now());
}

// /accounts/get lists an Item's open accounts. One it no longer lists was closed (or unshared in update mode):
// keep it for its transactions, but stop counting its last balance.
function markClosed(itemId, accounts) {
  const open = new Set(accounts.map((a) => a.account_id));
  for (const { account_id } of db.prepare("SELECT account_id FROM accounts WHERE item_id = ? AND closed_at IS NULL").all(itemId))
    if (!open.has(account_id)) db.prepare("UPDATE accounts SET closed_at = ? WHERE account_id = ?").run(now(), account_id);
}

// Plaid's sync pages must be applied all together: if the data changes while paging, Plaid says
// TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION and the whole sync restarts from the cursor it began with.
// So pages are collected first and written in one transaction, and the cursor only moves when every page is in.
async function syncTransactions(item) {
  for (let attempt = 1; ; attempt++) {
    try { return await syncPages(item); }
    catch (e) { if (e.code !== "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" || attempt >= 3) throw e; }
  }
}

async function syncPages(item) {
  let cursor = item.cursor ?? undefined, status = null, accounts = null;
  const added = [], modified = [], removed = [];
  for (let page = 0; page < 200; page++) {
    const r = await plaid("/transactions/sync", { access_token: item.access_token, cursor, count: 500 });
    added.push(...r.added); modified.push(...r.modified); removed.push(...r.removed);
    cursor = r.next_cursor;
    status = r.transactions_update_status ?? status;
    if (r.accounts?.length) accounts = r.accounts;
    if (!r.has_more) break;
  }
  const up = db.prepare(`INSERT OR REPLACE INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const del = db.prepare("DELETE FROM transactions WHERE transaction_id = ?");
  // A category set on a pending charge follows it when it posts under a new id.
  const carry = db.prepare("INSERT OR IGNORE INTO overrides (transaction_id, category) SELECT ?, category FROM overrides WHERE transaction_id = ?");
  db.exec("BEGIN");
  try {
    for (const t of [...added, ...modified]) {
      up.run(t.transaction_id, item.item_id, t.account_id, t.date, t.authorized_date ?? null,
        t.name, t.merchant_name ?? null, t.amount, t.iso_currency_code ?? null, t.pending ? 1 : 0, t.pending_transaction_id ?? null,
        t.personal_finance_category?.primary ?? null, t.personal_finance_category?.detailed ?? null, t.payment_channel ?? null, JSON.stringify(t));
      if (t.pending_transaction_id) carry.run(t.transaction_id, t.pending_transaction_id);
    }
    for (const t of removed) { del.run(t.transaction_id); db.prepare("DELETE FROM overrides WHERE transaction_id = ?").run(t.transaction_id); }
    db.prepare("UPDATE items SET cursor = ? WHERE item_id = ?").run(cursor, item.item_id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  if (accounts) saveAccounts(item.item_id, accounts);
  return { added: added.length, modified: modified.length, removed: removed.length, status };
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

// Plaid's recurring streams: subscriptions, bills, and paychecks, with the next expected date.
async function syncRecurring(item) {
  const r = await plaid("/transactions/recurring/get", { access_token: item.access_token });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM recurring WHERE item_id = ?").run(item.item_id);
    const st = db.prepare(`INSERT OR REPLACE INTO recurring VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const [dir, list] of [["outflow", r.outflow_streams ?? []], ["inflow", r.inflow_streams ?? []]]) {
      for (const x of list) st.run(x.stream_id, item.item_id, x.account_id ?? null, dir, x.description ?? null, x.merchant_name ?? null,
        x.personal_finance_category?.primary ?? null, x.frequency ?? null, x.average_amount?.amount ?? null, x.last_amount?.amount ?? null,
        x.first_date ?? null, x.last_date ?? null, x.predicted_next_date ?? null, x.is_active ? 1 : 0, x.status ?? null, now());
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return (r.outflow_streams?.length ?? 0) + (r.inflow_streams?.length ?? 0);
}

// Not-supported errors are expected (a card has no holdings, some brokerages have no transactions), so they are noted, not failures.
const NOT_SUPPORTED = new Set(["PRODUCT_NOT_READY", "PRODUCTS_NOT_SUPPORTED", "NO_INVESTMENT_ACCOUNTS", "NO_INVESTMENT_AUTH_ACCOUNTS", "PRODUCT_NOT_ENABLED", "INVALID_PRODUCT", "ADDITIONAL_CONSENT_REQUIRED"]);

async function syncItem(itemId) {
  const item = db.prepare("SELECT * FROM items WHERE item_id = ?").get(itemId);
  const out = { item_id: itemId, notes: [] };
  const errors = [];
  try {
    const { accounts } = await plaid("/accounts/get", { access_token: item.access_token });
    saveAccounts(itemId, accounts);
    markClosed(itemId, accounts);
  } catch (e) { errors.push(`${e.code}: ${e.message}`); }
  try { out.transactions = await syncTransactions(item); }
  catch (e) { (NOT_SUPPORTED.has(e.code) ? out.notes : errors).push(`transactions ${e.code}: ${e.message}`); }
  if (out.transactions) {
    try { out.recurring = await syncRecurring(item); }
    catch (e) { (NOT_SUPPORTED.has(e.code) ? out.notes : errors).push(`recurring ${e.code}: ${e.message}`); }
  }
  try { out.holdings = await syncHoldings(item); }
  catch (e) { (NOT_SUPPORTED.has(e.code) ? out.notes : errors).push(`holdings ${e.code}: ${e.message}`); }
  report.recordBalances(db);
  db.prepare("UPDATE items SET last_sync = ?, last_error = ?, tx_status = ? WHERE item_id = ?")
    .run(now(), errors.join("\n") || null, out.transactions?.status ?? null, itemId);
  for (const e of errors) console.error(now(), "sync", item.institution_name, e);
  out.errors = errors;
  return out;
}

// A clean copy for the nightly backup, so a restore never depends on catching the live file mid-write.
function snapshot() {
  const tmp = join(DATA, `${dbName}-snapshot.tmp.db`);
  rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  chmodSync(tmp, 0o600);
  renameSync(tmp, join(DATA, `${dbName}-snapshot.db`));
}

// Every full sync ends with a fresh snapshot, so a backup exists without the daily job.
async function syncAll() {
  const results = [];
  for (const { item_id } of db.prepare("SELECT item_id FROM items").all()) results.push(await syncItem(item_id));
  try { snapshot(); } catch (e) { console.error(now(), "snapshot", e.message); }
  return results;
}

// One full sync at a time: the daily job, the Sync button, and an automatic sync all share the one running.
let running = null;
const syncAllOnce = () => (running ??= syncAll().finally(() => { running = null; }));

// Settings the owner changes on the Accounts page. Each has a default and a check; the env var still sets the default.
const SETTINGS = {
  // Sync when tally starts or the page is opened, if the data is older than this many hours. "off" leaves it to the
  // daily job and the Sync button, for a computer that's always on.
  autoSync: { def: "12", ok: (v) => ["off", "1", "6", "12", "24"].includes(v) },
  // Plaid connections tally will link. The free Trial plan allows 10 for good; a paid plan can raise it.
  itemCap: { def: String(Number(process.env.TALLY_ITEM_CAP || 10)), ok: (v) => /^[1-9]\d{0,3}$/.test(v) },
  // The daily alert for one charge this big or bigger, in dollars.
  bigCharge: { def: String(Number(process.env.TALLY_BIG_CHARGE || 200)), ok: (v) => /^[1-9]\d{0,6}$/.test(v) },
  // Discord alerts are opt-in. A setup from before the setting, with a webhook file, keeps posting.
  alerts: { def: existsSync(DISCORD) ? "on" : "off", ok: (v) => v === "on" || v === "off" },
  // A webhook pasted on the Settings page wins over the file. Empty means none.
  discordWebhook: { def: "", ok: (v) => v === "" || /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(v) },
};
function settings() {
  const saved = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, r.value]));
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, saved[k] ?? s.def]));
}
// The webhook to post to: the one saved in settings, else DISCORD_WEBHOOK_URL in the file.
function webhook() {
  const saved = settings().discordWebhook;
  if (saved) return saved;
  if (!existsSync(DISCORD)) return null;
  return readFileSync(DISCORD, "utf8").match(/^DISCORD_WEBHOOK_URL=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "") || null;
}
// What the Settings page sees: never the webhook itself, only where it comes from.
function publicSettings() {
  const { discordWebhook, ...rest } = settings();
  const k = loadKeys();
  return { ...rest, webhook: discordWebhook ? "settings" : webhook() ? "file" : null, plaidEnv: k?.env ?? null, keysPath: KEYS, dataPath: dbPath };
}
function saveSettings(body) {
  const set = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(body)) {
    if (!SETTINGS[k]?.ok(String(v))) throw Object.assign(new Error(`${k} can't be ${JSON.stringify(v)}`), { status: 400 });
    set.run(k, String(v));
  }
  return settings();
}

// An automatic sync is due when a connection last synced longer ago than autoSync allows, or its last try couldn't
// reach Plaid (a laptop that woke before its Wi-Fi did). At most one automatic sync every 10 minutes.
let lastAuto = 0;
function syncDue() {
  const h = settings().autoSync;
  if (h === "off" || Date.now() - lastAuto < 10 * 60_000) return false;
  const cutoff = Date.now() - Number(h) * 3600_000;
  return db.prepare("SELECT last_sync, last_error FROM items").all()
    .some((it) => !it.last_sync || Date.parse(it.last_sync) < cutoff || /NETWORK_ERROR/.test(it.last_error ?? ""));
}
async function autoSync(why) {
  if (!syncDue()) return { synced: false };
  lastAuto = Date.now();
  console.log(now(), "auto sync", why);
  return { synced: true, results: await syncAllOnce() };
}

function status() {
  const items = db.prepare("SELECT item_id, institution_name, kind, created_at, last_sync, last_error, tx_status FROM items ORDER BY created_at").all();
  for (const it of items) {
    it.accounts = db.prepare("SELECT account_id, name, mask, type, subtype, current, available, credit_limit, closed_at FROM accounts WHERE item_id = ? ORDER BY closed_at IS NOT NULL, type, name").all(it.item_id);
    it.tx = db.prepare("SELECT count(*) n, min(date) first, max(date) last, sum(pending) pending FROM transactions WHERE item_id = ?").get(it.item_id);
    it.recent = db.prepare("SELECT date, coalesce(merchant_name, name) who, amount, category, pending FROM transactions WHERE item_id = ? ORDER BY date DESC LIMIT 5").all(it.item_id);
    it.holdings = db.prepare("SELECT count(*) n, sum(value) value FROM holdings WHERE item_id = ?").get(it.item_id);
  }
  const k = loadKeys();
  return { keys: !!k, env: k?.env ?? null, keysPath: KEYS, used: items.length, cap: Number(settings().itemCap), items };
}

// Loopback Host, or a host named in TALLY_HOSTS (the tailscale serve address), and same-origin POSTs only,
// so another site in the browser can't drive this page and a rebound DNS name can't reach it.
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EXTRA_HOSTS = new Set((process.env.TALLY_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean));
const refused = new Set();
function allowed(req) {
  const host = req.headers.host ?? "";
  if (!LOOPBACK.test(host) && !EXTRA_HOSTS.has(host)) {
    // Said once per name, since a phone that can't load the page usually means a missing TALLY_HOSTS entry.
    if (!refused.has(host) && refused.size < 20) { refused.add(host); console.error(now(), `refused a request for ${JSON.stringify(host)}; to allow it, add it to TALLY_HOSTS`); }
    return false;
  }
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

const STATIC = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript"], "/app.css": ["app.css", "text/css"] };

// ?month=YYYY-MM, never later than this month. Anything else means this month.
function pickMonth(q) {
  const now = report.monthOf(report.localDate()), m = q.get("month");
  return report.isMonth(m) && m <= now ? m : now;
}

const routes = {
  "GET /api/status": () => status(),
  "GET /api/summary": (_b, _res, q) => report.summary(db, report.localDate(), pickMonth(q)),
  "GET /api/transactions": (_b, _res, q) => report.transactions(db, Object.fromEntries(q)),
  "GET /api/spending": (_b, _res, q) => {
    const month = pickMonth(q);
    const today = report.localDate();
    return { month, categories: report.byCategory(db, month, today), history: report.history(db, 12, report.monthOf(today), today) };
  },
  "GET /api/budgets": (_b, _res, q) => { const month = pickMonth(q); return { month, budgets: report.budgets(db, month, report.localDate()) }; },
  "GET /api/recurring": () => report.recurring(db).map((r) => ({ ...r, monthly: report.monthlyCost(r) })),
  "GET /api/meta": () => ({ labels: report.LABELS, notSpending: report.NOT_SPENDING,
    accounts: db.prepare("SELECT account_id, name, mask, type FROM accounts ORDER BY type, name").all() }),
  // Weekly gig payouts, for another app on the same machine. Empty without a payouts file.
  "GET /api/payouts": () => report.payouts(db, payoutSources),
  "POST /api/category": (body) => report.setCategory(db, body),
  "POST /api/budget": (body) => report.setBudget(db, body),
  // The daily job: sync everything, write the backup snapshot, and return alerts not sent yet.
  "POST /api/daily": async () => {
    const results = await syncAllOnce();
    const set = settings(), on = set.alerts === "on";
    return { alerts: on ? report.dailyAlerts(db, { bigCharge: Number(set.bigCharge) }) : [], webhook: on ? webhook() : null, errors: results.flatMap((r) => r.errors) };
  },
  "POST /api/alerts-sent": (body) => { report.markSent(db, body.keys ?? []); return { ok: true }; },
  "POST /api/link-token": async (body) => ({ link_token: (await linkToken(body)).link_token }),
  "POST /api/exchange": (body) => exchange(body),
  "POST /api/sync": async (body) => ({ results: body.item_id ? [await syncItem(body.item_id)] : await syncAllOnce() }),
  // The page asks on open and when its tab comes back; the server decides whether a sync is due.
  "POST /api/sync-if-due": () => autoSync("page opened"),
  "GET /api/settings": () => publicSettings(),
  "POST /api/settings": (body) => { saveSettings(body); return publicSettings(); },
};

const server = http.createServer(async (req, res) => {
  if (!allowed(req)) return send(res, 403, { error: "localhost only" });
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    return send(res, 200, readFileSync(join(ROOT, "public", file)), type);
  }
  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: "not found" });
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const out = await route(body, res, url.searchParams);
    if (!res.headersSent) send(res, 200, out);
  } catch (e) {
    console.error(now(), req.method, req.url, e.code ?? "", e.message);
    send(res, e.status ?? (e.code === "NO_KEYS" ? 412 : 500), { error: e.message, code: e.code ?? null });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`${now()} tally on http://localhost:${PORT} (keys ${loadKeys() ? "found" : "missing"})`));
// A computer that was off overnight catches up once it starts. The wait gives a laptop's network time to come up.
const STARTUP_SYNC_MS = Number(process.env.TALLY_STARTUP_SYNC_MS ?? 30_000);
if (loadKeys()) setTimeout(() => autoSync("startup").catch((e) => console.error(now(), "auto sync", e.message)), STARTUP_SYNC_MS).unref();
