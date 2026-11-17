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
  add.run("t5", "chk", "2026-11-06", "ACME PAYROLL", "Acme", -500, "INCOME", "INCOME_WAGES");
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
  st.run("s3", "BANK FUNDS TRANSFER DB", null, "TRANSFER_OUT", 100);
  const up = r.upcoming(db, "2026-11-12", 14);
  assert.deepEqual(up.map((x) => x.who), ["Railway"]);
  assert.equal(r.recurring(db).find((x) => x.stream_id === "s1").who, "BIG BANK ONLINE PMT");
});

test("payouts land in the week the work happened", () => {
  const db = fixture();
  // Made-up gig platforms, each paying on its own schedule, the way a payouts file describes them.
  const sources = {
    courier: { institution: "Courier Card", match: (t) => /^courier payout/i.test(t.name), workDate: (t) => r.addDays(t.date, -1) },
    rides: { institution: "Rides Pay", match: (t) => /^(delivery|miscellaneous)$/i.test(t.name), workDate: (t) => (t.datetime ? r.easternDate(t.datetime, 4) : t.date) },
    feast: { institution: null, match: (t) => /feast/i.test(`${t.merchant_name ?? ""} ${t.name}`) && t.category === "INCOME", workDate: (t) => r.addDays(t.date, -7) },
  };
  db.exec(`INSERT INTO items (item_id, institution_name, created_at) VALUES ('dd', 'Courier Card', '2026-11-01'), ('ue', 'Rides Pay', '2026-11-01');
    INSERT INTO accounts (account_id, item_id, name, type) VALUES ('ddc', 'dd', 'Courier', 'depository'), ('uec', 'ue', 'Rides', 'depository');`);
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, raw) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)");
  add.run("d0", "dd", "ddc", "2026-10-18", "Courier Payout", null, -1, "INCOME", "{}");
  add.run("d1", "dd", "ddc", "2026-10-26", "Courier Payout", null, -108.4, "INCOME", "{}"); // Monday: Sunday's work
  add.run("d2", "dd", "ddc", "2026-10-27", "Courier Payout", null, -28.6, "INCOME", "{}");
  add.run("u0", "ue", "uec", "2026-10-18", "Delivery", null, -1, "TRANSFER_IN", JSON.stringify({ datetime: "2026-10-18T15:00:00Z" }));
  add.run("u1", "ue", "uec", "2026-10-26", "Delivery", null, -10, "TRANSFER_IN", JSON.stringify({ datetime: "2026-10-26T06:30:00Z" })); // 2:30am Monday Eastern
  add.run("u2", "ue", "uec", "2026-10-26", "Miscellaneous", null, -5, "TRANSFER_IN", JSON.stringify({ datetime: "2026-10-26T09:30:00Z" })); // 5:30am Monday
  add.run("u3", "ue", "uec", "2026-10-27", "Account unload to ACH", null, -50, "TRANSFER_OUT", "{}");
  add.run("g1", "i1", "chk", "2026-10-28", "FEAST", "Feast", -67.54, "INCOME", "{}");
  const p = r.payouts(db, sources);
  assert.deepEqual(r.payouts(db), { sources: {}, weeks: {} }, "off without a payouts file");
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

test("search ignores case, spaces, and punctuation, and finds amounts and category names", () => {
  const db = fixture();
  db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, category_detail) VALUES (?, 'i1', 'card', '2026-11-09', ?, ?, ?, 0, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_FAST_FOOD')")
    .run("t9", "MCDONALD'S F1234", "McDonald's", 6.75);
  const ids = (q) => r.transactions(db, { q }).rows.map((t) => t.transaction_id).sort();
  assert.deepEqual(ids("mcdonalds"), ["t9"]);
  assert.deepEqual(ids("Mc Donald's"), ["t9"]);
  assert.deepEqual(ids("6.75"), ["t9"]);
  assert.deepEqual(ids("$250"), ["t7"]);
  assert.deepEqual(ids("300"), ["t3", "t4"]);
  assert.deepEqual(ids("groc"), ["t2"]);
  assert.equal(r.transactions(db, { q: "'" }).total, r.transactions(db, {}).total);
});

