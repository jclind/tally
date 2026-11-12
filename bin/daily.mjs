#!/usr/bin/env node
// The 7:00 job: sync every bank, write the backup snapshot, and post new alerts to Discord.
// A quiet day posts nothing. Alerts are marked sent only after Discord accepts the post, so a failed post retries tomorrow.
// The webhook is DISCORD_WEBHOOK_URL in ~/.config/tally/discord.env. Without it, alerts go to the log only.
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

async function post(path, body) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body ?? {}) });
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

const hook = webhook();
const content = [...result.alerts.map((a) => `- ${a.text}`), PAGE ? `<${PAGE}>` : ""].filter(Boolean).join("\n").slice(0, 1900);
if (!hook) { log("no webhook, alerts not posted:\n" + content); process.exit(0); }
const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "tally", content, allowed_mentions: { parse: [] } }) });
if (!r.ok) { log(`discord post failed: HTTP ${r.status}`); process.exit(1); }
if (!result.down) await post("/api/alerts-sent", { keys: result.alerts.map((a) => a.key) });
log("posted to discord");
