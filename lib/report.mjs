// Every money rule tally uses: what counts as spending, income, net worth, budgets, and alerts.
// Plaid's sign: a positive amount is money out, a negative amount is money in.

export const LABELS = {
  GROCERIES: "Groceries", FOOD_AND_DRINK: "Food & drink", GAS: "Gas", TRANSPORTATION: "Transportation",
  GENERAL_MERCHANDISE: "Shopping", RENT_AND_UTILITIES: "Bills & utilities", GENERAL_SERVICES: "Services",
  ENTERTAINMENT: "Entertainment", PERSONAL_CARE: "Personal care", MEDICAL: "Medical", TRAVEL: "Travel",
  HOME_IMPROVEMENT: "Home", GOVERNMENT_AND_NON_PROFIT: "Taxes & donations", BANK_FEES: "Fees",
  LOAN_PAYMENTS: "Loan payments", OTHER: "Other", INCOME: "Income", TRANSFER: "Transfer",
};
// Never counted as spending.
export const NOT_SPENDING = ["INCOME", "TRANSFER"];

// Category order: a manual override on the transaction, then a merchant rule, then Plaid's category.
// Plaid's transfers and card payments become TRANSFER, and gas and groceries get their own categories.
export function setupViews(db) {
  // An account Plaid stops returning is closed: kept for its history, left out of balances and net worth.
  if (!db.prepare("SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'closed_at'").get()) db.exec("ALTER TABLE accounts ADD COLUMN closed_at TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS overrides (transaction_id TEXT PRIMARY KEY, category TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rules (merchant TEXT PRIMARY KEY, category TEXT NOT NULL, created_at TEXT);
    CREATE TABLE IF NOT EXISTS budgets (category TEXT PRIMARY KEY, monthly REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS recurring (
      stream_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, account_id TEXT, direction TEXT, description TEXT,
      merchant_name TEXT, category TEXT, frequency TEXT, average_amount REAL, last_amount REAL, first_date TEXT,
      last_date TEXT, predicted_next_date TEXT, is_active INTEGER, status TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS alerts_sent (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS balances (date TEXT NOT NULL, account_id TEXT NOT NULL, type TEXT, current REAL, PRIMARY KEY (date, account_id));
    DROP VIEW IF EXISTS tx;
    CREATE VIEW tx AS
    SELECT t.transaction_id, t.item_id, t.account_id, t.date, t.name, t.merchant_name, t.amount, t.pending,
      t.category AS plaid_category, t.category_detail,
      coalesce(nullif(t.merchant_name, ''), t.name) AS who,
      lower(coalesce(nullif(t.merchant_name, ''), t.name)) AS mkey,
      coalesce(o.category, r.category, CASE
        WHEN t.category IN ('TRANSFER_IN', 'TRANSFER_OUT') OR t.category_detail = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' THEN 'TRANSFER'
        WHEN t.category_detail = 'TRANSPORTATION_GAS' THEN 'GAS'
        WHEN t.category_detail = 'FOOD_AND_DRINK_GROCERIES' THEN 'GROCERIES'
        ELSE coalesce(t.category, 'OTHER') END) AS cat,
      o.category IS NOT NULL AS overridden, r.category IS NOT NULL AS ruled,
      a.type AS account_type, a.name AS account_name, a.mask AS account_mask
    FROM transactions t
    LEFT JOIN overrides o ON o.transaction_id = t.transaction_id
    LEFT JOIN rules r ON r.merchant = lower(coalesce(nullif(t.merchant_name, ''), t.name))
    LEFT JOIN accounts a ON a.account_id = t.account_id;
  `);
}

const SPEND_WHERE = `cat NOT IN ('INCOME', 'TRANSFER') AND account_type IN ('depository', 'credit')`;
const INCOME_WHERE = `cat = 'INCOME' AND account_type = 'depository'`;

export const localDate = (d = new Date()) => d.toLocaleDateString("en-CA");
export const monthOf = (date) => date.slice(0, 7);
export function shiftMonth(month, by) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function netWorth(db) {
  const rows = db.prepare("SELECT type, sum(coalesce(current, 0)) total FROM accounts WHERE closed_at IS NULL GROUP BY type").all();
  const by = Object.fromEntries(rows.map((r) => [r.type, r.total]));
  const cash = by.depository ?? 0, investments = by.investment ?? 0, owed = (by.credit ?? 0) + (by.loan ?? 0);
  return { cash, investments, owed, total: cash + investments - owed };
}

// One balance per account per day, for the net worth chart. A later sync the same day replaces that day's row.
// An account that failed to sync keeps its last known balance, so a bad sync doesn't dent the line.
export function recordBalances(db, today = localDate()) {
  db.prepare("INSERT OR REPLACE INTO balances (date, account_id, type, current) SELECT ?, account_id, type, current FROM accounts WHERE current IS NOT NULL AND closed_at IS NULL").run(today);
}

export function netWorthHistory(db, days = 365, today = localDate()) {
  const from = localDate(new Date(new Date(today + "T12:00:00").getTime() - days * 864e5));
  return db.prepare(`SELECT date, sum(CASE WHEN type IN ('credit', 'loan') THEN -current ELSE current END) total
                     FROM balances WHERE date >= ? GROUP BY date ORDER BY date`).all(from);
}

export const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const daysIn = (month) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
const pad2 = (n) => String(n).padStart(2, "0");

export function spentBetween(db, from, to) {
  return db.prepare(`SELECT coalesce(sum(amount), 0) s FROM tx WHERE ${SPEND_WHERE} AND date >= ? AND date <= ?`).get(from, to).s;
}

// Every month figure takes upTo (normally today), so a charge a bank dates in the future doesn't count yet.
export function byCategory(db, month, upTo = "9999-12-31") {
  return db.prepare(`SELECT cat, sum(amount) spent, count(*) n FROM tx WHERE ${SPEND_WHERE} AND substr(date, 1, 7) = ? AND date <= ?
                     GROUP BY cat HAVING abs(spent) > 0.005 ORDER BY spent DESC`).all(month, upTo);
}

export function history(db, months, end, upTo = "9999-12-31") {
  const start = shiftMonth(end, -(months - 1));
  const spend = db.prepare(`SELECT substr(date, 1, 7) m, sum(amount) v FROM tx WHERE ${SPEND_WHERE} AND substr(date, 1, 7) BETWEEN ? AND ? AND date <= ? GROUP BY m`).all(start, end, upTo);
  const inc = db.prepare(`SELECT substr(date, 1, 7) m, -sum(amount) v FROM tx WHERE ${INCOME_WHERE} AND substr(date, 1, 7) BETWEEN ? AND ? AND date <= ? GROUP BY m`).all(start, end, upTo);
  const first = db.prepare("SELECT min(date) d FROM transactions").get().d;
  const s = new Map(spend.map((r) => [r.m, r.v])), i = new Map(inc.map((r) => [r.m, r.v]));
  const out = [];
  for (let k = 0; k < months; k++) {
    const m = shiftMonth(start, k);
    // A month before the first transaction has no data, which is different from $0.
    out.push({ month: m, spent: s.get(m) ?? 0, income: i.get(m) ?? 0, hasData: !!first && monthOf(first) <= m });
  }
  return out;
}

// Suggested budget: the average of the last 3 full months, rounded up to $10.
export function budgets(db, month, upTo = "9999-12-31") {
  const set = new Map(db.prepare("SELECT category, monthly FROM budgets").all().map((r) => [r.category, r.monthly]));
  const spent = new Map(byCategory(db, month, upTo).map((r) => [r.cat, r.spent]));
  const from = shiftMonth(month, -3), to = shiftMonth(month, -1);
  const avg = new Map(db.prepare(`SELECT cat, sum(amount) / 3.0 v FROM tx WHERE ${SPEND_WHERE} AND substr(date, 1, 7) BETWEEN ? AND ? GROUP BY cat`)
    .all(from, to).map((r) => [r.cat, r.v]));
  const cats = new Set([...set.keys(), ...spent.keys(), ...[...avg].filter(([, v]) => v >= 5).map(([k]) => k)]);
  return [...cats].filter((c) => !NOT_SPENDING.includes(c)).map((c) => ({
    category: c, label: LABELS[c] ?? c, budget: set.get(c) ?? null, spent: spent.get(c) ?? 0,
    suggested: avg.get(c) > 0 ? Math.ceil(avg.get(c) / 10) * 10 : null,
  })).sort((a, b) => (b.budget ?? 0) - (a.budget ?? 0) || b.spent - a.spent);
}

export function recurring(db) {
  return db.prepare(`SELECT r.stream_id, r.direction, coalesce(nullif(r.merchant_name, ''), r.description) who, r.description, r.category, r.frequency,
      r.average_amount, r.last_amount, r.last_date, r.predicted_next_date, r.is_active, r.status, a.name account_name, a.mask account_mask
    FROM recurring r LEFT JOIN accounts a ON a.account_id = r.account_id
    ORDER BY r.is_active DESC, r.predicted_next_date`).all().map((r) => ({ ...r, is_transfer: isTransferStream(r) }));
}

// Card payments and transfers among your own accounts repeat, but they aren't bills. Plaid's category alone isn't
// enough: it labels some real bills (Railway hosting) as transfers, so the name decides.
export const isTransferStream = (r) => /\b(pmt|payment|transfer|xfer|autopay)\b/i.test(`${r.who ?? ""} ${r.description ?? ""}`);

const PER_MONTH = { WEEKLY: 52 / 12, BIWEEKLY: 26 / 12, SEMI_MONTHLY: 2, MONTHLY: 1, ANNUALLY: 1 / 12 };
export const monthlyCost = (r) => Math.abs(r.average_amount ?? 0) * (PER_MONTH[r.frequency] ?? 0);

export function upcoming(db, today, days) {
  const until = localDate(new Date(new Date(today + "T12:00:00").getTime() + days * 864e5));
  return recurring(db).filter((r) => r.direction === "outflow" && r.is_active && r.predicted_next_date
    && r.predicted_next_date >= today && r.predicted_next_date <= until && !r.is_transfer);
}

export function transactions(db, { q, account, cat, month, limit = 100, offset = 0 }) {
  const where = [], args = [];
  if (q) { where.push("(name LIKE ? OR merchant_name LIKE ?)"); args.push(`%${q}%`, `%${q}%`); }
  if (account) { where.push("account_id = ?"); args.push(account); }
  if (cat) { where.push("cat = ?"); args.push(cat); }
  if (month) { where.push("substr(date, 1, 7) = ?"); args.push(month); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db.prepare(`SELECT count(*) n, coalesce(sum(amount), 0) s FROM tx ${w}`).get(...args);
  const rows = db.prepare(`SELECT transaction_id, date, who, name, amount, pending, cat, overridden, ruled, account_name, account_mask, account_id
                           FROM tx ${w} ORDER BY date DESC, transaction_id LIMIT ? OFFSET ?`).all(...args, Math.min(+limit || 100, 500), +offset || 0);
  return { total: total.n, sum: total.s, rows };
}

// A request with bad values: the server answers 400 with the message.
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export function setCategory(db, { transaction_id, category, merchant }) {
  const t = db.prepare("SELECT mkey FROM tx WHERE transaction_id = ?").get(transaction_id);
  if (!t) throw bad("No such transaction");
  if (category && !LABELS[category]) throw bad("Unknown category");
  if (merchant) {
    // A merchant rule covers its past and future transactions, so single overrides on that merchant are dropped.
    if (category) db.prepare("INSERT OR REPLACE INTO rules VALUES (?, ?, ?)").run(t.mkey, category, new Date().toISOString());
    else db.prepare("DELETE FROM rules WHERE merchant = ?").run(t.mkey);
    db.prepare("DELETE FROM overrides WHERE transaction_id IN (SELECT transaction_id FROM tx WHERE mkey = ?)").run(t.mkey);
  } else if (category) db.prepare("INSERT OR REPLACE INTO overrides VALUES (?, ?)").run(transaction_id, category);
  else db.prepare("DELETE FROM overrides WHERE transaction_id = ?").run(transaction_id);
  return { ok: true };
}

export function setBudget(db, { category, monthly }) {
  if (!LABELS[category] || NOT_SPENDING.includes(category)) throw bad("Unknown category");
  if (monthly == null || monthly === "") db.prepare("DELETE FROM budgets WHERE category = ?").run(category);
  else {
    const v = Number(monthly);
    if (!Number.isFinite(v) || v < 0) throw bad("Budget must be a positive number");
    db.prepare("INSERT OR REPLACE INTO budgets VALUES (?, ?)").run(category, Math.round(v * 100) / 100);
  }
  return { ok: true };
}

// The overview for one month. For the current month, "so far" means through today, and last month is compared
// through the same day. A past month is shown whole.
export function summary(db, today = localDate(), month = monthOf(today)) {
  const current = month === monthOf(today);
  const days = daysIn(month);
  const day = current ? Number(today.slice(8, 10)) : days;
  const end = `${month}-${pad2(day)}`;
  const prev = shiftMonth(month, -1);
  const prevSameDay = `${prev}-${pad2(Math.min(day, daysIn(prev)))}`;
  const income = db.prepare(`SELECT coalesce(-sum(amount), 0) v FROM tx WHERE ${INCOME_WHERE} AND substr(date, 1, 7) = ? AND date <= ?`).get(month, today).v;
  const rows = budgets(db, month, today);
  const first = db.prepare("SELECT min(date) d FROM transactions").get().d;
  return {
    today, month, current, day, days,
    // False for a month before the first transaction: nothing was recorded then, which is not the same as $0.
    hasData: !!first && monthOf(first) <= month,
    netWorth: netWorth(db),
    netWorthHistory: netWorthHistory(db, 365, today),
    spent: spentBetween(db, `${month}-01`, end),
    spentLastMonthSoFar: spentBetween(db, `${prev}-01`, prevSameDay),
    spentLastMonth: spentBetween(db, `${prev}-01`, `${prev}-31`),
    income,
    budgets: rows.filter((b) => b.budget != null),
    unset: rows.filter((b) => b.budget == null),
    categories: byCategory(db, month, today),
    upcoming: upcoming(db, today, 14),
    bills: recurring(db).filter((r) => r.direction === "outflow" && r.is_active && !r.is_transfer).map((r) => ({ ...r, monthly: monthlyCost(r) })),
    recent: transactions(db, { month: current ? undefined : month, limit: 8 }).rows,
    history: history(db, 12, monthOf(today), today),
  };
}

// Alerts for the daily Discord post. Each key is sent once, so a quiet day posts nothing.
export function dailyAlerts(db, { today = localDate(), bigCharge = 200 } = {}) {
  const out = [];
  const sent = db.prepare("SELECT 1 FROM alerts_sent WHERE key = ?");
  const add = (key, text) => { if (!sent.get(key)) out.push({ key, text }); };
  const week = (() => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDate(d); })();
  for (const it of db.prepare("SELECT item_id, institution_name, last_error FROM items WHERE last_error IS NOT NULL").all()) {
    // A broken connection repeats once a week until it's fixed.
    add(`broken:${it.item_id}:${week}`, `${it.institution_name} isn't syncing: ${it.last_error.split("\n")[0]}. Open tally's Accounts page to fix it.`);
  }
  // Ten days back, not three: a bank can post a charge days after its date. Each charge alerts once, by its id.
  const since = localDate(new Date(new Date(today + "T12:00:00").getTime() - 10 * 864e5));
  for (const t of db.prepare(`SELECT transaction_id, date, who, amount, account_name FROM tx WHERE ${SPEND_WHERE} AND pending = 0 AND amount >= ? AND date >= ? ORDER BY date`).all(bigCharge, since)) {
    add(`big:${t.transaction_id}`, `Large charge: $${t.amount.toFixed(2)} at ${t.who} on ${t.date} (${t.account_name}).`);
  }
  const month = monthOf(today);
  for (const b of budgets(db, month, today)) {
    if (b.budget != null && b.spent > b.budget + 0.005) {
      add(`budget:${b.category}:${month}`, `${b.label} is over budget: $${b.spent.toFixed(0)} of $${b.budget.toFixed(0)} this month.`);
    }
  }
  return out;
}

export function markSent(db, keys) {
  const st = db.prepare("INSERT OR IGNORE INTO alerts_sent VALUES (?, ?)");
  for (const k of keys) st.run(k, new Date().toISOString());
}

// Weekly delivery payouts for another local app, by the week the work happened (Monday to Sunday).
// Each platform pays on its own schedule, matched against the owner's typed weeks on 2026-11-12:
// - Courier pays into Courier Card the day after a dash, so a payout counts for the day before.
// - Rides pays into the Rides Pay per trip, with a timestamp. Rides' week ends Monday 4:00am Eastern.
// - Feast pays into Bank a week late, so a deposit counts for 7 days earlier.
// The old Courier ACH deposits into Bank were cash-outs, not weekly pay, so they are left out.
// A week before a source's first transaction is unknown, not $0, and is left out.
const TZ = "America/New_York";
const mondayOf = (date) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const addDays = (date, n) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const easternDate = (iso, minusHours = 0) => new Date(new Date(iso).getTime() - minusHours * 3600e3).toLocaleDateString("en-CA", { timeZone: TZ });

export const PAYOUT_SOURCES = {
  courier: { institution: "Courier Card", match: (t) => /^courier payout/i.test(t.name), workDate: (t) => addDays(t.date, -1) },
  rides: { institution: "Rides Pay", match: (t) => /^(delivery|miscellaneous)$/i.test(t.name), workDate: (t) => (t.datetime ? easternDate(t.datetime, 4) : t.date) },
  feast: { institution: null, match: (t) => /feast/i.test(`${t.merchant_name ?? ""} ${t.name}`) && t.category === "INCOME", workDate: (t) => addDays(t.date, -7) },
};

export function payouts(db) {
  const rows = db.prepare(`SELECT t.date, t.name, t.merchant_name, t.amount, t.category, t.pending, json_extract(t.raw, '$.datetime') datetime,
      i.institution_name inst, a.type account_type
    FROM transactions t JOIN items i USING (item_id) JOIN accounts a ON a.account_id = t.account_id
    WHERE t.amount < 0 AND a.type = 'depository'`).all();
  const first = new Map(db.prepare(`SELECT i.institution_name inst, min(t.date) d FROM transactions t JOIN items i USING (item_id) GROUP BY 1`).all().map((r) => [r.inst, r.d]));
  const weeks = {}, sources = {};
  for (const [key, src] of Object.entries(PAYOUT_SOURCES)) {
    const mine = rows.filter((t) => (src.institution ? t.inst === src.institution : true) && src.match(t));
    const start = src.institution ? first.get(src.institution) : mine.map((t) => first.get(t.inst)).sort()[0];
    if (!start) continue;
    // The first full week after the source's history begins.
    const from = mondayOf(addDays(start, 6));
    sources[key] = { account: src.institution ?? "deposits into your bank", from };
    for (const t of mine) {
      const wk = mondayOf(src.workDate(t));
      if (wk < from) continue;
      (weeks[wk] ??= {})[key] = Math.round(((weeks[wk][key] ?? 0) - t.amount) * 100) / 100;
    }
  }
  return { sources, weeks };
}
