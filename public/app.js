// tally's pages. Hash routes: #/, #/transactions, #/spending, #/budgets, #/bills, #/accounts.
// Each page fills the teal band (#hero) and the cards below it (#page). Month pages take ?month=YYYY-MM.
const $page = document.getElementById("page");
const $hero = document.getElementById("hero");
const $tip = document.getElementById("tip");
let META = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n, cents = false) => (cents ? usd2 : usd0).format(n ?? 0);
// Plaid: positive is money out. Money in shows with a plus, in teal.
const amt = (n) => n < 0 ? `<span class="num in">+${money(-n, true)}</span>` : `<span class="num">${money(n, true)}</span>`;
const label = (c) => META?.labels[c] ?? c;
const mdate = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
const monthName = (m, style = "long") => mdate(m).toLocaleString("en-US", { month: style });
const monthYear = (m) => mdate(m).toLocaleString("en-US", { month: "long", year: "numeric" });
// The year shows only when it isn't this year.
const shortDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.slice(0, 4) !== String(new Date().getFullYear()) ? { year: "numeric" } : {}) });
const shiftMonth = (m, by) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);
const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// Category colors follow the category, never its rank, so Groceries is the same color in every month.
// Seven hues, in the order the colorblind check passed them as neighbors; every other category is gray "Other".
const CAT_COLOR = {
  FOOD_AND_DRINK: "#55B8E8", GROCERIES: "#F877A5", GENERAL_MERCHANDISE: "#9D75D8", GAS: "#E0A400",
  RENT_AND_UTILITIES: "#00B59B", GENERAL_SERVICES: "#ED9857", ENTERTAINMENT: "#4F7FD0",
};
const OTHER = "#A9B0B6";
const catColor = (c) => CAT_COLOR[c] ?? OTHER;
const AVATAR = ["#24272C", "#1B8382", "#7E5BC2", "#3F6CC0", "#C2662A"];

const ICON = {
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  pie: '<path d="M12 3v9h9A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  month: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  repeat: '<path d="M4 9a6 6 0 0 1 6-5h8l-3-3M20 15a6 6 0 0 1-6 5H6l3 3"/>',
  bank: '<path d="M3 9 12 4l9 5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
};
const icon = (n, s = 20, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

const NAV = [["overview", "Overview", "home", "Home"], ["transactions", "Transactions", "list", "Activity"], ["spending", "Spending", "pie", "Spending"],
  ["budgets", "Budgets", "month", "Budgets"], ["bills", "Bills", "repeat", "Bills"], ["accounts", "Accounts", "bank", "Accounts"]];
const href = (page) => `#/${page === "overview" ? "" : page}`;
document.getElementById("seg").innerHTML = NAV.map(([p, n]) => `<a href="${href(p)}" data-page="${p}">${n}${p === "accounts" ? '<span class="dot" hidden></span>' : ""}</a>`).join("");
document.getElementById("tabbar").innerHTML = NAV.map(([p, , i, short]) => `<a href="${href(p)}" data-page="${p}">${icon(i, 22)}${short}${p === "accounts" ? '<span class="dot" hidden></span>' : ""}</a>`).join("");

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.code ? `${j.code}: ${j.error}` : j.error || `HTTP ${r.status}`);
  return j;
}

