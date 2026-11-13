// Screenshots for the site, from tally running on made-up data. Never point this at real accounts.
// Usage: node site/tools/shoot.mjs <base url> <out dir>. Desktop is 1280x800, phone 390x844, both at 2x.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [BASE, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SHOTS = [
  ["home", "#/", "desk"], ["spending", "#/spending", "desk"], ["budgets", "#/budgets", "desk"],
  ["activity", "#/transactions", "desk"], ["bills", "#/bills", "desk"], ["accounts", "#/accounts", "desk"],
  ["phone-home", "#/", "phone", 0], ["phone-budgets", "#/budgets", "phone", 0], ["phone-activity", "#/transactions", "phone", 0], ["phone-spending", "#/spending", "phone", 0], ["phone-accounts", "#/accounts", "phone", 0],
];
const PORT = 9334;
const profile = mkdtempSync(join(tmpdir(), "council-chrome-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const pg = list.find((t) => t.type === "page");
    if (pg) ws = new WebSocket(pg.webSocketDebuggerUrl);
  } catch { await wait(200); }
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; pending.set(i, (m) => m.error ? bad(new Error(method + ": " + m.error.message)) : ok(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });

await cdp("Page.enable");
for (const [name, hash, kind, y0 = 0] of SHOTS) {
  const phone = kind === "phone";
  const width = phone ? 390 : 1280, scale = 2;
  await cdp("Emulation.setDeviceMetricsOverride", { width, height: phone ? 844 : 800, deviceScaleFactor: scale, mobile: phone });
  await cdp("Page.navigate", { url: BASE + "?" + name + hash });
  await wait(1800);
  await cdp("Runtime.evaluate", { expression: `window.scrollTo(0, ${y0})` });
  await wait(300);
  const height = phone ? 844 : 800;
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, name + ".png"), Buffer.from(shot.data, "base64"));
  console.log(name, `${width}x${height}@${scale}x`);
}
ws.close(); chrome.kill();