test("a merchant rule is flagged, so the page can offer to undo it", () => {
  const db = fixture();
  r.setCategory(db, { transaction_id: "t1", category: "TRAVEL", merchant: true });
  const row = r.transactions(db, { cat: "TRAVEL" }).rows[0];
  assert.equal(row.ruled, 1);
  assert.equal(row.overridden, 0);
});

test("a charge dated after today doesn't count yet anywhere in the month", () => {
  const db = fixture();
  const s = r.summary(db, "2026-11-04");
  assert.equal(s.spent, 100);
  assert.equal(s.categories.reduce((t, c) => t + c.spent, 0), 100, "categories stop at today too");
  assert.equal(s.income, 0, "the Nov 6 paycheck hasn't happened yet");
});

test("a large charge that arrives days late still alerts, and a $0 budget can be over", () => {
  const db = fixture();
  r.setBudget(db, { category: "GAS", monthly: 0 });
  const a = r.dailyAlerts(db, { today: "2026-11-14", bigCharge: 200 });
  assert.ok(a.some((x) => x.key === "big:t7"), "the Nov 8 charge, six days back");
  assert.ok(a.some((x) => x.key === "budget:GAS:2026-11"));
});

test("a bill takes the logo from its merchant's transactions, once tally has a copy", () => {
  const db = fixture();
  const url = "https://plaid-merchant-logos.plaid.com/streamco.png";
  db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, raw) VALUES ('s1', 'i1', 'chk', '2026-10-20', 'STREAMCO 123', 'StreamCo', 9.99, 0, 'ENTERTAINMENT', ?)").run(JSON.stringify({ logo_url: url }));
  db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, frequency, average_amount, is_active) VALUES ('st1', 'i1', 'outflow', 'STREAMCO', 'StreamCo', 'MONTHLY', 9.99, 1)").run();
  assert.equal(r.recurring(db)[0].logo, null, "no copy yet");
  r.logos.set(r.logoId(url), `${r.logoId(url)}.png`);
  try {
    assert.equal(r.recurring(db)[0].logo, `/logo/${r.logoId(url)}`);
    assert.equal(r.transactions(db, {}).rows.find((t) => t.transaction_id === "s1").logo, `/logo/${r.logoId(url)}`);
  } finally { r.logos.clear(); }
});

test("a bill with a merchant name never takes another merchant's logo through a shared description", () => {
  const db = fixture();
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, raw) VALUES (?, 'i1', 'chk', ?, 'ACH DEBIT', ?, 20, 0, 'RENT_AND_UTILITIES', ?)");
  const url = (m) => `https://plaid-merchant-logos.plaid.com/${m}.png`;
  add.run("u1", "2026-10-01", "UtilityCo", JSON.stringify({ logo_url: url("utility") }));
  add.run("g1", "2026-11-01", "GymCo", JSON.stringify({ logo_url: url("gym") }));
  for (const m of ["utility", "gym"]) r.logos.set(r.logoId(url(m)), "x.png");
  db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, is_active) VALUES ('b1', 'i1', 'outflow', 'ACH DEBIT', 'UtilityCo', 1)").run();
  try { assert.equal(r.recurring(db)[0].logo, `/logo/${r.logoId(url("utility"))}`); } finally { r.logos.clear(); }
});

