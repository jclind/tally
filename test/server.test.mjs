// Runs server.mjs against a fake Plaid server. No real keys or accounts are involved.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tally-test-"));
const calls = [];
let fake, app, base;

const acct = { account_id: "acc1", name: "Checking", mask: "1234", type: "depository", subtype: "checking", balances: { current: 100, available: 90, iso_currency_code: "USD" } };
const tx = (id, amount, date = "2026-11-01") => ({ transaction_id: id, account_id: "acc1", date, name: `Store ${id}`, merchant_name: null, amount, pending: false, iso_currency_code: "USD", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } });

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

const plaidReplies = {
  "/link/token/create": () => ({ link_token: "link-test" }),
  "/item/public_token/exchange": () => ({ item_id: "item1", access_token: "access-test" }),
  "/accounts/get": () => ({ accounts: [acct] }),
  // Two pages on the first sync, then a modify and a remove on the next.
  "/transactions/sync": (b) => {
    if (!b.cursor) return { added: [tx("t1", 10), tx("t2", 20)], modified: [], removed: [], next_cursor: "c1", has_more: true, accounts: [acct], transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" };
    if (b.cursor === "c1") return { added: [tx("t3", 30, "2025-01-05")], modified: [], removed: [], next_cursor: "c2", has_more: false };
    return { added: [], modified: [tx("t1", 11)], removed: [{ transaction_id: "t2" }], next_cursor: "c3", has_more: false };
  },
  "/investments/holdings/get": () => ({ status: 400, error_code: "PRODUCTS_NOT_SUPPORTED", error_message: "not supported" }),
  "/transactions/recurring/get": () => ({ outflow_streams: [{ stream_id: "s1", account_id: "acc1", merchant_name: "Netflix", frequency: "MONTHLY",
    average_amount: { amount: 15.49 }, predicted_next_date: "2026-11-20", is_active: true, transaction_ids: ["t1"],
    personal_finance_category: { primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES" } }], inflow_streams: [] }),
};

before(async () => {
  fake = http.createServer((req, res) => {
    // Logo images for the logo test: a PNG, and a page that claims to be one but isn't an image.
    if (req.method === "GET") {
      calls.push({ path: req.url });
      if (req.url === "/logo.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(PNG); }
      res.writeHead(200, { "content-type": "text/html" }); return res.end("<script>alert(1)</script>");
    }
    let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => {
      const body = JSON.parse(s); calls.push({ path: req.url, body });
      const out = plaidReplies[req.url]?.(body) ?? { status: 404, error_code: "NOPE" };
      if (out.drop) return req.socket.destroy();
      res.writeHead(out.status ?? 200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  writeFileSync(join(dir, "plaid.env"), `PLAID_CLIENT_ID=cid\nPLAID_SECRET=sec\nPLAID_HOST=http://127.0.0.1:${fake.address().port}\n`);
  const port = 34000 + Math.floor(Math.random() * 1000);
  base = `http://localhost:${port}`;
  app = spawn(process.execPath, [join(root, "server.mjs")], { env: { ...process.env, TALLY_PORT: String(port), TALLY_KEYS: join(dir, "plaid.env"), TALLY_DATA: join(dir, "data"), TALLY_DISCORD: join(dir, "discord.env"), TALLY_PAYOUTS: join(dir, "payouts.mjs"), TALLY_LOGO_HOSTS: `127.0.0.1:${fake.address().port}` }, stdio: "pipe" });
  for (let i = 0; i < 50; i++) {
    if (await fetch(base + "/api/status").then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});

// Windows won't delete a database file a process still holds, so wait for the server to exit before cleaning up.
const stop = (child) => new Promise((done) => { if (!child || child.exitCode !== null) return done(); child.once("exit", done); child.kill(); });

after(async () => { await stop(app); fake?.close(); rmSync(dir, { recursive: true, force: true }); });

const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) }).then((r) => r.json());

test("link token asks for 730 days and the right products", async () => {
  assert.equal((await post("/api/link-token", { kind: "bank" })).link_token, "link-test");
  const b = calls.at(-1).body;
  assert.deepEqual(b.products, ["transactions"]);
  assert.equal(b.transactions.days_requested, 730);
  assert.equal(b.secret, "sec");
  await post("/api/link-token", { kind: "brokerage" });
  assert.deepEqual(calls.at(-1).body.products, ["investments"]);
});

test("exchange stores the item and pulls every page", async () => {
  await post("/api/exchange", { public_token: "pub", institution: { institution_id: "ins_1", name: "Test Bank" }, kind: "bank" });
  const s = await fetch(base + "/api/status").then((r) => r.json());
  assert.equal(s.used, 1);
  const it = s.items[0];
  assert.equal(it.institution_name, "Test Bank");
  assert.equal(it.tx.n, 3);
  assert.equal(it.tx.first, "2025-01-05");
  assert.equal(it.accounts[0].current, 100);
  assert.equal(it.last_error, null, "an unsupported product is a note, not an error");
  assert.ok(!JSON.stringify(s).includes("access-test"), "status never returns the access token");
});

test("a later sync applies modified and removed", async () => {
  await post("/api/sync", {});
  const it = (await fetch(base + "/api/status").then((r) => r.json())).items[0];
  assert.equal(it.tx.n, 2);
  assert.ok(it.recent.some((t) => t.amount === 11));
  assert.equal(calls.filter((c) => c.path === "/transactions/sync").at(-1).body.cursor, "c2");
});

test("a dropped connection is retried once", async () => {
  let drops = 1;
  const real = plaidReplies["/accounts/get"];
  plaidReplies["/accounts/get"] = () => (drops-- > 0 ? { drop: true } : real());
  const { results } = await post("/api/sync", {});
  plaidReplies["/accounts/get"] = real;
  assert.deepEqual(results[0].errors, []);
});

const status = () => fetch(base + "/api/status").then((r) => r.json());
const withReplies = async (over, fn) => {
  const saved = {}; for (const k of Object.keys(over)) { saved[k] = plaidReplies[k]; plaidReplies[k] = over[k]; }
  try { return await fn(); } finally { Object.assign(plaidReplies, saved); }
};

test("a sync that Plaid interrupts mid-paging restarts from its first cursor and counts each charge once", async () => {
  const start = (await status()).items[0];
  const before = start.tx.n;
  let mutated = 0;
  const seen = [];
  await withReplies({
    "/transactions/sync": (b) => {
      seen.push(b.cursor);
      if (b.cursor === "c3") return { added: [tx("m1", 50)], modified: [], removed: [], next_cursor: "c3a", has_more: true };
      if (b.cursor === "c3a" && mutated++ === 0) return { status: 400, error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_message: "changed" };
      return { added: [tx("m2", 5)], modified: [], removed: [], next_cursor: "c4", has_more: false };
    },
  }, async () => {
    const { results } = await post("/api/sync", {});
    assert.deepEqual(results[0].errors, []);
  });
  assert.deepEqual(seen, ["c3", "c3a", "c3", "c3a"], "the retry starts again from c3");
  assert.equal((await status()).items[0].tx.n, before + 2, "m1 and m2, each once");
});

test("a category set on a pending charge follows it when it posts", async () => {
  const pend = { ...tx("pend1", 42), pending: true };
  await withReplies({ "/transactions/sync": () => ({ added: [pend], modified: [], removed: [], next_cursor: "c5", has_more: false }) }, () => post("/api/sync", {}));
  assert.deepEqual(await post("/api/category", { transaction_id: "pend1", category: "TRAVEL" }), { ok: true });
  const posted = { ...tx("post1", 42), pending_transaction_id: "pend1" };
  await withReplies({ "/transactions/sync": () => ({ added: [posted], modified: [], removed: [{ transaction_id: "pend1" }], next_cursor: "c6", has_more: false }) }, () => post("/api/sync", {}));
  const rows = (await fetch(base + "/api/transactions?q=post1").then((r) => r.json())).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cat, "TRAVEL");
});

test("a sync copies merchant logos once, and the page loads only the copy", async () => {
  const host = `http://127.0.0.1:${fake.address().port}`;
  const withLogo = { ...tx("lg1", 7), merchant_name: "Logo Shop", logo_url: `${host}/logo.png` };
  const notImage = { ...tx("lg2", 8), merchant_name: "Odd Shop", logo_url: `${host}/page.png` };
  const offList = { ...tx("lg3", 9), merchant_name: "Far Shop", logo_url: "https://example.com/logo.png" };
  await withReplies({ "/transactions/sync": () => ({ added: [withLogo, notImage, offList], modified: [], removed: [], next_cursor: "c7", has_more: false }) }, () => post("/api/sync", {}));
  const row = async (id) => (await fetch(base + `/api/transactions?q=${id}`).then((r) => r.json())).rows[0];
  let logo = null; // the download runs after the sync returns
  for (let i = 0; i < 40 && !logo; i++) logo = (await row("lg1")).logo ?? await new Promise((r) => setTimeout(r, 50));
  assert.match(logo, /^\/logo\/[0-9a-f]{20}$/);
  const img = await fetch(base + logo);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
  assert.equal((await row("lg2")).logo, null, "a reply that isn't an image is never saved");
  assert.equal((await row("lg3")).logo, null, "only Plaid's logo hosts are fetched");
  assert.equal((await fetch(base + "/logo/0123456789abcdef0123")).status, 404);
  const fetched = calls.filter((c) => c.path === "/logo.png").length;
  await withReplies({ "/transactions/sync": () => ({ added: [], modified: [], removed: [], next_cursor: "c8", has_more: false }) }, () => post("/api/sync", {}));
  assert.equal(calls.filter((c) => c.path === "/logo.png").length, fetched, "a saved logo isn't downloaded again");
});

test("a repeating charge is a subscription until the owner says otherwise", async () => {
  const net = async () => (await fetch(base + "/api/recurring").then((r) => r.json())).find((x) => x.stream_id === "s1");
  assert.equal((await net()).subscription, true);
  assert.equal((await net()).category_detail, "ENTERTAINMENT_TV_AND_MOVIES");
  assert.deepEqual(await post("/api/stream-kind", { who: "Netflix", kind: "bill" }), { ok: true });
  assert.equal((await net()).subscription, false);
  await post("/api/stream-kind", { who: "Netflix", kind: null });
  assert.equal((await net()).subscription, true);
});

test("an account Plaid stops listing is closed: kept, but out of net worth", async () => {
  const acct2 = { ...acct, account_id: "acc2", name: "Old Savings", balances: { current: 2000 } };
  const quiet = () => ({ added: [], modified: [], removed: [], next_cursor: "c7", has_more: false });
  await withReplies({ "/accounts/get": () => ({ accounts: [acct, acct2] }), "/transactions/sync": quiet }, () => post("/api/sync", {}));
  const nw1 = (await fetch(base + "/api/summary").then((r) => r.json())).netWorth.cash;
  await withReplies({ "/transactions/sync": quiet }, () => post("/api/sync", {}));
  const s = await status();
  const old = s.items[0].accounts.find((a) => a.account_id === "acc2");
  assert.ok(old.closed_at, "marked closed");
  const nw2 = (await fetch(base + "/api/summary").then((r) => r.json())).netWorth.cash;
  assert.equal(nw1 - nw2, 2000);
});

test("POST from another origin is refused", async () => {
  const r = await fetch(base + "/api/sync", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403);
});

// Last in the file: it runs one more sync, which the earlier tests' fake replies don't expect.
test("settings save and check their values, and sync on open runs only when it's due", async () => {
  const get = () => fetch(base + "/api/settings").then((r) => r.json());
  const s0 = await get();
  assert.equal(s0.autoSync, "12");
  assert.equal(s0.bigCharge, "200");
  assert.equal(s0.alerts, "off", "Discord alerts are opt-in");
  assert.equal(s0.webhook, null);
  const { readFileSync } = await import("node:fs"), { execFileSync } = await import("node:child_process");
  assert.equal(s0.version, JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
  assert.equal(s0.build.commit, execFileSync("git", ["log", "-1", "--format=%h"], { cwd: root, encoding: "utf8" }).trim(), "the commit tally started from");
  assert.equal((await post("/api/settings", { bigCharge: "350" })).bigCharge, "350");
  assert.match((await post("/api/settings", { bigCharge: "-5" })).error, /bigCharge/);
  assert.equal(s0.priceAlerts, "on", "price alerts default on");
  assert.equal((await post("/api/settings", { priceAlerts: "off" })).priceAlerts, "off");
  assert.match((await post("/api/settings", { priceAlerts: "maybe" })).error, /priceAlerts/);
  assert.match((await post("/api/settings", { autoSync: "3" })).error, /autoSync/);
  assert.match((await post("/api/settings", { nope: "1" })).error, /nope/);

  assert.equal((await post("/api/sync-if-due", {})).synced, false, "just synced, so not due");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "data", "tally.db"));
  db.prepare("UPDATE items SET last_sync = ?").run(new Date(Date.now() - 13 * 3600_000).toISOString());
  await post("/api/settings", { autoSync: "off" });
  assert.equal((await post("/api/sync-if-due", {})).synced, false, "off never syncs on open");
  await post("/api/settings", { autoSync: "12" });
  const n = calls.filter((c) => c.path === "/transactions/sync").length;
  const r = await post("/api/sync-if-due", {});
  assert.equal(r.synced, true, "13 hours old is past 12");
  assert.ok(calls.filter((c) => c.path === "/transactions/sync").length > n);
  db.prepare("UPDATE items SET last_sync = ?").run(new Date(Date.now() - 13 * 3600_000).toISOString());
  assert.equal((await post("/api/sync-if-due", {})).synced, false, "at most one automatic sync every 10 minutes");
  db.close();

  const hook = "https://discord.com/api/webhooks/123/abc-DEF_9";
  assert.match((await post("/api/settings", { discordWebhook: "https://example.com/hook" })).error, /discordWebhook/);
  const saved = await post("/api/settings", { discordWebhook: hook });
  assert.equal(saved.webhook, "settings");
  assert.ok(!JSON.stringify(await get()).includes("webhooks/123"), "the page never gets the webhook back");
  let daily = await post("/api/daily", {});
  assert.deepEqual([daily.alerts, daily.webhook], [[], null], "alerts off: nothing to post");
  await post("/api/settings", { alerts: "on" });
  daily = await post("/api/daily", {});
  assert.equal(daily.webhook, hook);
  assert.ok(Array.isArray(daily.alerts));
});

test("sandbox keys keep their data in sandbox.db, apart from tally.db, read from a UTF-16 keys file", async () => {
  const sdir = mkdtempSync(join(tmpdir(), "tally-sandbox-"));
  // Written the way Windows PowerShell's Out-File writes it: UTF-16 with a byte-order mark and CRLF line ends.
  const keys = `PLAID_CLIENT_ID=cid\r\nPLAID_SECRET=sec\r\nPLAID_ENV=sandbox\r\nPLAID_HOST=http://127.0.0.1:${fake.address().port}\r\n`;
  writeFileSync(join(sdir, "plaid.env"), Buffer.from("\uFEFF" + keys, "utf16le"));
  const port = 35000 + Math.floor(Math.random() * 1000), sbase = `http://localhost:${port}`;
  const s = spawn(process.execPath, [join(root, "server.mjs")], { env: { ...process.env, TALLY_PORT: String(port), TALLY_KEYS: join(sdir, "plaid.env"), TALLY_DATA: join(sdir, "data"), TALLY_DISCORD: join(sdir, "discord.env"), TALLY_PAYOUTS: join(sdir, "payouts.mjs") }, stdio: "pipe" });
  try {
    let set;
    for (let i = 0; i < 50 && !set; i++) set = await fetch(sbase + "/api/settings").then((r) => r.json(), () => null) ?? await new Promise((r) => setTimeout(r, 100));
    assert.equal(set.plaidEnv, "sandbox");
    assert.match(set.dataPath, /sandbox\.db$/);
    assert.ok(existsSync(join(sdir, "data", "sandbox.db")));
    assert.ok(!existsSync(join(sdir, "data", "tally.db")), "sandbox never creates the real data file");
  } finally { await stop(s); rmSync(sdir, { recursive: true, force: true }); }
});