function route() {
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  let page = path.replace(/^\//, "") || "overview";
  if (page === "recurring") page = "bills";
  return { page, q: new URLSearchParams(qs ?? "") };
}
const go = (page, params) => { location.hash = `${href(page)}${params && [...params].length ? "?" + params : ""}`; };

async function render() {
  const { page, q } = route();
  for (const a of document.querySelectorAll("#seg a, #tabbar a")) {
    a.classList.toggle("on", a.dataset.page === page);
    if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  closePicker(); closeMenu();
  try {
    META ??= await api("/api/meta");
    await (PAGES[page] ?? PAGES.overview)(q);
  } catch (e) {
    $hero.innerHTML = "";
    $page.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`;
  }
  api("/api/status").then((s) => {
    const bad = s.items.some((i) => i.last_error);
    for (const d of document.querySelectorAll(".dot")) d.hidden = !bad;
  }).catch(() => {});
}
const notice = (msg, bad = true) => $page.insertAdjacentHTML("afterbegin", `<div class="notice ${bad ? "bad" : ""}">${esc(msg)}</div>`);

// ---------- the month menu in the band ----------
let menuOpen = null;
function closeMenu() { if (!menuOpen) return; menuOpen.querySelector(".menu").hidden = true; menuOpen.querySelector("button").setAttribute("aria-expanded", "false"); menuOpen = null; }
function monthMenu(month, history, page, suffix) {
  const months = history.filter((h) => h.hasData).reverse();
  return `<div class="month" id="month"><button aria-haspopup="true" aria-expanded="false">${esc(monthName(month))}${month.slice(0, 4) !== thisMonth().slice(0, 4) ? ` ${month.slice(0, 4)}` : ""} ${suffix} ${icon("down", 16, 2.4)}</button>
    <div class="menu" hidden>${months.map((h) => `<a href="${href(page)}${h.month === thisMonth() ? "" : `?month=${h.month}`}" class="${h.month === month ? "on" : ""}">${monthYear(h.month)}<small class="num">${money(h.spent)}</small></a>`).join("")}</div></div>`;
}
function wireMonthMenu() {
  const m = document.getElementById("month");
  if (!m) return;
  const btn = m.querySelector("button"), menu = m.querySelector(".menu");
  btn.onclick = (e) => {
    e.stopPropagation();
    if (menuOpen) return closeMenu();
    menu.hidden = false; btn.setAttribute("aria-expanded", "true"); menuOpen = m;
    (menu.querySelector("a.on") ?? menu.querySelector("a"))?.focus();
  };
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("a")], i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
  });
}
document.addEventListener("click", (e) => { if (menuOpen && !menuOpen.contains(e.target)) closeMenu(); });

// ---------- the budget hero (overview and budgets) ----------
function plan(s) {
  const limit = s.budgets.reduce((t, b) => t + b.budget, 0), spent = s.budgets.reduce((t, b) => t + b.spent, 0);
  return { limit, spent, left: limit - spent };
}
function budgetHero(s, page) {
  const pm = monthName(shiftMonth(s.month, -1)), daysLeft = s.days - s.day;
  const todayMark = s.current ? `<span class="today" style="left:${(s.day / s.days) * 100}%"></span>` : "";
  const canFill = s.unset.some((b) => b.suggested);
  if (s.budgets.length) {
    const p = plan(s);
    const line = s.current
      ? (p.left >= 0 ? `You have <b class="num">${money(p.left)}</b> left${daysLeft ? ` for the next ${plural(daysLeft, "day")}` : " today"}.` : `You're <b class="num">${money(-p.left)}</b> over${daysLeft ? ` with ${plural(daysLeft, "day")} to go` : ""}.`)
      : (p.left >= 0 ? `You finished <b class="num">${money(p.left)}</b> under.` : `You finished <b class="num">${money(-p.left)}</b> over.`);
    return `${monthMenu(s.month, s.history, page, "budget")}
      <div class="big num">${money(p.spent)} <span>of ${money(p.limit)}</span></div>
      <p>${line}</p>
      <div class="track"><i style="width:${p.limit > 0 ? Math.min(100, (p.spent / p.limit) * 100) : 100}%"></i>${todayMark}</div>`;
  }
  // No budgets yet: measure the month against last month instead.
  const line = s.spentLastMonth > 0
    ? (s.current ? `${pm} came to <b class="num">${money(s.spentLastMonth)}</b>, and <b class="num">${money(s.spentLastMonthSoFar)}</b> by this day.` : `${pm} came to <b class="num">${money(s.spentLastMonth)}</b>.`)
    : "";
  return `${monthMenu(s.month, s.history, page, "spending")}
    <div class="big num">${money(s.spent)} <span>spent</span></div>
    ${line ? `<p>${line}</p>` : ""}
    ${s.spentLastMonth > 0 ? `<div class="track"><i style="width:${Math.min(100, (s.spent / s.spentLastMonth) * 100)}%"></i>${todayMark}</div>` : ""}
    ${canFill ? `<p><button class="hbtn" data-fill>Set budgets from the last 3 months</button></p>` : ""}`;
}
function wireFill(s, rerender) {
  for (const b of document.querySelectorAll("[data-fill]")) b.onclick = async () => {
    b.disabled = true;
    try { for (const u of s.unset.filter((x) => x.suggested)) await api("/api/budget", { category: u.category, monthly: u.suggested }); await rerender(); }
    catch (e) { notice(e.message); b.disabled = false; }
  };
}

// ---------- pieces ----------
function slices(categories) {
  const mapped = Object.keys(CAT_COLOR).map((c) => categories.find((x) => x.cat === c)).filter(Boolean).map((c) => ({ ...c, color: CAT_COLOR[c.cat], label: label(c.cat) }));
  const rest = categories.filter((c) => !CAT_COLOR[c.cat]);
  if (rest.length) mapped.push({ cat: null, label: "Other", color: OTHER, spent: rest.reduce((t, c) => t + c.spent, 0), n: rest.reduce((t, c) => t + c.n, 0), parts: rest });
  return mapped;
}
function donut(categories, size, stroke) {
  const s = slices(categories), total = s.reduce((t, c) => t + c.spent, 0);
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, gap = s.length > 1 ? 2 : 0;
  let off = 0;
  const arcs = s.map((c) => {
    const len = (c.spent / total) * C, dash = Math.max(len - gap, 0.5);
    const tip = `${c.label}: ${money(c.spent, true)}${c.parts ? ` (${c.parts.map((p) => label(p.cat)).join(", ")})` : ""}`;
    const el = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${c.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})" data-tip="${esc(tip)}"></circle>`;
    off += len; return el;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Spending by category: ${esc(s.map((c) => `${c.label} ${money(c.spent)}`).join(", "))}">${arcs}</svg>`;
}
function wireTips(root) {
  for (const n of root.querySelectorAll("[data-tip]")) {
    n.addEventListener("mousemove", (e) => showTip(e, n.dataset.tip));
    n.addEventListener("mouseleave", hideTip);
  }
}
function showTip(e, text) {
  $tip.textContent = text; $tip.hidden = false;
  const r = $tip.getBoundingClientRect();
  $tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, e.clientX + 12))}px`;
  $tip.style.top = `${e.clientY - r.height - 10}px`;
}
const hideTip = () => { $tip.hidden = true; };

const txLink = (params) => `#/transactions?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`;
const catDot = (c) => `<span class="cav" style="background:${catColor(c)}24"><span class="sw" style="background:${catColor(c)}"></span></span>`;
const short = (name) => String(name ?? "").replace(/ Visa Signature Card \d+$/, " Visa");
// Privacy.com card charges arrive as "PWP*Merchant 2026-11-08". Show the merchant.
const nice = (who) => String(who ?? "").replace(/^PWP\*/i, "").replace(/ \d{4}-\d\d-\d\d$/, "");
const activityRow = (t) => `<div class="row">${catDot(t.cat)}<span class="w"><b>${esc(nice(t.who))}${t.pending ? '<span class="tag">pending</span>' : ""}</b><small>${shortDate(t.date)}, ${esc(label(t.cat))}</small></span>
  <span class="amt">${amt(t.amount)}<small class="acct">${esc(short(t.account_name))}</small></span></div>`;

const FREQ = { WEEKLY: "Weekly", BIWEEKLY: "Every 2 weeks", SEMI_MONTHLY: "Twice a month", MONTHLY: "Monthly", ANNUALLY: "Yearly", UNKNOWN: "Irregular" };
const billRow = (r, i) => `<div class="row"><span class="av" style="background:${AVATAR[i % AVATAR.length]}">${esc((nice(r.who) || "?").trim()[0].toUpperCase())}</span>
  <span class="w"><b>${esc(nice(r.who))}</b><small>${r.is_active && r.predicted_next_date ? `Due ${shortDate(r.predicted_next_date)}` : r.last_date ? `Last charged ${shortDate(r.last_date)}` : ""}</small></span>
  <span class="amt num">${money(Math.abs(r.average_amount), true)}<small>${FREQ[r.frequency] ?? esc(r.frequency)}</small></span></div>`;
const byNextDue = (a, b) => (a.predicted_next_date ?? "9999") < (b.predicted_next_date ?? "9999") ? -1 : 1;

function netWorthCard(nw, hist) {
  const parts = [["Cash", nw.cash, "#00CDA9"], ["Investments", nw.investments, "#1B8382"], ["Owed on cards", nw.owed, "#F877A5"]];
  const sum = parts.reduce((t, p) => t + Math.max(0, p[1]), 0) || 1;
  let line = "";
  if (hist.length >= 2) {
    const W = 300, H = 56, min = Math.min(...hist.map((h) => h.total)), max = Math.max(...hist.map((h) => h.total)), span = max - min || 1;
    const pts = hist.map((h, i) => [(i / (hist.length - 1)) * W, H - 4 - ((h.total - min) / span) * (H - 8)]);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const change = hist.at(-1).total - hist[0].total;
    line = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net worth since ${shortDate(hist[0].date)}"><path d="${d}L${W},${H}L0,${H}Z" fill="#E5FAF5"/><path d="${d}" fill="none" stroke="#1B8382" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="kv"><span>${change >= 0 ? "Up" : "Down"} since ${shortDate(hist[0].date)}</span><b class="num">${money(Math.abs(change))}</b></div>`;
  }
  return `<div class="card"><h2>Net worth <a href="#/accounts">Accounts</a></h2><div class="nw num">${money(nw.total, true)}</div>
    <div class="nwsplit">${parts.filter((p) => p[1] > 0).map((p) => `<span style="flex:${p[1] / sum};background:${p[2]}"></span>`).join("")}</div>
    ${parts.map((p, i) => `<div class="kv"><span><span class="key" style="background:${p[2]}"></span>${p[0]}</span><b class="num">${i === 2 && p[1] ? "-" : ""}${money(p[1], true)}</b></div>`).join("")}
    ${line}</div>`;
}
function yourBudgetsCard(s) {
  if (!s.budgets.length) return "";
  const p = plan(s), left = s.income - p.limit;
  return `<div class="card"><h2>Your budgets</h2><div style="margin-top:8px">
    <div class="kv"><span>Income${s.current ? " so far" : ""}</span><b class="num">${money(s.income, true)}</b></div>
    <div class="kv"><span>Budgeted spending</span><b class="num">-${money(p.limit)}</b></div>
    <div class="kv total"><span>Left over</span><b class="num ${left < 0 ? "over" : ""}">${left < 0 ? "-" : ""}${money(Math.abs(left))}</b></div></div></div>`;
}
const GROUPS = [["depository", "Cash"], ["credit", "Credit cards"], ["investment", "Investments"], ["loan", "Loans"]];
function accountsCard(status) {
  const accts = status.items.flatMap((it) => it.accounts.map((a) => ({ ...a, inst: it.institution_name })));
  return `<div class="card"><h2>Accounts <a href="#/accounts">Manage</a></h2><div style="margin-top:8px">${GROUPS.filter(([t]) => accts.some((a) => a.type === t)).map(([t, name]) => {
    const list = accts.filter((a) => a.type === t), total = list.reduce((x, a) => x + (a.current ?? 0), 0);
    // Accounts at $5 or less (empty savings buckets, paid-off cards) stay on the Accounts page.
    return `<div class="grp"><div class="gh"><span>${name}</span><span class="num">${t === "credit" || t === "loan" ? "-" : ""}${money(total, true)}</span></div>
      ${list.filter((a) => Math.abs(a.current ?? 0) > 5).map((a) => `<div class="acct"><span>${esc(short(a.name))}</span><span class="num">${money(a.current, true)}</span></div>`).join("")}</div>`;
  }).join("")}</div></div>`;
}
function comingUpCard(bills) {
  const list = bills.slice().sort(byNextDue).slice(0, 6);
  const perMonth = bills.reduce((t, r) => t + r.monthly, 0);
  return `<div class="card"><h2>Coming up <a href="#/bills">All bills</a></h2>
    ${list.length ? `<div class="sub">You pay <b class="num">${money(perMonth)}</b> a month for these</div>${list.map(billRow).join("")}` : `<div class="empty" style="margin-top:8px">No repeating bills found yet.</div>`}</div>`;
}

// ---------- overview ----------
const PAGES = {};
PAGES.overview = async (q) => {
  const month = q.get("month") ?? "";
  const [s, status] = await Promise.all([api(`/api/summary${month ? `?month=${month}` : ""}`), api("/api/status")]);
  const m = monthName(s.month), pm = monthName(shiftMonth(s.month, -1));
  $hero.innerHTML = budgetHero(s, "overview");

  const net = s.income - s.spent, mx = Math.max(s.income, s.spent, 1);
  const cash = `<div class="card"><h2>Cash flow</h2>
    <div class="sub"><b class="num">${money(Math.abs(net), true)}</b> more ${net < 0 ? "out than in" : "in than out"}${s.current ? " so far" : ""}</div>
    <div class="cfr">${[["Earned", s.income, "#00CDA9"], ["Spent", s.spent, "#F877A5"]].map(([k, v, c]) => `<div class="lab"><span>${k}</span><b class="num">${money(v, true)}</b></div><div class="t"><i style="width:${(v / mx) * 100}%;background:${c}"></i></div>`).join("")}</div>
    <div class="note">${s.current ? `Last month by this day you'd spent <b class="num">${money(s.spentLastMonthSoFar, true)}</b>.` : `${pm} came to <b class="num">${money(s.spentLastMonth, true)}</b> in all.`}</div></div>`;

  const sl = slices(s.categories), total = s.categories.reduce((t, c) => t + c.spent, 0);
  const where = `<div class="card"><h2>Where it went <a href="#/spending${s.current ? "" : `?month=${s.month}`}">Spending</a></h2>
    ${s.categories.length ? `<div class="sub">You've spent <b class="num">${money(total, true)}</b> ${s.current ? "so far this month" : `in ${m}`}</div>
    <div class="dl"><div class="ring" style="width:150px;height:150px">${donut(s.categories, 150, 20)}<div class="c"><b class="num">${money(total)}</b></div></div>
      <div class="vleg">${sl.slice().sort((a, b) => b.spent - a.spent).map((c) => `<a href="${txLink({ cat: c.cat, month: s.month })}"><span class="sw" style="background:${c.color}"></span><span class="l">${esc(c.label)}</span><b class="num">${money(c.spent, true)}</b></a>`).join("")}</div></div>`
      : `<div class="empty" style="margin-top:8px">No spending in ${m} yet.</div>`}</div>`;

  const over = s.budgets.filter((b) => b.spent > b.budget).sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));
  const ok = s.budgets.filter((b) => b.spent <= b.budget);
  const tick = s.current ? `<span class="today" style="left:${(s.day / s.days) * 100}%"></span>` : "";
  const budgetsCard = `<div class="card span2"><h2>Budgets <a href="#/budgets${s.current ? "" : `?month=${s.month}`}">Edit budgets</a></h2>
    ${s.budgets.length ? `<div class="sub">${over.length ? `<b>${over.length} over</b>, ` : ""}${ok.length} on track</div>
      ${over.length ? `<div class="need">${over.map((b) => `<a class="brow" href="${txLink({ cat: b.category, month: s.month })}"><div class="l1"><span class="name">${esc(b.label)}</span><span class="num over"><b>${money(b.spent - b.budget)}</b> over</span></div>
        <div class="bar over"><i style="width:100%"></i>${tick}</div><div class="l2"><span class="num"><b>${money(b.spent, true)}</b> of ${money(b.budget)}</span></div></a>`).join("")}</div>` : ""}
      ${ok.length ? `<details class="ontrack"${over.length ? "" : " open"}><summary><span>${icon("chev", 16, 2.2).replace("<svg", '<svg class="chev"')}${plural(ok.length, "budget")} on track</span><span class="minis" aria-hidden="true">${ok.map((b) => `<i><b style="width:${b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 0}%"></b></i>`).join("")}</span></summary>
        ${ok.map((b) => `<div class="mini"><a href="${txLink({ cat: b.category, month: s.month })}">${esc(b.label)}</a><span class="t"><i style="width:${b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 0}%"></i></span><span class="v num"><b>${money(b.budget - b.spent)}</b> left</span></div>`).join("")}</details>` : ""}`
      : `<div class="empty" style="margin-top:8px">No budgets yet.${s.unset.some((b) => b.suggested) ? ` <button class="more" data-fill>Set them from the last 3 months</button>` : ""}</div>`}</div>`;

  const activity = `<div class="card span2"><h2>Recent activity <a href="#/transactions${s.current ? "" : `?month=${s.month}`}">All transactions</a></h2>
    <div class="sub">Every account, newest first</div>${s.recent.map(activityRow).join("") || `<div class="empty">Nothing yet.</div>`}</div>`;

  $page.innerHTML = `<div class="layout"><div class="cols2">${cash}${where}${budgetsCard}${activity}</div>
    <aside class="side stack">${netWorthCard(s.netWorth, s.netWorthHistory)}${yourBudgetsCard(s)}${accountsCard(status)}${comingUpCard(s.bills)}</aside></div>`;
  wireMonthMenu(); wireTips($page); wireFill(s, () => PAGES.overview(q));
};