test("phone and internet are subscriptions, metered utilities aren't, and a stream Plaid calls a transfer still counts", () => {
  const db = fixture();
  const st = db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, category, category_detail, frequency, average_amount, is_active, status) VALUES (?, 'i1', 'outflow', ?, ?, ?, ?, ?, 10, 1, ?)");
  st.run("phone", "T-MOBILE", "PhoneCo", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_TELEPHONE", "MONTHLY", "MATURE");
  st.run("net", "NETCO", "NetCo", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_INTERNET_AND_CABLE", "MONTHLY", "MATURE");
  st.run("power", "POWERCO", "PowerCo", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", "MONTHLY", "MATURE");
  st.run("host", "HOSTCO", "HostCo", "TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER", "MONTHLY", "MATURE");
  st.run("card", "BANK ONLINE PMT", "", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "MONTHLY", "MATURE");
  st.run("odd", "PWP*SHOP", "", "HOME_IMPROVEMENT", "HOME_IMPROVEMENT_SECURITY", "UNKNOWN", "MATURE");
  st.run("new", "NEWCO", "NewCo", "ENTERTAINMENT", "ENTERTAINMENT_MUSIC_AND_AUDIO", "MONTHLY", "EARLY_DETECTION");
  const subs = r.recurring(db).filter((x) => x.subscription).map((x) => x.stream_id).sort();
  assert.deepEqual(subs, ["host", "net", "phone"], "no schedule and early guesses stay out until the owner adds them");
  r.setStreamKind(db, { who: "NewCo", kind: "sub" });
  assert.ok(r.recurring(db).find((x) => x.stream_id === "new").subscription);
});

test("subscriptions: everything repeating except housing, utilities, loans, insurance, fees, and transfers; the owner can move one", () => {
  const db = fixture();
  const st = db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, category, category_detail, frequency, average_amount, last_amount, is_active) VALUES (?, 'i1', 'outflow', ?, ?, ?, ?, 'MONTHLY', ?, ?, 1)");
  st.run("n", "NETFLIX", "Netflix", "ENTERTAINMENT", "ENTERTAINMENT_TV_AND_MOVIES", 15.49, 17.99);
  st.run("rent", "OAK ST", "Oak Street", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT", 1150, 1150);
  st.run("ins", "GEICO", "Geico", "GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE", 118, 118);
  st.run("gym", "GYM", "Gym", "PERSONAL_CARE", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", 25, 25);
  const subs = () => r.recurring(db).filter((x) => x.subscription).map((x) => x.stream_id).sort();
  assert.deepEqual(subs(), ["gym", "n"]);
  const n = r.recurring(db).find((x) => x.stream_id === "n");
  assert.equal(n.price, 17.99, "the price is the latest charge");
  assert.ok(!("transaction_ids" in n), "the charge list stays on the server");
  r.setStreamKind(db, { who: "Gym", kind: "bill" });
  r.setStreamKind(db, { who: "Geico", kind: "sub" });
  assert.deepEqual(subs(), ["ins", "n"]);
  r.setStreamKind(db, { who: "Gym", kind: null });
  assert.deepEqual(subs(), ["gym", "ins", "n"], "null goes back to tally's guess");
  assert.throws(() => r.setStreamKind(db, { who: "Gym", kind: "maybe" }));
});

test("a price increase: steady charges, then one at least 50 cents more, flagged for one charge and alerted once", () => {
  const db = fixture();
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category) VALUES (?, 'i1', 'card', ?, 'NETFLIX', 'Netflix', ?, 0, 'ENTERTAINMENT')");
  const stream = (id, ids) => db.prepare("INSERT OR REPLACE INTO recurring (stream_id, item_id, direction, description, merchant_name, category, frequency, average_amount, last_amount, is_active, transaction_ids) VALUES (?, 'i1', 'outflow', 'NETFLIX', ?, 'ENTERTAINMENT', 'MONTHLY', 16, 17.99, 1, ?)").run(id, id, JSON.stringify(ids));
  add.run("p1", "2026-08-06", 15.49); add.run("p2", "2026-09-06", 15.49); add.run("p3", "2026-10-06", 15.49); add.run("p4", "2026-11-06", 17.99);
  stream("Netflix", ["p1", "p2", "p3", "p4"]);
  const up = () => r.recurring(db).find((x) => x.stream_id === "Netflix").price_up;
  assert.deepEqual(up(), { from: 15.49, to: 17.99, date: "2026-11-06" });
  const alerts = r.dailyAlerts(db, { today: "2026-11-16", bigCharge: 1000 }).filter((a) => a.key.startsWith("price:"));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].text, /Netflix went up from \$15\.49 to \$17\.99/);
  r.setStreamName(db, { stream_id: "Netflix", name: "Movies" });
  assert.match(r.dailyAlerts(db, { today: "2026-11-16", bigCharge: 1000 }).find((a) => a.key.startsWith("price:")).text, /^Movies went up/, "the owner's name");
  r.setStreamName(db, { stream_id: "Netflix", name: "" });
  assert.equal(r.dailyAlerts(db, { today: "2026-11-16", bigCharge: 1000, priceAlerts: false }).filter((a) => a.key.startsWith("price:")).length, 0, "the setting turns it off");
  assert.equal(r.dailyAlerts(db, { today: "2027-01-10", bigCharge: 1000 }).filter((a) => a.key.startsWith("price:")).length, 0, "an old increase doesn't alert");
  r.markSent(db, [alerts[0].key]);
  assert.equal(r.dailyAlerts(db, { today: "2026-11-16", bigCharge: 1000 }).filter((a) => a.key.startsWith("price:")).length, 0, "once");
  add.run("p5", "2026-12-06", 17.99); stream("Netflix", ["p1", "p2", "p3", "p4", "p5"]);
  assert.equal(up(), null, "the note lasts one charge");
  // One store's mixed subscriptions: the charges before the latest don't match, so nothing is flagged.
  add.run("a1", "2026-09-01", 2.99); add.run("a2", "2026-10-01", 9.99); add.run("a3", "2026-11-01", 12.99);
  stream("Apple", ["a1", "a2", "a3"]);
  assert.equal(r.recurring(db).find((x) => x.stream_id === "Apple").price_up, null);
  // 50 cents exactly, where floating point says 0.4999999999999991.
  add.run("c1", "2026-09-02", 7.7); add.run("c2", "2026-10-02", 7.7); add.run("c3", "2026-11-02", 8.2);
  stream("Cloud", ["c1", "c2", "c3"]);
  assert.deepEqual(r.recurring(db).find((x) => x.stream_id === "Cloud").price_up, { from: 7.7, to: 8.2, date: "2026-11-02" });
  const cloud = r.recurring(db).find((x) => x.stream_id === "Cloud");
  assert.equal(cloud.monthly, cloud.price_monthly, "totals use the latest price");
  assert.notEqual(cloud.monthly, r.monthlyCost(cloud), "not the average");
});

