// bin/daily.mjs against a fake tally and a fake Discord. Nothing real is posted.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listen = (handler) => new Promise((ok) => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => ok(s)); });
const body = (req) => new Promise((ok) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => ok(s ? JSON.parse(s) : {})); });

test("many alerts go out in several Discord messages, and only posted ones are marked sent", async () => {
  const alerts = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, text: `Alert number ${i}: ${"x".repeat(60)}` }));
  const marked = [], posts = [];
  let failAfter = Infinity;
  const tally = await listen(async (req, res) => {
    const b = await body(req);
    if (req.url === "/api/daily") return res.end(JSON.stringify({ alerts, errors: [] }));
    if (req.url === "/api/alerts-sent") { marked.push(...b.keys); return res.end("{}"); }
    res.writeHead(404).end();
  });
  const discord = await listen(async (req, res) => {
    const b = await body(req);
    if (posts.length >= failAfter) { res.writeHead(500).end(); return; }
    posts.push(b.content); res.writeHead(204).end();
  });
  const dir = mkdtempSync(join(tmpdir(), "tally-daily-"));
  writeFileSync(join(dir, "discord.env"), `DISCORD_WEBHOOK_URL=http://127.0.0.1:${discord.address().port}/hook\n`);
  const run = () => new Promise((ok) => {
    const p = spawn(process.execPath, [join(root, "bin/daily.mjs")], { env: { ...process.env, TALLY_PORT: String(tally.address().port), TALLY_DISCORD: join(dir, "discord.env"), TALLY_PAGE_URL: "" }, stdio: "ignore" });
    p.on("exit", ok);
  });
  try {
    assert.equal(await run(), 0);
    assert.ok(posts.length > 1, "split into several messages");
    assert.ok(posts.every((p) => p.length <= 2000));
    assert.equal(posts.join("\n").split("\n").length, 40, "every alert posted, none cut off");
    assert.deepEqual(marked, alerts.map((a) => a.key));

    posts.length = 0; marked.length = 0; failAfter = 1;
    assert.equal(await run(), 1, "a failed post fails the job");
    assert.equal(posts.length, 1);
    assert.equal(marked.length, posts[0].split("\n").length, "only the posted message's alerts are marked sent");
  } finally {
    tally.close(); discord.close(); rmSync(dir, { recursive: true, force: true });
  }
});
