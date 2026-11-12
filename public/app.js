// tally's pages. Hash routes: #/, #/transactions, #/spending, #/budgets, #/recurring, #/accounts.
const $page = document.getElementById("page");
const $tip = document.getElementById("tip");
let META = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n, cents = false) => (cents ? usd2 : usd0).format(n ?? 0);
// Plaid: positive is money out. Money in shows with a plus, in green.
const amt = (n) => n < 0 ? `<span class="num in">+${money(-n, true)}</span>` : `<span class="num">${money(n, true)}</span>`;
const label = (c) => META?.labels[c] ?? c;
const monthName = (m, style = "long") => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString("en-US", { month: style, ...(style === "long" ? {} : {}) });
const monthYear = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
const shortDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const shiftMonth = (m, by) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.code ? `${j.code}: ${j.error}` : j.error || `HTTP ${r.status}`);
  return j;
}

function route() {
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  return { page: path.replace(/^\//, "") || "overview", q: new URLSearchParams(qs ?? "") };
}
const go = (page, params) => { location.hash = `#/${page === "overview" ? "" : page}${params && [...params].length ? "?" + params : ""}`; };

async function render() {
  const { page, q } = route();
  for (const a of document.querySelectorAll(".nav a")) a.classList.toggle("on", a.dataset.page === page);
  closePicker();
  try {
    META ??= await api("/api/meta");
    await (PAGES[page] ?? PAGES.overview)(q);
  } catch (e) {
    $page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`;
  }
  api("/api/status").then((s) => { document.getElementById("navdot").hidden = !s.items.some((i) => i.last_error); }).catch(() => {});
}

// ---------- chart: one series of monthly bars, hover for the value ----------
function barChart(history, { onPick, current } = {}) {
  const W = 640, H = 200, pad = { l: 44, r: 4, t: 8, b: 24 };
  const max = Math.max(1, ...history.map((h) => h.spent));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, bw = iw / history.length;
  const y = (v) => pad.t + ih - (v / top) * ih;
  let g = "";
  for (let v = 0; v <= top + 0.001; v += step) g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? `$${v / 1000}k` : `$${v}`}</text>`;
  history.forEach((h, i) => {
    const x = pad.l + i * bw, w = Math.min(28, bw * 0.6), bx = x + (bw - w) / 2;
    const v = Math.max(0, h.spent), top0 = y(v), hgt = Math.max(0, pad.t + ih - top0);
    const tip = !h.hasData ? `${monthYear(h.month)}: no data` : `${monthYear(h.month)}: ${money(h.spent)}${h.month === current ? " so far" : ""}`;
    g += `<g data-m="${h.month}" data-tip="${esc(tip)}">`
      + `<rect class="hit" x="${x}" y="${pad.t}" width="${bw}" height="${ih}"/>`
      + (h.hasData && hgt > 0 ? `<path class="b-path" fill="var(--accent)" ${h.month === current ? 'opacity=".55"' : ""} d="${roundTop(bx, top0, w, hgt, Math.min(4, hgt))}"/>` : "")
      + `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${monthName(h.month, "narrow")}</text></g>`;
  });
  const el = document.createElement("div");
  el.className = "chart";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by month">${g}</svg>`;
  for (const node of el.querySelectorAll("g[data-m]")) {
    node.addEventListener("mousemove", (e) => showTip(e, node.dataset.tip));
    node.addEventListener("mouseleave", hideTip);
    if (onPick) { node.style.cursor = "pointer"; node.addEventListener("click", () => onPick(node.dataset.m)); }
  }
  // A table view for screen readers.
  el.insertAdjacentHTML("beforeend", `<table class="sr" style="position:absolute;left:-9999px">${history.map((h) => `<tr><td>${monthYear(h.month)}</td><td>${h.hasData ? money(h.spent) : "no data"}</td></tr>`).join("")}</table>`);
  return el;
}
function roundTop(x, y, w, h, r) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}
function showTip(e, text) {
  $tip.textContent = text; $tip.hidden = false;
  const r = $tip.getBoundingClientRect();
  $tip.style.left = `${Math.min(window.innerWidth - r.width - 8, e.clientX + 12)}px`;
  $tip.style.top = `${e.clientY - r.height - 10}px`;
}
const hideTip = () => { $tip.hidden = true; };

const barRow = (labelHtml, value, max, valueHtml, { href, over } = {}) => {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tag = href ? "a" : "div";
  return `<${tag} class="brow"${href ? ` href="${href}"` : ""}><span class="lab">${labelHtml}</span><span class="bar${over ? " is-over" : ""}"><i style="width:${pct}%"></i></span><span class="val num">${valueHtml}</span></${tag}>`;
};

// ---------- overview ----------
const PAGES = {};
PAGES.overview = async () => {
  const s = await api("/api/summary");
  const m = monthName(s.month), pm = monthName(shiftMonth(s.month, -1));
  const diff = s.spent - s.spentLastMonthSoFar;
  const pace = Math.abs(diff) < 1 ? `Same as this point in ${pm}`
    : `<span class="${diff > 0 ? "over" : "good"} num">${money(Math.abs(diff))}</span> ${diff > 0 ? "more" : "less"} than this point in ${pm}`;
  const nw = s.netWorth;
  $page.innerHTML = `
    <h1>Overview</h1>
    <div class="grid">
      <section class="tile s3">
        <h2>Net worth <a href="#/accounts">Accounts</a></h2>
        <div class="big num">${money(nw.total)}</div>
        <div class="split">
          <div><div class="k">Cash</div><div class="num">${money(nw.cash)}</div></div>
          <div><div class="k">Investments</div><div class="num">${money(nw.investments)}</div></div>
          <div><div class="k">Cards owed</div><div class="num">${money(nw.owed)}</div></div>
        </div>
      </section>
      <section class="tile s3">
        <h2>Spent in ${m} <a href="#/spending">Spending</a></h2>
        <div class="big num">${money(s.spent)}</div>
        <div class="split">
          <div><div class="k">Pace</div><div>${pace}</div></div>
          <div><div class="k">Income</div><div class="num">${money(s.income)}</div></div>
        </div>
      </section>
      <section class="tile s4" id="chart"><h2>Spending by month</h2></section>
      <section class="tile s2">
        <h2>Coming up <a href="#/recurring">Recurring</a></h2>
        ${s.upcoming.length ? `<div class="list">${s.upcoming.map((r) => `<div class="li"><span class="who">${esc(r.who)}</span><span class="amt num">${money(Math.abs(r.average_amount), true)}</span><span class="meta">${shortDate(r.predicted_next_date)}</span></div>`).join("")}</div>`
          : `<div class="empty">No bills due in the next 2 weeks.</div>`}
      </section>
      <section class="tile s3">
        <h2>Budgets <a href="#/budgets">${s.budgets.length ? "Edit" : "Set budgets"}</a></h2>
        ${s.budgets.length ? s.budgets.map((b) => barRow(esc(b.label), b.spent, b.budget,
            b.spent > b.budget ? `<span class="over">${money(b.spent - b.budget)} over</span>` : `${money(b.budget - b.spent)} left`,
            { href: `#/transactions?cat=${b.category}&month=${s.month}`, over: b.spent > b.budget })).join("")
          : `<div class="empty">No budgets yet.</div>`}
      </section>
      <section class="tile s3">
        <h2>Recent <a href="#/transactions">All transactions</a></h2>
        <div class="list">${s.recent.map((t) => `<div class="li"><span class="who">${esc(t.who)}${t.pending ? '<span class="tag">pending</span>' : ""}</span><span class="amt">${amt(t.amount)}</span><span class="meta">${shortDate(t.date)} · ${esc(label(t.cat))}</span></div>`).join("")}</div>
      </section>
    </div>`;
  document.getElementById("chart").append(barChart(s.history, { current: s.month, onPick: (mm) => go("spending", new URLSearchParams({ month: mm })) }));
};

// ---------- transactions ----------
PAGES.transactions = async (q) => {
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(thisMonth(), -i));
  const cats = Object.keys(META.labels).sort((a, b) => label(a).localeCompare(label(b)));
  $page.innerHTML = `
    <h1>Transactions <span class="sub" id="count"></span></h1>
    <div class="filters">
      <input type="search" id="fq" placeholder="Search" value="${esc(q.get("q") ?? "")}">
      <select id="fmonth"><option value="">All months</option>${months.map((m) => `<option value="${m}">${monthYear(m)}</option>`).join("")}</select>
      <select id="fcat"><option value="">All categories</option>${cats.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join("")}</select>
      <select id="facct"><option value="">All accounts</option>${META.accounts.filter((a) => a.type !== "investment").map((a) => `<option value="${a.account_id}">${esc(a.name)}${a.mask ? ` ${esc(a.mask)}` : ""}</option>`).join("")}</select>
    </div>
    <div class="tile wrap"><table><thead><tr><th class="t-date-col">Date</th><th>Name</th><th>Category</th><th class="t-acct">Account</th><th class="amt">Amount</th></tr></thead><tbody id="rows"></tbody></table>
      <div class="more" id="more"></div></div>`;
  for (const [id, key] of [["fmonth", "month"], ["fcat", "cat"], ["facct", "account"]]) document.getElementById(id).value = q.get(key) ?? "";
  let offset = 0;
  const params = () => {
    const p = new URLSearchParams();
    for (const [id, key] of [["fq", "q"], ["fmonth", "month"], ["fcat", "cat"], ["facct", "account"]]) { const v = document.getElementById(id).value.trim(); if (v) p.set(key, v); }
    return p;
  };
  async function load(append) {
    const p = params(); p.set("limit", "100"); p.set("offset", String(offset));
    const r = await api(`/api/transactions?${p}`);
    const html = r.rows.map((t) => `<tr class="${t.pending ? "pending" : ""}">
      <td class="t-date-col num muted">${shortDate(t.date)}</td>
      <td><div>${esc(t.who)}${t.pending ? '<span class="tag">pending</span>' : ""}</div></td>
      <td><button class="catbtn${t.overridden ? " set" : ""}" data-id="${esc(t.transaction_id)}" data-cat="${esc(t.cat)}" data-who="${esc(t.who)}" data-ov="${t.overridden ? 1 : 0}">${esc(label(t.cat))}</button></td>
      <td class="t-acct muted">${esc(t.account_name ?? "")}</td>
      <td class="amt">${amt(t.amount)}</td></tr>`).join("");
    const rows = document.getElementById("rows");
    if (append) rows.insertAdjacentHTML("beforeend", html); else rows.innerHTML = html || `<tr><td colspan="5" class="empty">No transactions match.</td></tr>`;
    offset += r.rows.length;
    document.getElementById("count").textContent = `${r.total.toLocaleString()} · net ${r.sum >= 0 ? money(r.sum, true) + " out" : money(-r.sum, true) + " in"}`;
    document.getElementById("more").innerHTML = offset < r.total ? `<button class="btn" id="loadmore">Show more</button>` : "";
    document.getElementById("loadmore")?.addEventListener("click", () => load(true));
  }
  const refilter = () => { offset = 0; history.replaceState(null, "", `#/transactions${[...params()].length ? "?" + params() : ""}`); load(false); };
  let t;
  document.getElementById("fq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(refilter, 250); });
  for (const id of ["fmonth", "fcat", "facct"]) document.getElementById(id).addEventListener("change", refilter);
  document.getElementById("rows").addEventListener("click", (e) => {
    const b = e.target.closest(".catbtn");
    if (b) openPicker(b, async () => { offset = 0; await load(false); });
  });
  await load(false);
};

// ---------- category picker ----------
let picker = null;
function closePicker() { picker?.remove(); picker = null; document.removeEventListener("mousedown", outside); }
function outside(e) { if (picker && !picker.contains(e.target)) closePicker(); }
function openPicker(btn, done) {
  closePicker();
  const cats = Object.keys(META.labels).sort((a, b) => label(a).localeCompare(label(b)));
  picker = document.createElement("div");
  picker.className = "picker";
  picker.innerHTML = `<div class="opts">${cats.map((c) => `<button class="opt${c === btn.dataset.cat ? " on" : ""}" data-c="${c}">${esc(label(c))}</button>`).join("")}
      ${btn.dataset.ov === "1" ? `<button class="opt muted" data-c="">Back to automatic</button>` : ""}</div>
    <label><input type="checkbox" id="pall"> Every ${esc(btn.dataset.who)} transaction</label>`;
  document.body.append(picker);
  const r = btn.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(window.innerWidth - 248, r.left + scrollX))}px`;
  picker.style.top = `${r.bottom + scrollY + 6}px`;
  picker.addEventListener("click", async (e) => {
    const o = e.target.closest(".opt");
    if (!o) return;
    try {
      await api("/api/category", { transaction_id: btn.dataset.id, category: o.dataset.c || null, merchant: picker.querySelector("#pall").checked });
      closePicker(); await done();
    } catch (err) { alertInline(err.message); }
  });
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
}
function alertInline(msg) { $page.insertAdjacentHTML("afterbegin", `<div class="notice bad">${esc(msg)}</div>`); }

// ---------- spending ----------
PAGES.spending = async (q) => {
  const month = q.get("month") || thisMonth();
  const r = await api(`/api/spending?month=${month}`);
  const total = r.categories.reduce((s, c) => s + c.spent, 0);
  const max = r.categories[0]?.spent ?? 0;
  const next = shiftMonth(month, 1), canNext = next <= thisMonth();
  $page.innerHTML = `
    <h1>Spending
      <span class="sub"><button class="link" id="prev" aria-label="Previous month">‹</button>
      ${monthYear(month)}
      ${canNext ? `<button class="link" id="next" aria-label="Next month">›</button>` : ""}</span></h1>
    <div class="grid">
      <section class="tile s3">
        <h2>Total</h2>
        <div class="big num">${money(total)}</div>
        <div class="split"><div><div class="k">Categories</div><div class="num">${r.categories.length}</div></div>
          <div><div class="k">Transactions</div><div class="num">${r.categories.reduce((s, c) => s + c.n, 0)}</div></div></div>
      </section>
      <section class="tile s3" id="chart"><h2>By month</h2></section>
      <section class="tile s6">
        <h2>By category</h2>
        ${r.categories.length ? r.categories.map((c) => barRow(esc(label(c.cat)), c.spent, max,
          `${money(c.spent)} <span class="muted">${Math.round((c.spent / total) * 100)}%</span>`,
          { href: `#/transactions?cat=${c.cat}&month=${month}` })).join("") : `<div class="empty">No spending in ${monthName(month)}.</div>`}
      </section>
    </div>`;
  document.getElementById("chart").append(barChart(r.history, { current: thisMonth(), onPick: (mm) => go("spending", new URLSearchParams({ month: mm })) }));
  document.getElementById("prev").onclick = () => go("spending", new URLSearchParams({ month: shiftMonth(month, -1) }));
  document.getElementById("next")?.addEventListener("click", () => go("spending", new URLSearchParams({ month: next })));
};

// ---------- budgets ----------
PAGES.budgets = async () => {
  const r = await api("/api/budgets");
  const set = r.budgets.filter((b) => b.budget != null);
  const totalB = set.reduce((s, b) => s + b.budget, 0), totalS = set.reduce((s, b) => s + b.spent, 0);
  const blanks = r.budgets.filter((b) => b.budget == null && b.suggested);
  $page.innerHTML = `
    <h1>Budgets <span class="sub">${monthYear(r.month)}</span></h1>
    <div class="grid">
      <section class="tile s6">
        ${set.length ? `<div class="split" style="margin:0 0 18px"><div><div class="k">Budgeted</div><div class="mid num">${money(totalB)}</div></div>
          <div><div class="k">Spent</div><div class="mid num">${money(totalS)}</div></div>
          <div><div class="k">${totalS > totalB ? "Over" : "Left"}</div><div class="mid num ${totalS > totalB ? "over" : ""}">${money(Math.abs(totalB - totalS))}</div></div></div>` : ""}
        ${blanks.length ? `<div class="actions" style="margin-bottom:10px"><button class="btn" id="fill">Fill in ${blanks.length} from the last 3 months</button></div>` : ""}
        <div id="blist">${r.budgets.map((b) => {
          const over = b.budget != null && b.spent > b.budget;
          return `<div class="budget">
            <div><div>${esc(b.label)}</div>${b.budget != null ? `<div class="left ${over ? "over" : "muted"} num">${over ? `${money(b.spent - b.budget)} over` : `${money(b.budget - b.spent)} left`}</div>` : `<div class="left muted num">${money(b.spent)} spent</div>`}</div>
            <div class="barcell">${b.budget != null ? `<div class="bar${over ? " is-over" : ""}"><i style="width:${Math.min(100, b.budget > 0 ? (b.spent / b.budget) * 100 : 100)}%"></i></div>` : ""}</div>
            <div class="ctl"><span class="muted num" style="font-size:13px">${b.budget != null ? `${money(b.spent)} of` : b.suggested ? `avg ${money(b.suggested)}` : ""}</span>
              <input class="num" inputmode="decimal" data-cat="${b.category}" value="${b.budget ?? ""}" placeholder="—" aria-label="${esc(b.label)} budget"></div>
          </div>`;
        }).join("") || `<div class="empty">No spending yet to budget from.</div>`}</div>
      </section>
    </div>`;
  for (const inp of document.querySelectorAll("#blist input")) {
    const save = async () => {
      const v = inp.value.replace(/[$,\s]/g, "");
      if (v === String(inp.defaultValue)) return;
      try { await api("/api/budget", { category: inp.dataset.cat, monthly: v === "" ? null : Number(v) }); await PAGES.budgets(); }
      catch (e) { alertInline(e.message); }
    };
    inp.addEventListener("change", save);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  }
  document.getElementById("fill")?.addEventListener("click", async () => {
    for (const b of blanks) await api("/api/budget", { category: b.category, monthly: b.suggested });
    await PAGES.budgets();
  });
};

// ---------- recurring ----------
const FREQ = { WEEKLY: "Weekly", BIWEEKLY: "Every 2 weeks", SEMI_MONTHLY: "Twice a month", MONTHLY: "Monthly", ANNUALLY: "Yearly", UNKNOWN: "Irregular" };
PAGES.recurring = async () => {
  const all = await api("/api/recurring");
  const isTransfer = (r) => r.is_transfer;
  const bills = all.filter((r) => r.direction === "outflow" && r.is_active && !isTransfer(r));
  const income = all.filter((r) => r.direction === "inflow" && r.is_active && !isTransfer(r));
  const ended = all.filter((r) => r.direction === "outflow" && !r.is_active && !isTransfer(r));
  const perMonth = bills.reduce((s, r) => s + r.monthly, 0);
  const row = (r) => `<div class="li"><span class="who">${esc(r.who)}</span><span class="amt num">${money(Math.abs(r.average_amount), true)}</span>
    <span class="meta">${FREQ[r.frequency] ?? esc(r.frequency)}${r.is_active && r.predicted_next_date ? ` · next ${shortDate(r.predicted_next_date)}` : r.last_date ? ` · last ${shortDate(r.last_date)}` : ""}${r.account_name ? ` · ${esc(r.account_name)}` : ""}</span></div>`;
  $page.innerHTML = `
    <h1>Recurring</h1>
    <div class="grid">
      <section class="tile s4">
        <h2>Bills and subscriptions <span class="muted num">${money(perMonth)}/mo</span></h2>
        ${bills.length ? `<div class="list">${bills.map(row).join("")}</div>` : `<div class="empty">Plaid hasn't found any repeating charges yet.</div>`}
      </section>
      <section class="tile s2">
        <h2>Income</h2>
        ${income.length ? `<div class="list">${income.map(row).join("")}</div>` : `<div class="empty">None found.</div>`}
      </section>
      ${ended.length ? `<section class="tile s6"><h2>Stopped charging</h2><div class="list">${ended.map(row).join("")}</div></section>` : ""}
    </div>`;
};

// ---------- accounts and connections ----------
const GROUPS = [["depository", "Cash"], ["credit", "Credit cards"], ["investment", "Investments"], ["loan", "Loans"]];
PAGES.accounts = async () => {
  const s = await api("/api/status");
  const accounts = s.items.flatMap((it) => it.accounts.map((a) => ({ ...a, inst: it.institution_name })));
  $page.innerHTML = `
    <h1>Accounts <span class="sub">${s.used} of ${s.cap} Plaid connections used</span></h1>
    <div id="msg"></div>
    ${!s.keys ? `<div class="notice bad">No Plaid keys. Put PLAID_CLIENT_ID and PLAID_SECRET in ${esc(s.keysPath)}.</div>` : ""}
    <div class="grid">
      ${GROUPS.filter(([t]) => accounts.some((a) => a.type === t)).map(([t, name]) => {
        const list = accounts.filter((a) => a.type === t);
        const total = list.reduce((x, a) => x + (a.current ?? 0), 0);
        return `<section class="tile s3"><h2>${name} <span class="num ink2">${money(total)}</span></h2><div class="list">
          ${list.map((a) => `<div class="li"><span class="who">${esc(a.name)}</span><span class="amt num">${money(a.current, true)}</span><span class="meta">${esc(a.inst)}${a.mask ? ` ··${esc(a.mask)}` : ""}${t === "credit" && a.credit_limit ? ` · ${money(a.credit_limit)} limit` : ""}</span></div>`).join("")}
        </div></section>`;
      }).join("")}
      <section class="tile s6">
        <h2>Connections</h2>
        <div class="list">${s.items.map((it) => {
          const broken = /ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|PENDING_DISCONNECT/.test(it.last_error ?? "");
          return `<div class="li" style="display:block">
            <div class="conn"><strong>${esc(it.institution_name)}</strong>
              <span class="state ${it.last_error ? "bad" : ""}">${it.last_error ? (broken ? "Needs you to sign in again" : "Sync failed") : `Synced ${esc(it.last_sync ? new Date(it.last_sync).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never")}`}</span></div>
            ${it.last_error ? `<div class="err">${esc(it.last_error)}</div>` : ""}
            <div class="actions"><button class="btn" data-sync="${esc(it.item_id)}">Sync now</button>${broken ? `<button class="btn primary" data-fix="${esc(it.item_id)}">Fix connection</button>` : ""}
              <span class="muted" style="font-size:13px">${it.tx.n.toLocaleString()} transactions${it.tx.first ? ` since ${shortDate(it.tx.first)}, ${it.tx.first.slice(0, 4)}` : ""}${it.holdings.n ? ` · ${it.holdings.n} holdings` : ""}</span></div>
          </div>`;
        }).join("") || `<div class="empty">Nothing linked yet.</div>`}</div>
        <div class="actions" style="margin-top:18px">
          <button class="btn" id="bank" ${!s.keys || s.used >= s.cap ? "disabled" : ""}>Link a bank or card</button>
          <button class="btn" id="brokerage" ${!s.keys || s.used >= s.cap ? "disabled" : ""}>Link a brokerage</button>
          <span class="muted" style="font-size:13px">Each link uses one of ${s.cap} slots for good. Fix a broken one instead of linking it again.</span>
        </div>
      </section>
    </div>`;
  const msg = (t, bad) => { document.getElementById("msg").innerHTML = t ? `<div class="notice ${bad ? "bad" : ""}">${esc(t)}</div>` : ""; };
  for (const b of document.querySelectorAll("[data-sync]")) b.onclick = async () => {
    b.disabled = true; msg("Syncing…");
    try { const { results } = await api("/api/sync", { item_id: b.dataset.sync }); const e = results.flatMap((r) => r.errors); await PAGES.accounts(); if (e.length) msg(e.join("\n"), true); }
    catch (e) { msg(e.message, true); b.disabled = false; }
  };
  for (const b of document.querySelectorAll("[data-fix]")) b.onclick = () => link({ itemId: b.dataset.fix }, msg);
  document.getElementById("bank").onclick = () => link({ kind: "bank" }, msg);
  document.getElementById("brokerage").onclick = () => link({ kind: "brokerage" }, msg);
};

// Fixing a connection uses update mode on the same Item, which keeps its slot.
async function link({ kind, itemId }, msg) {
  msg("");
  try {
    const { link_token } = await api("/api/link-token", itemId ? { itemId } : { kind });
    window.Plaid.create({
      token: link_token,
      onSuccess: async (public_token, meta) => {
        if (itemId) { msg("Fixed. Syncing…"); await api("/api/sync", { item_id: itemId }); return PAGES.accounts(); }
        msg(`Linked ${meta.institution?.name ?? "it"}. Pulling data…`);
        try { await api("/api/exchange", { public_token, institution: meta.institution, kind }); META = null; await render(); }
        catch (e) { msg(e.message, true); }
      },
      onExit: (err) => { if (err) msg(`${err.error_code ?? ""}: ${err.display_message ?? err.error_message ?? "Link closed"}`, true); },
    }).open();
  } catch (e) { msg(e.message, true); }
}

window.addEventListener("hashchange", render);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePicker(); });
render();