test("a choice on a merchant with an accented capital sticks", () => {
  const db = fixture();
  db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, category, frequency, average_amount, is_active) VALUES ('c', 'i1', 'outflow', 'CAFÉ', 'CAFÉ', 'FOOD_AND_DRINK', 'MONTHLY', 9, 1)").run();
  assert.equal(r.recurring(db)[0].subscription, true);
  r.setStreamKind(db, { who: "CAFÉ", kind: "bill" });
  assert.equal(r.recurring(db)[0].subscription, false);
});

test("a bill's next charge follows its recent charges, not its whole history", () => {
  const db = fixture();
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category) VALUES (?, 'i1', 'chk', ?, ?, ?, ?, 0, 'RENT_AND_UTILITIES')");
  const stream = (id, who, detail, ids) => db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, category, category_detail, frequency, average_amount, last_amount, is_active, status, transaction_ids) VALUES (?, 'i1', 'outflow', ?, ?, 'RENT_AND_UTILITIES', ?, 'MONTHLY', 26.1, ?, 1, 'MATURE', ?)")
    .run(id, who, who, detail, null, JSON.stringify(ids));
  // A fixed price that changed: eight months at 25, then 32.80, then 31 twice.
  const phone = ["2026-02-02", "2026-03-02", "2026-04-02", "2026-05-02", "2026-06-02", "2026-07-02", "2026-08-02"].map((d, i) => (add.run(`f${i}`, d, "POWER", "PowerCo", 25), `f${i}`));
  add.run("f7", "2026-09-02", "POWER", "PowerCo", 32.8); add.run("f8", "2026-10-02", "POWER", "PowerCo", 31); add.run("f9", "2026-11-02", "POWER", "PowerCo", 31);
  stream("fixed", "PowerCo", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", [...phone, "f7", "f8", "f9"]);
  // A bill that varies: the average of the last three.
  add.run("v1", "2026-08-09", "WATER", "WaterCo", 40); add.run("v2", "2026-09-09", "WATER", "WaterCo", 60); add.run("v3", "2026-10-09", "WATER", "WaterCo", 50); add.run("v4", "2026-11-09", "WATER", "WaterCo", 70);
  stream("vary", "WaterCo", "RENT_AND_UTILITIES_WATER", ["v1", "v2", "v3", "v4"]);
  stream("none", "GasCo", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", []);
  const get = (id) => r.recurring(db).find((x) => x.stream_id === id);
  assert.equal(get("fixed").expected, 31);
  assert.equal(get("fixed").monthly, 31);
  assert.equal(get("vary").expected, 60);
  assert.equal(get("none").expected, 26.1, "no charges: Plaid's average");
});