// ---------- transactions ----------
PAGES.transactions = async (q) => {
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(thisMonth(), -i));
  const cats = Object.keys(META.labels).sort((a, b) => label(a).localeCompare(label(b)));
  $hero.innerHTML = `<div class="k">Transactions</div><div class="big num" id="count" style="font-size:40px;line-height:48px">&nbsp;</div><p id="sum">&nbsp;</p>
    <div class="filters">
      <input type="search" id="fq" placeholder="Search" aria-label="Search transactions" value="${esc(q.get("q") ?? "")}">
      <select id="fmonth" aria-label="Month"><option value="">All months</option>${months.map((m) => `<option value="${m}">${monthYear(m)}</option>`).join("")}</select>
      <select id="fcat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join("")}</select>
      <select id="facct" aria-label="Account"><option value="">All accounts</option>${META.accounts.filter((a) => a.type !== "investment").map((a) => `<option value="${a.account_id}">${esc(short(a.name))}${a.mask ? ` ${esc(a.mask)}` : ""}</option>`).join("")}</select>
    </div>`;
  $page.innerHTML = `<div class="card"><table class="tx"><thead><tr><th class="d">Date</th><th>Name</th><th class="cat-col">Category</th><th class="acct-col">Account</th><th class="amt">Amount</th></tr></thead><tbody id="rows"></tbody></table>
    <div id="more"></div></div>`;
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
      <td class="d num">${shortDate(t.date)}</td>
      <td><div>${esc(nice(t.who))}${t.pending ? '<span class="tag">pending</span>' : ""}</div><div class="who-sub">${shortDate(t.date)}, ${catBtn(t)}</div></td>
      <td class="cat-col">${catBtn(t)}</td>
      <td class="acct-col muted">${esc(short(t.account_name))}</td>
      <td class="amt">${amt(t.amount)}</td></tr>`).join("");
    const rows = document.getElementById("rows");
    if (append) rows.insertAdjacentHTML("beforeend", html); else rows.innerHTML = html || `<tr><td colspan="5" class="empty">No transactions match. <button class="more" id="clear">Clear the filters</button></td></tr>`;
    document.getElementById("clear")?.addEventListener("click", () => go("transactions"));
    offset += r.rows.length;
    document.getElementById("count").innerHTML = `${r.total.toLocaleString()} <span>${r.total === 1 ? "transaction" : "transactions"}</span>`;
    document.getElementById("sum").innerHTML = r.total ? `<b class="num">${money(Math.abs(r.sum), true)}</b> ${r.sum >= 0 ? "more out than in" : "more in than out"}` : "&nbsp;";
    document.getElementById("more").innerHTML = offset < r.total ? `<button class="more" id="loadmore">Show ${Math.min(100, r.total - offset)} more</button>` : "";
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

const catBtn = (t) => `<button class="catbtn${t.overridden ? " set" : ""}" data-id="${esc(t.transaction_id)}" data-cat="${esc(t.cat)}" data-who="${esc(t.who)}" data-ov="${t.overridden ? 1 : 0}" aria-label="Category: ${esc(label(t.cat))}. Change it"><span class="sw" style="background:${catColor(t.cat)}"></span>${esc(label(t.cat))}</button>`;

// ---------- category picker ----------
let picker = null;
function closePicker() { picker?.remove(); picker = null; document.removeEventListener("mousedown", outside); }
function outside(e) { if (picker && !picker.contains(e.target)) closePicker(); }
function openPicker(btn, done) {
  closePicker();
  const cats = Object.keys(META.labels).sort((a, b) => label(a).localeCompare(label(b)));
  picker = document.createElement("div");
  picker.className = "picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", `Category for ${btn.dataset.who}`);
  picker.innerHTML = `<div class="opts">${cats.map((c) => `<button class="opt${c === btn.dataset.cat ? " on" : ""}" data-c="${c}"><span class="sw" style="background:${catColor(c)}"></span>${esc(label(c))}</button>`).join("")}
      ${btn.dataset.ov === "1" ? `<button class="opt muted" data-c="">Back to automatic</button>` : ""}</div>
    <label><input type="checkbox" id="pall"> Every ${esc(btn.dataset.who)} transaction</label>`;
  document.body.append(picker);
  const r = btn.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(window.innerWidth - 258, r.left + scrollX))}px`;
  picker.style.top = `${r.bottom + scrollY + 6}px`;
  (picker.querySelector(".opt.on") ?? picker.querySelector(".opt")).focus();
  picker.addEventListener("click", async (e) => {
    const o = e.target.closest(".opt");
    if (!o) return;
    try {
      await api("/api/category", { transaction_id: btn.dataset.id, category: o.dataset.c || null, merchant: picker.querySelector("#pall").checked });
      closePicker(); await done();
    } catch (err) { notice(err.message); }
  });
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
}

