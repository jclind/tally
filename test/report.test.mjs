// The money rules in lib/report.mjs, on a made-up in-memory database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as r from "../lib/report.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE items (item_id TEXT PRIMARY KEY, access_token TEXT, institution_id TEXT, institution_name TEXT, kind TEXT, created_at TEXT, cursor TEXT, last_sync TEXT, last_error TEXT, tx_status TEXT);
    CREATE TABLE accounts (account_id TEXT PRIMARY KEY, item_id TEXT, name TEXT, official_name TEXT, mask TEXT, type TEXT, subtype TEXT, current REAL, available REAL, credit_limit REAL, currency TEXT, updated_at TEXT);
    CREATE TABLE transactions (transaction_id TEXT PRIMARY KEY, item_id TEXT, account_id TEXT, date TEXT, authorized_date TEXT, name TEXT, merchant_name TEXT, amount REAL, currency TEXT, pending INTEGER, pending_transaction_id TEXT, category TEXT, category_detail TEXT, payment_channel TEXT, raw TEXT);
  `);
  r.setupViews(db);
  db.exec(`INSERT INTO items (item_id, institution_name, created_at) VALUES ('i1', 'Bank', '2026-01-01');
    INSERT INTO accounts (account_id, item_id, name, type, current) VALUES
      ('chk', 'i1', 'Checking', 'depository', 1000), ('card', 'i1', 'Card', 'credit', 250), ('brk', 'i1', 'Brokerage', 'investment', 5000);`);
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, category_detail) VALUES (?, 'i1', ?, ?, ?, ?, ?, 0, ?, ?)");
  add.run("t1", "card", "2026-11-03", "SHELL 123", "Shell", 40, "TRANSPORTATION", "TRANSPORTATION_GAS");
  add.run("t2", "card", "2026-11-04", "KROGER", "Kroger", 60, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES");
  add.run("t3", "chk", "2026-11-05", "CARD PAYMENT", null, 300, "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  add.run("t4", "card", "2026-11-05", "PAYMENT THANK YOU", null, -300, "TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER");
  add.run("t5", "chk", "2026-11-06", "COURIER ACH", "Courier", -500, "INCOME", "INCOME_WAGES");
  add.run("t6", "card", "2026-11-07", "AMAZON REFUND", "Amazon", -20, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE");
  add.run("t7", "card", "2026-11-08", "AMAZON", "Amazon", 250, "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ONLINE");
  add.run("t8", "card", "2026-10-10", "SHELL 9", "Shell", 30, "TRANSPORTATION", "TRANSPORTATION_GAS");
  return db;
}

test("net worth subtracts what's owed on cards", () => {
  assert.deepEqual(r.netWorth(fixture()), { cash: 1000, investments: 5000, owed: 250, total: 5750 });
});

test("spending leaves out card payments, transfers, and income, and refunds lower it", () => {
  const db = fixture();
  assert.equal(r.spentBetween(db, "2026-11-01", "2026-11-30"), 40 + 60 - 20 + 250);
  const cats = Object.fromEntries(r.byCategory(db, "2026-11").map((c) => [c.cat, c.spent]));
  assert.deepEqual(cats, { GENERAL_MERCHANDISE: 230, GROCERIES: 60, GAS: 40 });
});

test("a merchant rule recategorizes every transaction from that merchant", () => {
  const db = fixture();
  r.setCategory(db, { transaction_id: "t1", category: "TRAVEL", merchant: true });
  assert.equal(db.prepare("SELECT count(*) n FROM tx WHERE cat = 'TRAVEL'").get().n, 2);
  r.setCategory(db, { transaction_id: "t8", category: "GAS", merchant: false });
  assert.equal(db.prepare("SELECT cat FROM tx WHERE transaction_id = 't8'").get().cat, "GAS", "a single override beats the rule");
  r.setCategory(db, { transaction_id: "t1", category: null, merchant: true });
  assert.equal(db.prepare("SELECT count(*) n FROM tx WHERE cat = 'GAS'").get().n, 2);
});

test("unknown categories and budgets on transfers are refused", () => {
  const db = fixture();
  assert.throws(() => r.setCategory(db, { transaction_id: "t1", category: "NOPE" }));
  assert.throws(() => r.setBudget(db, { category: "TRANSFER", monthly: 10 }));
  assert.throws(() => r.setBudget(db, { category: "GAS", monthly: -5 }));
});

test("daily alerts: large charge, over budget, broken connection, each sent once", () => {
  const db = fixture();
  r.setBudget(db, { category: "GROCERIES", monthly: 50 });
  db.exec("UPDATE items SET last_error = 'ITEM_LOGIN_REQUIRED: sign in again'");
  const a = r.dailyAlerts(db, { today: "2026-11-09", bigCharge: 200 });
  assert.deepEqual(a.map((x) => x.key.split(":")[0]).sort(), ["big", "broken", "budget"]);
  assert.match(a.find((x) => x.key.startsWith("big")).text, /\$250\.00 at Amazon/);
  r.markSent(db, a.map((x) => x.key));
  assert.equal(r.dailyAlerts(db, { today: "2026-11-09" }).length, 0);
  assert.equal(r.dailyAlerts(db, { today: "2026-11-17" }).length, 1, "a broken connection repeats the next week");
});

test("months before the first transaction are marked as no data", () => {
  const h = r.history(fixture(), 3, "2026-11");
  assert.deepEqual(h.map((x) => [x.month, x.hasData]), [["2026-09", false], ["2026-10", true], ["2026-11", true]]);
});

test("budget suggestion is the 3-month average rounded up to $10", () => {
  const b = r.budgets(fixture(), "2026-12").find((x) => x.category === "GAS");
  assert.equal(b.suggested, Math.ceil((30 + 40) / 3 / 10) * 10);
});

test("an empty merchant name falls back to the description, and payments aren't bills", () => {
  const db = fixture();
  const st = db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, category, frequency, average_amount, predicted_next_date, is_active) VALUES (?, 'i1', 'outflow', ?, ?, ?, 'MONTHLY', ?, '2026-11-20', 1)");
  st.run("s1", "BIG BANK ONLINE PMT", "", "LOAN_PAYMENTS", 205);
  st.run("s2", "RAILWAY", "Railway", "TRANSFER_OUT", 5.25);
  st.run("s3", "Bank FUNDS TRANSFER DB", null, "TRANSFER_OUT", 100);
  const up = r.upcoming(db, "2026-11-12", 14);
  assert.deepEqual(up.map((x) => x.who), ["Railway"]);
  assert.equal(r.recurring(db).find((x) => x.stream_id === "s1").who, "BIG BANK ONLINE PMT");
});

test("payouts land in the week the work happened", () => {
  const db = fixture();
  db.exec(`INSERT INTO items (item_id, institution_name, created_at) VALUES ('dd', 'Courier Card', '2026-11-01'), ('ue', 'Rides Pay', '2026-11-01');
    INSERT INTO accounts (account_id, item_id, name, type) VALUES ('ddc', 'dd', 'Courier', 'depository'), ('uec', 'ue', 'Rides', 'depository');`);
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, raw) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)");
  add.run("d0", "dd", "ddc", "2026-10-18", "Courier Payout", null, -1, "INCOME", "{}");
  add.run("d1", "dd", "ddc", "2026-10-26", "Courier Payout", null, -108.4, "INCOME", "{}"); // Monday: Sunday's dash
  add.run("d2", "dd", "ddc", "2026-10-27", "Courier Payout", null, -28.6, "INCOME", "{}");
  add.run("u0", "ue", "uec", "2026-10-18", "Delivery", null, -1, "TRANSFER_IN", JSON.stringify({ datetime: "2026-10-18T15:00:00Z" }));
  add.run("u1", "ue", "uec", "2026-10-26", "Delivery", null, -10, "TRANSFER_IN", JSON.stringify({ datetime: "2026-10-26T06:30:00Z" })); // 2:30am Monday Eastern
  add.run("u2", "ue", "uec", "2026-10-26", "Miscellaneous", null, -5, "TRANSFER_IN", JSON.stringify({ datetime: "2026-10-26T09:30:00Z" })); // 5:30am Monday
  add.run("u3", "ue", "uec", "2026-10-27", "Account unload to ACH", null, -50, "TRANSFER_OUT", "{}");
  add.run("g1", "i1", "chk", "2026-10-28", "FEAST", "Feast", -67.54, "INCOME", "{}");
  const p = r.payouts(db);
  assert.equal(p.weeks["2026-10-19"].courier, 108.4);
  assert.equal(p.weeks["2026-10-26"].courier, 28.6);
  assert.equal(p.weeks["2026-10-19"].rides, 10, "before 4am Monday is last week");
  assert.equal(p.weeks["2026-10-26"].rides, 5);
  assert.equal(p.weeks["2026-10-19"].feast, 67.54, "Feast pays a week late");
  assert.equal(p.weeks["2026-10-12"], undefined, "the partial first week is left out");
});

test("a past month's summary covers the whole month and compares to the month before it", () => {
  const db = fixture();
  r.setBudget(db, { category: "GAS", monthly: 25 });
  const s = r.summary(db, "2026-11-04", "2026-10");
  assert.equal(s.current, false);
  assert.equal(s.day, 31, "a past month counts every day");
  assert.equal(s.spent, 30);
  assert.deepEqual(s.budgets.map((b) => [b.category, b.spent]), [["GAS", 30]]);
  assert.ok(s.recent.every((t) => t.date.startsWith("2026-10")), "recent activity is that month's");
  const now = r.summary(db, "2026-11-04");
  assert.equal(now.current, true);
  assert.equal(now.spent, 40 + 60, "this month runs through today only");
  assert.ok(now.unset.some((b) => b.category === "GROCERIES"), "categories without a budget come back as unset");
});

test("daily balances: cards count against net worth, and a second sync the same day replaces the first", () => {
  const db = fixture();
  r.recordBalances(db, "2026-11-01");
  db.exec("UPDATE accounts SET current = 1500 WHERE account_id = 'chk'");
  r.recordBalances(db, "2026-11-02");
  db.exec("UPDATE accounts SET current = 1600 WHERE account_id = 'chk'");
  r.recordBalances(db, "2026-11-02");
  const h = r.netWorthHistory(db, 30, "2026-11-02");
  assert.deepEqual(h.map((x) => [x.date, x.total]), [["2026-11-01", 1000 - 250 + 5000], ["2026-11-02", 1600 - 250 + 5000]]);
});

test("only YYYY-MM is a month", () => {
  assert.ok(r.isMonth("2026-11"));
  for (const m of ["2026-13", "2026-1", "x", "", null, "2026-11-01"]) assert.ok(!r.isMonth(m), String(m));
});

test("a category with only refunds still counts, so category totals match the month's spending", () => {
  const db = fixture();
  db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, category_detail) VALUES ('t9', 'i1', 'card', '2026-11-09', 'SPA REFUND', 'Spa', -15, 0, 'PERSONAL_CARE', 'PERSONAL_CARE_OTHER')").run();
  const cats = r.byCategory(db, "2026-11");
  assert.equal(cats.find((c) => c.cat === "PERSONAL_CARE").spent, -15);
  assert.equal(Math.round(cats.reduce((s, c) => s + c.spent, 0) * 100) / 100, r.spentBetween(db, "2026-11-01", "2026-11-30"));
});

test("bad budget and category requests are 400s, and a month before any history has no data", () => {
  const db = fixture();
  for (const f of [() => r.setBudget(db, { category: "GAS", monthly: "abc" }), () => r.setBudget(db, { category: "NOPE", monthly: 5 }), () => r.setCategory(db, { transaction_id: "nope", category: "GAS" })]) {
    assert.throws(f, (e) => e.status === 400);
  }
  assert.equal(r.summary(db, "2026-11-12", "2025-01").hasData, false);
  assert.equal(r.summary(db, "2026-11-12", "2026-10").hasData, true);
});

test("a merchant rule is flagged, so the page can offer to undo it", () => {
  const db = fixture();
  r.setCategory(db, { transaction_id: "t1", category: "TRAVEL", merchant: true });
  const row = r.transactions(db, { cat: "TRAVEL" }).rows[0];
  assert.equal(row.ruled, 1);
  assert.equal(row.overridden, 0);
});