test("a repeating charge can be renamed, one stream at a time", () => {
  const db = fixture();
  const st = db.prepare("INSERT INTO recurring (stream_id, item_id, direction, description, merchant_name, category, frequency, average_amount, last_amount, is_active, status) VALUES (?, 'i1', 'outflow', 'SHOP.COM/BILL', 'SHOP.COM/BILL', 'ENTERTAINMENT', 'MONTHLY', ?, ?, 1, 'MATURE')");
  st.run("a", 2.13, 2.13); st.run("b", 13.9, 13.9);
  const get = (id) => r.recurring(db).find((x) => x.stream_id === id);
  assert.deepEqual(r.setStreamName(db, { stream_id: "a", name: "  Cloud   storage " }), { ok: true });
  assert.equal(get("a").name, "Cloud storage");
  assert.equal(get("b").name, null, "the other charge from the same store keeps Plaid's name");
  assert.equal(get("a").who, "SHOP.COM/BILL", "the merchant stays, for the subscription choice");
  r.setStreamName(db, { stream_id: "a", name: "" });
  assert.equal(get("a").name, null);
  assert.throws(() => r.setStreamName(db, { stream_id: "a", name: "x".repeat(61) }), /60/);
  assert.throws(() => r.setStreamName(db, { stream_id: "nope", name: "X" }), /No such charge/);
});

test("a budget can repeat every few months or fall in one month, and counts only when it's due", () => {
  const db = fixture();
  r.setBudget(db, { category: "GAS", monthly: 120, every: 6, start: "2026-05" }, "2026-11-09");
  r.setBudget(db, { category: "GROCERIES", monthly: 80, every: 0, start: "2026-12" }, "2026-11-09");
  const get = (m, c) => r.budgets(db, m, "2026-11-09").find((b) => b.category === c);
  assert.equal(get("2026-11", "GAS").due, true, "May plus six months");
  assert.equal(get("2026-12", "GAS").due, false);
  assert.equal(get("2026-12", "GAS").next, "2027-05");
  assert.equal(get("2026-04", "GAS").due, false, "nothing before the start");
  assert.equal(get("2026-11", "GROCERIES").due, false);
  assert.equal(get("2026-11", "GROCERIES").next, "2026-12");
  assert.equal(get("2027-01", "GROCERIES").next, null, "a one-month budget that's past has no next month");
  const s = r.summary(db, "2026-11-09");
  assert.deepEqual(s.budgets.map((b) => b.category), ["GAS"]);
  assert.deepEqual(s.later.map((b) => b.category), ["GROCERIES"]);
  assert.equal(s.everythingElse.spent, 60 + 230, "groceries' spending isn't covered this month, so it's Everything else");
  // Changing the amount keeps the repeat.
  r.setBudget(db, { category: "GAS", monthly: 150 }, "2026-11-09");
  assert.equal(get("2026-11", "GAS").every, 6);
  assert.throws(() => r.setBudget(db, { category: "GAS", every: 5 }), /every 1, 2, 3, 6, or 12/);
  assert.throws(() => r.setBudget(db, { category: "GAS", start: "2026-13" }), /month/);
  assert.throws(() => r.setBudget(db, { category: "MEDICAL", every: 2 }), /amount/, "options need an amount first");
});