// ---------- spending ----------
PAGES.spending = async (q) => {
  const month = q.get("month") ?? "";
  const r = await api(`/api/spending${month ? `?month=${month}` : ""}`);
  const total = r.categories.reduce((s, c) => s + c.spent, 0), n = r.categories.reduce((s, c) => s + c.n, 0);
  const prev = r.history.find((h) => h.month === shiftMonth(r.month, -1));
  $hero.innerHTML = `${monthMenu(r.month, r.history, "spending", "spending")}
    <div class="big num">${money(total)}</div>
    <p>${n ? `${plural(n, "purchase")} in ${plural(r.categories.length, "category", "categories")}.` : "No spending yet."}${prev?.hasData ? ` ${monthName(prev.month)} came to <b class="num">${money(prev.spent)}</b>.` : ""}</p>`;
  $page.innerHTML = `<div class="stack">
    <div class="card"><h2>Where it went</h2>
      ${r.categories.length ? `<div class="spend"><div class="ring" style="width:220px;height:220px">${donut(r.categories, 220, 26)}<div class="c">Spent<b class="num">${money(total, true)}</b></div></div>
        <table class="rank">${r.categories.map((c) => `<tr><td><span class="sw" style="background:${catColor(c.cat)}"></span><a href="${txLink({ cat: c.cat, month: r.month })}">${esc(label(c.cat))}</a></td><td class="n">${plural(c.n, "purchase")}</td><td class="v num">${money(c.spent, true)}</td></tr>`).join("")}</table></div>`
        : `<div class="empty" style="margin-top:8px">No spending in ${monthName(r.month)}. <a class="more" href="#/spending">Back to this month</a></div>`}</div>
    <div class="card" id="chart"><h2>By month <span class="aside">Click a month to open it</span></h2></div></div>`;
  document.getElementById("chart").append(barChart(r.history, { current: thisMonth(), picked: r.month, onPick: (mm) => go("spending", mm === thisMonth() ? null : new URLSearchParams({ month: mm })) }));
  wireMonthMenu(); wireTips($page);
};

