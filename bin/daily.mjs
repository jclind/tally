#!/usr/bin/env node
// The 7:00 job: sync every bank, write the backup snapshot, and post new alerts to Discord when they're turned on.
// A quiet day posts nothing. Alerts are marked sent only after Discord accepts the post, so a failed post retries tomorrow.
// tally sends the webhook with the alerts (Settings, or the old discord.env). If tally itself is down, the file is the
// only place left to find one.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PORT = Number(process.env.TALLY_PORT || 3400);
const BASE = `http://localhost:${PORT}`;
const ENV = process.env.TALLY_DISCORD || join(homedir(), ".config/tally/discord.env");
const PAGE = process.env.TALLY_PAGE_URL || "";
const log = (...a) => console.log(new Date().toISOString(), "daily", ...a);

function webhook() {
  if (!existsSync(ENV)) return null;
  const m = readFileSync(ENV, "utf8").match(/^DISCORD_WEBHOOK_URL=(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

// The daily sync walks every bank one after another, so it gets 15 minutes; Discord gets 30 seconds a post.
async function post(path, body, ms = 15 * 60_000) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

let result;
try {
  result = await post("/api/daily");
} catch (e) {
  // tally itself is down or Plaid is unreachable. Alert on that too.
  result = { alerts: [{ key: `down:${new Date().toLocaleDateString("en-CA")}`, text: `tally's daily sync didn't run: ${e.message}` }], errors: [], down: true };
}
log(`${result.alerts.length} new alerts, ${result.errors.length} sync errors`);
if (!result.alerts.length) process.exit(0);

const hook = result.webhook ?? webhook();
// Discord takes 2,000 characters a message. Alerts go out in as many messages as they need, and each message's
// alerts are marked sent only after Discord accepts that message, so nothing is marked sent that wasn't posted.
const LIMIT = 1900;
const chunks = [];
for (const a of result.alerts) {
  const line = `- ${a.text}`.slice(0, LIMIT - 100);
  const last = chunks.at(-1);
  if (last && last.text.length + line.length + 1 <= LIMIT - 100) { last.text += "\n" + line; last.keys.push(a.key); }
  else chunks.push({ text: line, keys: [a.key] });
}
if (PAGE) chunks.at(-1).text += `\n<${PAGE}>`;
if (!hook) { log("no webhook, alerts not posted:\n" + chunks.map((c) => c.text).join("\n")); process.exit(0); }
for (const c of chunks) {
  const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ username: "tally", content: c.text, allowed_mentions: { parse: [] } }) }).catch((e) => ({ ok: false, status: e.name }));
  if (!r.ok) { log(`discord post failed: ${r.status}`); process.exit(1); }
  if (!result.down) await post("/api/alerts-sent", { keys: c.keys }, 30_000);
}
log(`posted to discord in ${chunks.length} message${chunks.length === 1 ? "" : "s"}`);
