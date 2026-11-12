// Runs server.mjs against a fake Plaid server. No real keys or accounts are involved.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "tally-test-"));
const calls = [];
let fake, app, base;

const acct = { account_id: "acc1", name: "Checking", mask: "1234", type: "depository", subtype: "checking", balances: { current: 100, available: 90, iso_currency_code: "USD" } };
const tx = (id, amount, date = "2026-11-01") => ({ transaction_id: id, account_id: "acc1", date, name: `Store ${id}`, merchant_name: null, amount, pending: false, iso_currency_code: "USD", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } });

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
};

before(async () => {
  fake = http.createServer((req, res) => {
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
  app = spawn(process.execPath, [join(root, "server.mjs")], { env: { ...process.env, TALLY_PORT: String(port), TALLY_KEYS: join(dir, "plaid.env"), TALLY_DATA: join(dir, "data") }, stdio: "pipe" });
  for (let i = 0; i < 50; i++) {
    if (await fetch(base + "/api/status").then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});

after(() => { app?.kill(); fake?.close(); rmSync(dir, { recursive: true, force: true }); });

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

test("POST from another origin is refused", async () => {
  const r = await fetch(base + "/api/sync", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(r.status, 403);
});