function barChart(history, { onPick, current, picked } = {}) {
  const W = 760, H = 220, pad = { l: 48, r: 4, t: 10, b: 26 };
  const max = Math.max(1, ...history.map((h) => h.spent));
  const step = niceStep(max / 3), top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, bw = iw / history.length;
  const y = (v) => pad.t + ih - (v / top) * ih;
  let g = "";
  for (let v = 0; v <= top + 0.001; v += step) g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? `$${v / 1000}k` : `$${v}`}</text>`;
  history.forEach((h, i) => {
    const x = pad.l + i * bw, w = Math.min(30, bw * 0.6), bx = x + (bw - w) / 2;
    const v = Math.max(0, h.spent), t0 = y(v), hgt = Math.max(0, pad.t + ih - t0);
    const tip = !h.hasData ? `${monthYear(h.month)}: no data` : `${monthYear(h.month)}: ${money(h.spent)}${h.month === current ? " so far" : ""}`;
    const fill = h.month === picked ? "#00A88B" : "#1B8382";
    g += `<g data-m="${h.month}" data-tip="${esc(tip)}"><rect class="hit" x="${x}" y="${pad.t}" width="${bw}" height="${ih}"/>`
      + (h.hasData && hgt > 0 ? `<path class="b-path" fill="${fill}" ${h.month === current ? 'opacity=".6"' : ""} d="${roundTop(bx, t0, w, hgt, Math.min(4, hgt))}"/>` : "")
      + `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" ${h.month === picked ? 'style="font-weight:700;fill:#24272C"' : ""}>${monthName(h.month, "short")}</text></g>`;
  });
  const el = document.createElement("div");
  el.className = "chart";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending by month">${g}</svg>
    <table class="sr">${history.map((h) => `<tr><td>${monthYear(h.month)}</td><td>${h.hasData ? money(h.spent) : "no data"}</td></tr>`).join("")}</table>`;
  for (const node of el.querySelectorAll("g[data-m]")) {
    node.addEventListener("mousemove", (e) => showTip(e, node.dataset.tip));
    node.addEventListener("mouseleave", hideTip);
    if (onPick) node.addEventListener("click", () => onPick(node.dataset.m));
  }
  return el;
}
function roundTop(x, y, w, h, r) { return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p; }

// ---------- budgets ----------
PAGES.budgets = async (q) => {
  const month = q.get("month") ?? "";
  const s = await api(`/api/summary${month ? `?month=${month}` : ""}`);
  $hero.innerHTML = budgetHero(s, "budgets");
  const tick = s.current ? `<span class="today" style="left:${(s.day / s.days) * 100}%"></span>` : "";
  const field = (b, value, ph) => `<label class="amtin">${value != null ? "of" : ph ? "avg" : ""}<input inputmode="decimal" data-cat="${b.category}" value="${value ?? ""}" placeholder="${ph ? Math.round(ph) : "$"}" aria-label="${esc(b.label)} monthly budget"></label>`;
  const set = s.budgets.slice().sort((a, b) => (b.spent - b.budget) - (a.spent - a.budget));
  const unset = s.unset.slice().sort((a, b) => b.spent - a.spent || (b.suggested ?? 0) - (a.suggested ?? 0));
  $page.innerHTML = `<div class="layout"><div class="stack">
    <div class="card"><h2>Budgets</h2>
      ${set.length ? set.map((b) => {
        const over = b.spent > b.budget;
        return `<div class="erow"><div class="brow"><div class="l1"><span class="name">${esc(b.label)}</span><span class="num ${over ? "over" : ""}"><b>${money(Math.abs(b.budget - b.spent))}</b> ${over ? "over" : "left"}</span></div>
          <div class="bar ${over ? "over" : ""}"><i style="width:${b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 100}%"></i>${tick}</div>
          <div class="l2"><span class="num"><b>${money(b.spent, true)}</b> spent</span></div></div>${field(b, b.budget)}</div>`;
      }).join("") : `<div class="empty" style="margin-top:8px">No budgets yet. Set one below, or fill them all from your last 3 months.${s.unset.some((b) => b.suggested) ? ` <button class="more" data-fill>Fill them in</button>` : ""}</div>`}
    </div>
    ${unset.length ? `<div class="card"><h2>Not budgeted <span class="aside num">${money(unset.reduce((t, b) => t + b.spent, 0), true)} spent</span></h2>
      ${unset.map((b) => `<div class="erow"><div><div class="name" style="font-weight:600">${esc(b.label)}</div><div class="muted num" style="font-size:14px">${money(b.spent, true)} spent${b.suggested ? `, about ${money(b.suggested)} a month lately` : ""}</div></div>${field(b, null, b.suggested)}</div>`).join("")}</div>` : ""}
    </div><aside class="side stack">${yourBudgetsCard(s)}</aside></div>`;
  for (const inp of $page.querySelectorAll(".amtin input")) {
    const save = async () => {
      const v = inp.value.replace(/[$,\s]/g, "");
      if (v === String(inp.defaultValue)) return;
      try { await api("/api/budget", { category: inp.dataset.cat, monthly: v === "" ? null : Number(v) }); await PAGES.budgets(q); }
      catch (e) { notice(e.message); }
    };
    inp.addEventListener("change", save);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  }
  wireMonthMenu(); wireFill(s, () => PAGES.budgets(q));
};

// ---------- bills ----------
PAGES.bills = async () => {
  const all = await api("/api/recurring");
  const bills = all.filter((r) => r.direction === "outflow" && r.is_active && !r.is_transfer).sort(byNextDue);
  const income = all.filter((r) => r.direction === "inflow" && r.is_active && !r.is_transfer);
  const ended = all.filter((r) => r.direction === "outflow" && !r.is_active && !r.is_transfer);
  const perMonth = bills.reduce((s, r) => s + r.monthly, 0);
  const next = bills.find((r) => r.predicted_next_date);
  $hero.innerHTML = `<div class="k">Bills and subscriptions</div>
    <div class="big num">${money(perMonth)} <span>a month</span></div>
    <p>${next ? `Next up: ${esc(nice(next.who))}, <b class="num">${money(Math.abs(next.average_amount), true)}</b> on ${shortDate(next.predicted_next_date)}.` : "Plaid hasn't found any repeating charges yet."}</p>`;
  const incomeRow = (r) => `<div class="row"><span class="w"><b>${esc(nice(r.who))}</b><small>${FREQ[r.frequency] ?? esc(r.frequency)}${r.last_date ? `, last ${shortDate(r.last_date)}` : ""}</small></span><span class="amt num in">+${money(Math.abs(r.average_amount), true)}<small>average</small></span></div>`;
  $page.innerHTML = `<div class="layout"><div class="stack">
      <div class="card"><h2>Bills and subscriptions <span class="aside">${plural(bills.length, "repeating charge")}</span></h2><div style="margin-top:8px">${bills.map(billRow).join("") || `<div class="empty">None found yet.</div>`}</div></div>
      ${ended.length ? `<div class="card"><h2>Stopped charging</h2><div style="margin-top:8px">${ended.map(billRow).join("")}</div></div>` : ""}
    </div><aside class="side stack"><div class="card"><h2>Money coming in</h2><div style="margin-top:8px">${income.map(incomeRow).join("") || `<div class="empty">None found yet.</div>`}</div></div></aside></div>`;
};

// ---------- accounts and connections ----------
PAGES.accounts = async () => {
  const [s, sum] = await Promise.all([api("/api/status"), api("/api/summary")]);
  const nw = sum.netWorth;
  const accounts = s.items.flatMap((it) => it.accounts.map((a) => ({ ...a, inst: it.institution_name })));
  $hero.innerHTML = `<div class="k">Net worth</div><div class="big num">${money(nw.total, true)}</div>
    <p><b class="num">${money(nw.cash)}</b> cash, <b class="num">${money(nw.investments)}</b> invested, <b class="num">${money(nw.owed)}</b> owed on cards.</p>`;
  const groups = GROUPS.filter(([t]) => accounts.some((a) => a.type === t)).map(([t, name]) => {
    const list = accounts.filter((a) => a.type === t), total = list.reduce((x, a) => x + (a.current ?? 0), 0);
    return `<div class="card"><h2>${name} <span class="aside num">${t === "credit" || t === "loan" ? "-" : ""}${money(total, true)}</span></h2><div style="margin-top:8px">
      ${list.map((a) => `<div class="row"><span class="w"><b>${esc(short(a.name))}</b><small>${esc(a.inst)}${a.mask ? `, ending ${esc(a.mask)}` : ""}${t === "credit" && a.credit_limit ? `, ${money(a.credit_limit)} limit` : ""}</small></span><span class="amt num">${money(a.current, true)}</span></div>`).join("")}</div></div>`;
  }).join("");
  $page.innerHTML = `<div id="msg"></div>
    ${!s.keys ? `<div class="notice bad">No Plaid keys. Put PLAID_CLIENT_ID and PLAID_SECRET in ${esc(s.keysPath)}.</div>` : ""}
    <div class="layout"><div class="cols2">${groups}</div>
    <aside class="side stack"><div class="card"><h2>Connections <span class="aside">${s.used} of ${s.cap} used</span></h2><div style="margin-top:8px">${s.items.map((it) => {
      const broken = /ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|PENDING_DISCONNECT/.test(it.last_error ?? "");
      return `<div class="conn"><div class="top"><b>${esc(it.institution_name)}</b>
          <span class="state ${it.last_error ? "bad" : ""}">${it.last_error ? (broken ? "Sign in again" : "Sync failed") : `Synced ${esc(it.last_sync ? new Date(it.last_sync).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never")}`}</span></div>
        ${it.last_error ? `<div class="err">${esc(it.last_error)}</div>` : ""}
        <div class="hint">${plural(it.tx.n, "transaction")}${it.tx.first ? ` since ${shortDate(it.tx.first)}` : ""}${it.holdings.n ? `, ${plural(it.holdings.n, "holding")}` : ""}</div>
        <div class="actions">${broken ? `<button class="btn primary" data-fix="${esc(it.item_id)}">Fix connection</button>` : ""}<button class="more" style="margin:0" data-sync="${esc(it.item_id)}">Sync now</button></div></div>`;
    }).join("") || `<div class="empty">Nothing linked yet.</div>`}</div>
      <div class="actions" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px">
        <button class="btn primary" id="bank" ${!s.keys || s.used >= s.cap ? "disabled" : ""}>Link a bank or card</button>
        <button class="btn" id="brokerage" ${!s.keys || s.used >= s.cap ? "disabled" : ""}>Link a brokerage</button></div>
      <div class="hint" style="margin-top:8px">Each link uses one of ${s.cap} slots for good. Fix a broken one instead of linking it again.</div></div></aside></div>`;
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

// The sync button in the band: every connection, then redraw the page.
document.getElementById("syncall").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  if (b.disabled) return;
  b.disabled = true; b.classList.add("spin");
  try {
    const { results } = await api("/api/sync", {});
    await render();
    const errs = results.flatMap((r) => r.errors);
    if (errs.length) notice(`Some accounts didn't sync:\n${errs.join("\n")}`);
  } catch (err) { notice(err.message); }
  b.disabled = false; b.classList.remove("spin");
});

window.addEventListener("hashchange", render);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePicker(); if (menuOpen) { const b = menuOpen.querySelector("button"); closeMenu(); b.focus(); } } });
render();
