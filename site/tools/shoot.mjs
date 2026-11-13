// Screenshots for the site: crops of tally's real UI, light and dark, at 2x. Never point this at real accounts.
// Usage: node site/tools/shoot.mjs <app base url> site/img [devtools port]
// Run tally on made-up data first. The shots assume that data has one category over budget (the site shows
// Groceries $25 over) and every other spending category budgeted, so Home's two totals match. For c-conn, one
// connection needs a new sign-in: set items.last_error = 'ITEM_LOGIN_REQUIRED' on one item before shooting
// c-conn, and clear it after.
// What to shoot is in shots.json next to this file: [name, hash, width, height, how]. how is one of
// {card: "<h2 text>"} or {sel: "<selector>"} for one card, {until: "<selector>", below: px} for the top of a page
// down to an element, or {clip: [x, y, w, h]}; js runs in the page first (to trim rows, say), and union grows a card crop
// to take in a popup the js opened.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const [BASE, out, portArg] = process.argv.slice(2);
const PORT = Number(portArg || 9363);
mkdirSync(out, { recursive: true });
const CROPS = process.env.CROPS ? JSON.parse(process.env.CROPS) : JSON.parse(readFileSync(new URL("./shots.json", import.meta.url), "utf8"));

const profile = mkdtempSync(join(tmpdir(), "council-crops-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
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
const evalJs = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await cdp("Page.enable");
try {
  for (const theme of ["light", "dark"]) {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    for (const [name, hash, width, height, how] of CROPS) {
      const mobile = width < 600;
      await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile });
      await cdp("Page.navigate", { url: BASE + "?c=" + name + hash });
      await wait(1800);
      if (how.card !== undefined || how.sel) await evalJs(`(() => { const st = document.createElement("style"); st.textContent = ".band{background:transparent!important}.tabbar{display:none!important}"; document.head.append(st); return 1; })()`);
      if (how.js) { await evalJs(how.js); await wait(300); }
      let clip;
      if (how.until) {
        // From the top of the page to a little below the element named by how.until (say, the first row of cards).
        const bottom = await evalJs(`Math.ceil(document.querySelector(${JSON.stringify(how.until)}).getBoundingClientRect().bottom + scrollY)`);
        clip = { x: 0, y: 0, width, height: bottom + (how.below ?? 24), scale: 1 };
      } else if (how.clip) { const [x, y, w, h] = how.clip; clip = { x, y, width: w, height: h, scale: 1 }; }
      else {
        const r = await evalJs(`(() => { const h = ${JSON.stringify(how.sel || "")} ? document.querySelector(${JSON.stringify(how.sel || "")}) : [...document.querySelectorAll(".card h2")].find((e) => e.textContent.trim().startsWith(${JSON.stringify(how.card || "")}));
          if (!h) return null; const b = h.closest(".card").getBoundingClientRect(); return [b.x, b.y + scrollY, b.width, b.height]; })()`);
        if (!r) { console.log("no card", how.card, "on", hash); continue; }
        const pad = how.pad ?? 16;
        clip = { x: r[0] - pad, y: r[1] - pad, width: r[2] + 2 * pad, height: Math.min(r[3], how.maxH ?? 1e4) + 2 * pad, scale: 1 };
        if (how.union) {
          // Grow the crop to take in a popup the js opened (the category picker, say), plus a margin.
          const u = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(how.union)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y + scrollY, b.right, b.bottom + scrollY]; })()`);
          if (u) { const bottom = Math.max(clip.y + clip.height, u[3] + 16); clip.height = bottom - clip.y; }
        }
      }
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip });
      const file = name + (theme === "dark" ? "-dark" : "") + ".png";
      writeFileSync(join(out, file), Buffer.from(shot.data, "base64"));
      console.log(file, Math.round(clip.width) + "x" + Math.round(clip.height));
    }
  }
} finally {
  ws.close(); chrome.kill(); await wait(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