test("rollover carries what's left, or what went over, into the next month, and reset starts it again", () => {
  const db = fixture();
  const add = db.prepare("INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name, amount, pending, category, category_detail) VALUES (?, 'i1', 'card', ?, 'SHELL', 'Shell', ?, 0, 'TRANSPORTATION', 'TRANSPORTATION_GAS')");
  add.run("g9", "2026-09-12", 70); add.run("g12", "2026-12-02", 10);
  r.setBudget(db, { category: "GAS", monthly: 50, rollover: true }, "2026-09-20");
  const gas = (m, upTo = "2026-12-31") => r.budgets(db, m, upTo).find((b) => b.category === "GAS");
  assert.equal(gas("2026-09").carry, 0, "nothing carries into the first month");
  assert.equal(gas("2026-10").carry, -20, "September went $20 over");
  assert.equal(gas("2026-11").carry, 0, "October was $20 under, which pays back September");
  assert.equal(gas("2026-12").carry, 10, "November spent $40 of $50");
  assert.equal(gas("2026-12").limit, 60);
  assert.equal(gas("2026-08").carry, 0, "a month before rollover started carries nothing");
  r.setBudget(db, { category: "GAS", reset: true }, "2026-12-05");
  assert.equal(gas("2026-12").carry, 0);
  r.setBudget(db, { category: "GAS", every: 3 }, "2026-12-05");
  assert.equal(gas("2026-12").rollover, false, "only a monthly budget rolls over");
});

test("Everything else covers the categories without a budget, and alerts when it goes over", () => {
  const db = fixture();
  r.setBudget(db, { category: "GROCERIES", monthly: 100 });
  r.setBudget(db, { category: r.EVERYTHING_ELSE, monthly: 200, every: 6, rollover: true });
  const s = r.summary(db, "2026-11-09");
  const other = s.budgets.at(-1);
  assert.equal(other.category, r.EVERYTHING_ELSE);
  assert.equal(other.spent, 40 + 230, "gas and shopping");
  assert.equal(other.every, 1, "Everything else is monthly");
  assert.ok(r.dailyAlerts(db, { today: "2026-11-09" }).some((a) => a.key === "budget:EVERYTHING_ELSE:2026-11" && /Everything else is over budget: \$270 of \$200/.test(a.text)));
  assert.equal(r.summary(db, "2026-11-09", "2026-10").budgets.at(-1).spent, 30);
  r.setBudget(db, { category: r.EVERYTHING_ELSE, monthly: null });
  assert.equal(r.summary(db, "2026-11-09").budgets.length, 1);
});

test("goals track an account's balance toward a target, one goal per account", () => {
  const db = fixture();
  r.setGoal(db, { name: "  Rainy   day ", account_id: "chk", target: 4000, by_month: "2027-02" });
  r.setGoal(db, { name: "Card to zero", account_id: "card", target: 0 });
  let [save, debt] = r.goals(db, "2026-11-09");
  assert.equal(save.name, "Rainy day");
  assert.deepEqual([save.done, save.total, save.left, save.reached], [1000, 4000, 3000, false]);
  assert.equal(save.per_month, 750, "$3,000 over November through February");
  assert.deepEqual([debt.done, debt.total, debt.left], [0, 250, 250], "measured from what the card owed when the goal was set");
  db.exec("UPDATE accounts SET current = 100 WHERE account_id = 'card'");
  [, debt] = r.goals(db, "2026-11-09");
  assert.deepEqual([debt.done, debt.left], [150, 100]);
  assert.throws(() => r.setGoal(db, { name: "Two", account_id: "chk", target: 10 }), /already has a goal, Rainy day/);
  assert.throws(() => r.setGoal(db, { name: "Zero", account_id: "brk", target: 0 }), /above \$0/);
  assert.throws(() => r.setGoal(db, { name: "", account_id: "brk", target: 5 }), /name/);
  assert.throws(() => r.setGoal(db, { name: "X", account_id: "nope", target: 5 }), /open account/);
  // Editing keeps the goal on its account; reaching it alerts once.
  r.setGoal(db, { id: save.id, name: "Rainy day", account_id: "chk", target: 900, by_month: "" });
  [save] = r.goals(db, "2026-11-09");
  assert.deepEqual([save.reached, save.by_month, save.per_month], [true, null, null]);
  const a = r.dailyAlerts(db, { today: "2026-11-09" }).filter((x) => x.key.startsWith("goal:"));
  assert.deepEqual(a.map((x) => x.text), ["Goal reached: Rainy day. Checking has $1000."]);
  r.setGoal(db, { id: save.id, remove: true });
  assert.equal(r.goals(db).length, 1);
  assert.equal(r.goals(db, "2027-04-01")[0].late, false, "a goal with no date is never late");
});
