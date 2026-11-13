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
// Whole-dollar values for a list that add up to the list's rounded total: floor each, then give the leftover dollars
// to the largest fractions. Otherwise eight rounded rows can sum to $1,768 under a $1,767 total.
function wholeDollars(values, keys = values.map((_, i) => String(i))) {
  const floors = values.map(Math.floor), left = Math.round(values.reduce((t, v) => t + v, 0)) - floors.reduce((t, v) => t + v, 0);
  values.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || String(keys[a[1]]).localeCompare(String(keys[b[1]]))).slice(0, Math.max(0, left)).forEach(([, i]) => floors[i]++);
  return floors;
}
// The month's categories in whole dollars, rounded once together, so a category shows the same figure on Home,
// Spending, and Budgets, and the rows add up to the month's total.
function dollarsByCat(categories) {
  const w = wholeDollars(categories.map((c) => c.spent), categories.map((c) => c.cat));
  return new Map(categories.map((c, i) => [c.cat, w[i]]));
}
const sliceDollars = (c, map) => c.cat ? map.get(c.cat) ?? Math.round(c.spent) : c.parts.reduce((t, p) => t + (map.get(p.cat) ?? 0), 0);
// A balance that can go either way, with a real minus sign: signed(-954.35) is "−$954.35".
const signed = (n, cents = false) => `${n < 0 ? "−" : ""}${money(Math.abs(n), cents)}`;
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

const ICON = {
  home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  pie: '<path d="M12 3v9h9A9 9 0 1 1 12 3z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  month: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  bank: '<path d="M3 9 12 4l9 5M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
};
const icon = (n, s = 20, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

// One name per page on desktop and phone. "Transactions" doesn't fit a 65px phone tab, so the page is Activity.
const NAV = [["overview", "Home", "home", "Home"], ["transactions", "Activity", "list", "Activity"], ["spending", "Spending", "pie", "Spending"],
  ["budgets", "Budgets", "month", "Budgets"], ["bills", "Bills", "receipt", "Bills"], ["accounts", "Accounts", "bank", "Accounts"]];
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

// Each navigation bumps GEN. A page checks it after every await, so a slow response from the page the owner left
// can't draw over the one they're on.
let GEN = 0;
const stale = (g) => g !== GEN;
let shownPage = null;
async function render() {
  const { page, q } = route();
  GEN++;
  if (page !== shownPage) { window.scrollTo(0, 0); shownPage = page; }
  for (const a of document.querySelectorAll("#seg a, #tabbar a")) {
    a.classList.toggle("on", a.dataset.page === page);
    if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  closePicker(); closeMenu();
  const g = GEN;
  try {
    META ??= await api("/api/meta");
    if (stale(g)) return;
    await (PAGES[page] ?? PAGES.overview)(q);
  } catch (e) {
    if (stale(g)) return;
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
let focusMonth = false;
function wireMonthMenu() {
  const m = document.getElementById("month");
  if (!m) return;
  const btn = m.querySelector("button"), menu = m.querySelector(".menu");
  if (focusMonth) { focusMonth = false; btn.focus(); }
  for (const a of menu.querySelectorAll("a")) a.addEventListener("click", () => { focusMonth = true; });
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
// Share of a budget used. A $0 budget is fully used only once something is spent against it.
const used = (b) => b.budget > 0 ? b.spent / b.budget : b.spent > 0 ? Infinity : 0;
// Budget totals from the same whole-dollar figures the rows show, so the band always equals the rows' sum.
function plan(s) {
  const d = dollarsByCat(s.categories), all = [...d.values()].reduce((t, v) => t + v, 0);
  const limit = s.budgets.reduce((t, b) => t + Math.round(b.budget), 0), spent = s.budgets.reduce((t, b) => t + (d.get(b.category) ?? 0), 0);
  return { limit, spent, left: limit - spent, outside: all - spent };
}
// Over is decided in cents, like the daily alert; under a dollar over reads "<$1".
const overBy = (b, d) => b.spent - b.budget < 1 ? "<$1" : money(Math.max(1, (d.get(b.category) ?? Math.round(b.spent)) - Math.round(b.budget)));
const leftBy = (b, d) => money(Math.max(0, Math.round(b.budget) - (d.get(b.category) ?? Math.round(b.spent))));
// The Not budgeted subline: what was spent (or refunded), and the recent average unless the suggestion was raised past it.
function notBudgetedLine(b, d) {
  if (d <= -1) return `${money(-d)} refunded`;
  const avg = b.suggested && suggest(b) === b.suggested ? `${money(b.suggested)} a month lately` : "";
  if (d >= 1) return `${money(d)} spent${avg ? `, about ${avg}` : ""}`;
  return avg ? `About ${avg}` : "Nothing spent";
}
// A suggestion never sits below what's already spent this month.
const suggest = (b) => b.suggested ? Math.max(b.suggested, Math.ceil(b.spent / 5) * 5) : null;
function budgetHero(s, page) {
  const pm = monthName(shiftMonth(s.month, -1)), daysLeft = s.days - s.day;
  const todayMark = s.current ? `<span class="today" style="left:${(s.day / s.days) * 100}%"></span>` : "";
  const canFill = s.unset.some((b) => b.suggested);
  if (!s.hasData) return `${monthMenu(s.month, s.history, page, "budget")}<div class="big">No data</div><p>tally has no transactions from ${monthYear(s.month)}.</p>`;
  if (s.budgets.length) {
    const p = plan(s), outside = p.outside;
    const line = s.current
      ? (p.left >= 0 ? `You have <b class="num">${money(p.left)}</b> left${daysLeft ? ` for the next ${plural(daysLeft, "day")}` : " today"}.` : `You're <b class="num">${money(-p.left)}</b> over${daysLeft ? ` with ${plural(daysLeft, "day")} to go` : ""}.`)
      : (p.left >= 0 ? `You finished <b class="num">${money(p.left)}</b> under.` : `You finished <b class="num">${money(-p.left)}</b> over.`);
    // The band counts budgeted categories only, so spending elsewhere gets its own short line instead of being left out.
    const also = outside >= 1 ? `<p class="also"><b class="num">${money(outside)}</b> spent without a budget.</p>`
      : outside <= -1 ? `<p class="also"><b class="num">${money(-outside)}</b> refunded outside your budgets.</p>` : "";
    return `${monthMenu(s.month, s.history, page, "budget")}
      <div class="big num">${money(p.spent)} <span>of ${money(p.limit)}</span></div>
      <p${also ? ' class="has-also"' : ""}>${line}</p>${also}
      <div class="track"><i class="${p.left < 0 ? "over" : ""}" style="width:${p.limit > 0 ? Math.min(100, (p.spent / p.limit) * 100) : p.spent > 0 ? 100 : 0}%"></i>${p.left < 0 ? "" : todayMark}</div>`;
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
    const g = GEN;
    try { for (const u of s.unset.filter((x) => x.suggested)) await api("/api/budget", { category: u.category, monthly: suggest(u) }); if (!stale(g)) await rerender(); }
    catch (e) { if (!stale(g)) { notice(e.message); b.disabled = false; } }
  };
}

// ---------- pieces ----------
function slices(all) {
  const categories = all.filter((c) => c.spent > 0);
  const mapped = categories.filter((c) => CAT_COLOR[c.cat]).sort((a, b) => b.spent - a.spent).map((c) => ({ ...c, color: CAT_COLOR[c.cat], label: label(c.cat) }));
  const rest = categories.filter((c) => !CAT_COLOR[c.cat]);
  // One uncolored category keeps its own name (gray Medical, as on Spending); two or more become gray "Other".
  if (rest.length === 1) mapped.push({ ...rest[0], color: OTHER, label: label(rest[0].cat) });
  else if (rest.length) mapped.push({ cat: null, label: "Other", color: OTHER, spent: rest.reduce((t, c) => t + c.spent, 0), n: rest.reduce((t, c) => t + c.n, 0), parts: rest });
  // Spend order, gray included, so the ring, the legend, and a top three agree.
  return mapped.sort((a, b) => b.spent - a.spent);
}
function stackSegs(sl, total) {
  const big = sl.filter((c) => c.spent >= total * 0.03), tail = sl.filter((c) => c.spent < total * 0.03).reduce((t, c) => t + c.spent, 0);
  return big.map((c) => `<span style="flex:${c.spent};background:${c.color}"></span>`).join("") + (tail ? `<span style="flex:${tail};background:${OTHER}"></span>` : "");
}
function donut(categories, size, stroke, month) {
  const s = slices(categories), total = s.reduce((t, c) => t + c.spent, 0);
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, gap = s.length > 1 ? 2 : 0;
  let off = 0;
  const arcs = s.map((c) => {
    const len = (c.spent / total) * C, dash = Math.max(len - gap, 0.5);
    const tip = `${c.label}: ${money(c.spent, true)}${c.parts ? ` (${c.parts.map((p) => label(p.cat)).join(", ")})` : ""}`;
    const el = `<a href="${sliceLink(c, month)}" aria-label="${esc(tip)}"><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${c.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})" data-tip="${esc(tip)}"></circle></a>`;
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

// "Other" is several categories, so it opens the Spending page, which lists each one.
const sliceLink = (c, month) => c.cat ? txLink({ cat: c.cat, month }) : `#/spending${month === thisMonth() ? "" : `?month=${month}`}`;
const txLink = (params) => `#/transactions?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`;
const catDot = (c) => `<span class="cav" style="background:${catColor(c)}24"><span class="sw" style="background:${catColor(c)}"></span></span>`;
const short = (name) => String(name ?? "").replace(/ Visa Signature Card \d+$/, " Visa");
// Privacy.com card charges arrive as "PWP*Merchant 2026-11-08". Show the merchant.
const nice = (who) => String(who ?? "").replace(/^PWP\*/i, "").replace(/ \d{4}-\d\d-\d\d$/, "");
const activityRow = (t) => `<div class="row${t.pending ? " pending" : ""}">${catDot(t.cat)}<span class="w"><b>${esc(nice(t.who))}${t.pending ? '<span class="tag">pending</span>' : ""}</b><small>${shortDate(t.date)}, ${esc(label(t.cat))}</small></span>
  <span class="amt">${amt(t.amount)}<small class="acct">${esc(short(t.account_name))}</small></span></div>`;

const FREQ = { WEEKLY: "Weekly", BIWEEKLY: "Every 2 weeks", SEMI_MONTHLY: "Twice a month", MONTHLY: "Monthly", ANNUALLY: "Yearly", UNKNOWN: "Irregular" };
// Plaid predicts the next date from past charges, so it's "expected", not a due date. Most bills are monthly,
// so only other frequencies are named.
// Summary cards (Coming up) show whole dollars; record lists (the Bills page) show cents.
const billRow = (r, cents = true, bare = false) => `<div class="row${r.is_active ? "" : " off"}"><span class="av">${esc((nice(r.who) || "?").trim()[0].toUpperCase())}</span>
  <span class="w"><b>${esc(nice(r.who))}</b><small>${r.is_active && r.predicted_next_date ? `${bare ? "" : "Expected "}${shortDate(r.predicted_next_date)}` : r.last_date ? `Last charged ${shortDate(r.last_date)}` : ""}</small></span>
  <span class="amt num">${money(Math.abs(r.average_amount), cents)}${r.frequency !== "MONTHLY" ? `<small>${FREQ[r.frequency] ?? esc(r.frequency)}</small>` : ""}</span></div>`;
const byNextDue = (a, b) => (a.predicted_next_date ?? "9999") < (b.predicted_next_date ?? "9999") ? -1 : 1;

function netWorthCard(nw, hist) {
  const parts = [["Cash", nw.cash], ["Investments", nw.investments], ["Owed on cards", -nw.owed]].filter((p) => p[1]);
  let line = "";
  if (hist.length >= 2) {
    const W = 300, H = 56, min = Math.min(...hist.map((h) => h.total)), max = Math.max(...hist.map((h) => h.total)), span = max - min || 1;
    const pts = hist.map((h, i) => [(i / (hist.length - 1)) * W, H - 4 - ((h.total - min) / span) * (H - 8)]);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
    const change = hist.at(-1).total - hist[0].total;
    line = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net worth since ${shortDate(hist[0].date)}"><path d="${d}L${W},${H}L0,${H}Z" fill="#E5FAF5"/><path d="${d}" fill="none" stroke="#1B8382" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <div class="kv"><span>${change >= 0 ? "Up" : "Down"} since ${shortDate(hist[0].date)}</span><b class="num">${money(Math.abs(change))}</b></div>`;
  }
  return `<div class="card c-nw"><h2>Net worth <a href="#/accounts">All accounts</a></h2><div class="nw num">${money(nw.total)}</div>
    ${line}<div class="groups">${parts.map((p) => `<div class="kv"><span>${p[0]}</span><b class="num">${signed(p[1])}</b></div>`).join("")}</div></div>`;
}
// Budgets against a month of income. Income so far would compare half a month of pay with a whole month of budgets,
// so this month uses expected income: Plaid's repeating deposits, else last month's income. "Over" stays a budget word.
function incomeCard(s, streams) {
  if (!s.budgets.length) return "";
  const p = plan(s);
  const expected = streams.filter((r) => r.direction === "inflow" && r.is_active && !r.is_transfer).reduce((t, r) => t + r.monthly, 0);
  const last = s.history.find((h) => h.month === shiftMonth(s.month, -1));
  const [name, income] = !s.current ? [`Income in ${monthName(s.month)}`, s.income]
    : expected > 0 ? ["Expected income", expected] : [`Income in ${monthName(shiftMonth(s.month, -1))}`, last?.income ?? 0];
  const left = income - p.limit;
  return `<div class="card"><h2>Budgets and income</h2><div style="margin-top:8px">
    <div class="kv"><span>${name}</span><b class="num">${money(income)}</b></div>
    <div class="kv"><span>Budgeted</span><b class="num">${money(p.limit)}</b></div>
    <div class="kv total"><span>${left >= 0 ? "Left to budget" : "Budgeted past income"}</span><b class="num">${money(Math.abs(left))}</b></div></div></div>`;
}
const GROUPS = [["depository", "Cash"], ["investment", "Investments"], ["credit", "Credit cards"], ["loan", "Loans"]];
function comingUpCard(bills) {
  const list = bills.slice().sort(byNextDue).slice(0, 6);
  const perMonth = bills.reduce((t, r) => t + r.monthly, 0);
  return `<div class="card c-coming"><h2>Coming up <a href="#/bills">All bills</a></h2>
    ${list.length ? `<div class="sub">${plural(bills.length, "bill")}, <b class="num">${money(perMonth)}</b> a month</div>${list.map((r) => billRow(r, false, true)).join("")}` : `<div class="empty" style="margin-top:8px">No repeating bills found yet.</div>`}</div>`;
}

// ---------- overview ----------
const PAGES = {};
PAGES.overview = async (q) => {
  const month = q.get("month") ?? "", g = GEN;
  const s = await api(`/api/summary${month ? `?month=${month}` : ""}`);
  if (stale(g)) return;
  const m = monthName(s.month), pm = monthName(shiftMonth(s.month, -1));
  $hero.innerHTML = budgetHero(s, "overview");

  const net = s.income - s.spent, mx = Math.max(s.income, s.spent, 1);
  const cash = `<div class="card c-cash"><h2>Cash flow</h2>
    <div class="sub"><b class="num">${money(Math.abs(net))}</b> more ${net < 0 ? "out than in" : "in than out"}${s.current ? " so far" : ""}</div>
    <div class="cfr">${[["Earned", s.income, "#00CDA9"], ["Spent", s.spent, "#F877A5"]].map(([k, v, c]) => `<div class="lab"><span>${k}</span><b class="num">${money(v)}</b></div><div class="t"><i style="width:${(v / mx) * 100}%;background:${c}"></i></div>`).join("")}</div>
    <div class="note">${s.current ? `Last month by this day you'd spent <b class="num">${money(s.spentLastMonthSoFar)}</b>.` : `${pm} came to <b class="num">${money(s.spentLastMonth)}</b> in all.`}</div></div>`;

  // Summary cards on Home show whole dollars; the Activity list keeps cents.
  const sl = slices(s.categories), total = s.categories.reduce((t, c) => t + c.spent, 0);
  // The ring can only draw money out. A category with net refunds is a signed row under the legend, and the ring's
  // center shows what the ring draws.
  const refunds = s.categories.filter((c) => c.spent < 0), drawn = sl.reduce((t, c) => t + c.spent, 0);
  const dollars = dollarsByCat(s.categories), whole = sl.map((c) => sliceDollars(c, dollars));
  const refundRows = refunds.map((c) => `<a href="${txLink({ cat: c.cat, month: s.month })}"><span class="sw" style="background:${catColor(c.cat)}"></span><span class="l">${esc(label(c.cat))} refunds</span><b class="num">${signed(dollars.get(c.cat))}</b></a>`).join("");
  const where = `<div class="card c-where"><h2>Where it went <a class="hlink" href="#/spending${s.current ? "" : `?month=${s.month}`}">All categories</a></h2>
    ${s.categories.length ? `<div class="sub">You've spent <b class="num">${money(total)}</b> ${s.current ? "so far this month" : `in ${m}`}</div>
    <div class="dl"><div class="ring" style="width:124px;height:124px">${donut(s.categories, 124, 18, s.month)}<div class="c">${drawn - total >= 0.5 ? "<small>Before refunds</small>" : ""}<b class="num">${money(drawn)}</b></div></div>
      <div class="vleg">${sl.map((c, i) => `<a href="${sliceLink(c, s.month)}"><span class="sw" style="background:${c.color}"></span><span class="l">${esc(c.label)}</span><b class="num">${money(whole[i])}</b></a>`).join("")}${refundRows}</div></div>
    <div class="stackbar" role="img" aria-label="${esc(sl.map((c) => `${c.label} ${money(c.spent)}`).join(", "))}">${stackSegs(sl, total)}</div>
    <div class="top3">${sl.slice(0, 3).map((c, i) => `<a href="${sliceLink(c, s.month)}"><span class="sw" style="background:${c.color}"></span><span class="l">${esc(c.label)}</span><b class="num">${money(whole[i])}</b></a>`).join("")}${refundRows}
      <a class="more" href="#/spending${s.current ? "" : `?month=${s.month}`}">All categories</a></div>`
      : `<div class="empty" style="margin-top:8px">No spending in ${m} yet.</div>`}</div>`;

  const over = s.budgets.filter((b) => b.spent > b.budget).sort((a, b) => used(b) - used(a));
  const ok = s.budgets.filter((b) => b.spent <= b.budget);
  // "Within budget" is all the code knows: spent is at or under the limit. It doesn't judge pace.
  const budgetsCard = `<div class="card span2 c-budgets"><h2>Budgets <a href="#/budgets${s.current ? "" : `?month=${s.month}`}">All budgets</a></h2>
    ${s.budgets.length ? `<div class="sub">${over.length ? `<b class="over">${over.length} over</b>, ${ok.length} within budget` : `All ${ok.length} within budget`}</div>
      ${over.length ? `<div class="need">${over.map((b) => `<a class="brow" href="${txLink({ cat: b.category, month: s.month })}"><div class="l1"><span class="name">${esc(b.label)}</span><span class="num over"><b>${overBy(b, dollars)}</b> over</span></div>
        <div class="bar over"><i style="width:100%"></i></div><div class="l2"><span class="num"><b>${money(dollars.get(b.category) ?? b.spent)}</b> of ${money(b.budget)}</span></div></a>`).join("")}</div>`
        // With nothing over, the card shows the budgets closest to their limits, so it still says how the month goes:
        // four fill the desktop's two columns, and a phone hides the fourth.
        : `<div class="need top">${ok.slice().sort((a, b) => used(b) - used(a)).slice(0, 4).map((b) => `<a class="brow" href="${txLink({ cat: b.category, month: s.month })}"><div class="l1"><span class="name">${esc(b.label)}</span><span class="num"><b>${leftBy(b, dollars)}</b> left</span></div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, used(b) * 100))}%"></i>${s.current ? `<span class="today" style="left:${(s.day / s.days) * 100}%"></span>` : ""}</div><div class="l2"><span class="num"><b>${money(dollars.get(b.category) ?? b.spent)}</b> of ${money(b.budget)}</span></div></a>`).join("")}</div>`}
      `
      : `<div class="empty" style="margin-top:8px">No budgets yet.</div>`}</div>`;

  const activity = `<div class="card span2 c-activity"><h2>Recent activity <a href="#/transactions${s.current ? "" : `?month=${s.month}`}">All activity</a></h2>
    <div style="margin-top:8px">${s.recent.map(activityRow).join("") || `<div class="empty">Nothing yet.</div>`}</div></div>`;

  // The markup is in the phone's reading order; the desktop grid places the same cards by area.
  $page.innerHTML = `<div class="home">${budgetsCard}${where}${activity}${comingUpCard(s.bills)}${netWorthCard(s.netWorth, s.netWorthHistory)}${cash}</div>`;
  wireMonthMenu(); wireTips($page); wireFill(s, () => PAGES.overview(q));
};

// ---------- transactions ----------
PAGES.transactions = async (q) => {
  const months = Array.from({ length: 24 }, (_, i) => shiftMonth(thisMonth(), -i));
  const cats = Object.keys(META.labels).sort((a, b) => label(a).localeCompare(label(b)));
  const KEYS = [["fq", "q"], ["fmonth", "month"], ["fcat", "cat"], ["facct", "account"]];
  // The first page of results is fetched before anything is drawn, like the other pages, so the page never shows an
  // empty table while data arrives.
  const g0 = GEN, first = new URLSearchParams();
  for (const [, key] of KEYS) if (q.get(key)) first.set(key, q.get(key));
  first.set("limit", "100");
  let initial;
  try { initial = await api(`/api/transactions?${first}`); } catch (e) { initial = { error: e }; }
  if (stale(g0)) return;
  // No all-time count in the band: the list is what this page is for. A net sum shows under the search row only
  // when a filter or search is set, inside the band's bottom padding so the list doesn't move. (Fable, round 3.)
  $hero.innerHTML = `<div class="k">Activity</div>
    <div class="filters">
      <input type="search" id="fq" placeholder="Search names or amounts" aria-label="Search transactions by name, amount, or category" value="${esc(q.get("q") ?? "")}">
      <button class="ftoggle" id="ftoggle" aria-expanded="false" aria-controls="fsel">Filters<span id="fcount" class="fcount off"></span></button>
      <div class="fsel" id="fsel"><select id="fmonth" aria-label="Month"><option value="">All months</option>${months.map((m) => `<option value="${m}">${monthYear(m)}</option>`).join("")}</select>
      <select id="fcat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${c}">${esc(label(c))}</option>`).join("")}</select>
      <select id="facct" aria-label="Account"><option value="">All accounts</option>${META.accounts.filter((a) => a.type !== "investment").map((a) => `<option value="${a.account_id}">${esc(short(a.name))}${a.mask ? ` ${esc(a.mask)}` : ""}</option>`).join("")}</select></div>
    </div><p class="fsum" id="sum"></p>`;
  $page.innerHTML = `<div class="card" tabindex="-1"><table class="tx"><colgroup><col class="c-name"><col class="c-cat"><col class="c-acct"><col class="c-amt"></colgroup>
    <thead><tr><th>Name</th><th class="cat-col">Category</th><th class="acct-col">Account</th><th class="amt">Amount</th></tr></thead><tbody id="rows"></tbody></table>
    <div id="more"></div></div>`;
  for (const [id, key] of KEYS.slice(1)) document.getElementById(id).value = q.get(key) ?? "";
  const $rows = document.getElementById("rows"), $more = document.getElementById("more"), $card = $rows.closest(".card");
  let offset = 0, seq = 0, lastDay = null;
  const fsel = document.getElementById("fsel"), ftoggle = document.getElementById("ftoggle");
  // On a phone the three selects fold behind one Filters button that counts what's set. The count's space is always
  // kept, so setting the first filter doesn't narrow the search field.
  const markFilters = () => {
    const n = ["fmonth", "fcat", "facct"].filter((id) => document.getElementById(id).value).length, c = document.getElementById("fcount");
    c.classList.toggle("off", !n); c.textContent = n || "";
  };
  ftoggle.onclick = () => { const open = !fsel.classList.contains("open"); fsel.classList.toggle("open", open); ftoggle.setAttribute("aria-expanded", String(open)); };
  if (["month", "cat", "account"].some((k) => q.get(k))) { fsel.classList.add("open"); ftoggle.setAttribute("aria-expanded", "true"); }
  const params = () => {
    const p = new URLSearchParams();
    for (const [id, key] of KEYS) { const v = document.getElementById(id).value.trim(); if (v) p.set(key, v); }
    return p;
  };
  const rowHtml = (t) => `${t.date !== lastDay ? `<tr class="day"><th colspan="4" scope="rowgroup">${dayName((lastDay = t.date))}</th></tr>` : ""}<tr class="${t.pending ? "pending" : ""}" data-id="${esc(t.transaction_id)}">
      <td><div class="nm"><span title="${esc(nice(t.who))}">${esc(nice(t.who))}</span>${t.pending ? '<span class="tag">pending</span>' : ""}</div><div class="who-sub">${catBtn(t)}</div></td>
      <td class="cat-col">${catBtn(t)}</td>
      <td class="acct-col muted"><span class="clip">${esc(short(t.account_name))}</span></td>
      <td class="amt">${amt(t.amount)}<small class="acct-sub">${esc(short(t.account_name))}</small></td></tr>`;
  // A message row (no results, an error) is a plain block, not the phone's two-line transaction grid.
  const msgRow = (html) => `<tr class="msg"><td colspan="4" class="empty">${html}</td></tr>`;
  // Draw a result set. "Show more" is one button updated in place, so keyboard focus stays on it.
  function paint(r, append) {
    if (!append) { lastDay = null; offset = 0; }
    const html = r.rows.map(rowHtml).join("");
    if (append) $rows.insertAdjacentHTML("beforeend", html);
    else $rows.innerHTML = html || msgRow(`No transactions match.<br><button class="more" id="clear">Clear the filters</button>`);
    document.getElementById("clear")?.addEventListener("click", () => go("transactions"));
    offset += r.rows.length;
    // The net figure only means something for a filtered set, so it shows only then.
    document.getElementById("sum").innerHTML = [...params()].length ? `<b class="num">${money(Math.abs(r.sum), true)}</b> ${r.sum >= 0 ? "out" : "in"}, net <span>· ${plural(r.total, "transaction")}</span>` : "";
    markFilters();
    let btn = document.getElementById("loadmore");
    if (offset < r.total) {
      if (!btn) { $more.innerHTML = `<button class="more" id="loadmore"></button>`; btn = document.getElementById("loadmore"); btn.addEventListener("click", () => { if (btn.getAttribute("aria-disabled") === "true") return; btn.setAttribute("aria-disabled", "true"); load(true); }); }
      // aria-disabled, not disabled: a disabled button drops keyboard focus.
      btn.textContent = `Show ${Math.min(100, r.total - offset)} more`; btn.removeAttribute("aria-disabled");
    } else {
      const had = btn && document.activeElement === btn;
      $more.innerHTML = "";
      if (had) $card.focus();
    }
  }
  function fail(append) {
    // Old rows under new filters would look like results, so a failed load replaces them with the error.
    if (!append) { document.getElementById("sum").innerHTML = ""; $more.innerHTML = ""; markFilters(); $rows.innerHTML = msgRow(`Couldn't load transactions.<br><button class="more" id="retry">Try again</button>`); }
    else $more.innerHTML = `<span class="muted">Couldn't load more.</span> <button class="more" id="retry">Try again</button>`;
    document.getElementById("retry").onclick = () => load(append);
  }
  // keep: how many rows to fetch on a fresh load (a category change reloads everything already shown, in pages of
  // 100, so the list doesn't shrink back to 100 and drop the reader 2,000px up the page).
  async function load(append, keep = 100) {
    const mine = ++seq, g = GEN;
    $card.setAttribute("aria-busy", "true");
    const all = { rows: [], total: 0, sum: 0 };
    try {
      do {
        const p = params(); p.set("limit", "100"); p.set("offset", String((append ? offset : 0) + all.rows.length));
        const r = await api(`/api/transactions?${p}`);
        all.rows.push(...r.rows); all.total = r.total; all.sum = r.sum;
        if (!r.rows.length) break;
      } while (!append && all.rows.length < Math.min(keep, all.total));
    } catch {
      if (mine !== seq || stale(g)) return;
      $card.removeAttribute("aria-busy"); fail(append); return;
    }
    if (mine !== seq || stale(g)) return; // a newer filter, or another page, took over
    $card.removeAttribute("aria-busy");
    paint(all, append);
  }
  if (initial.error) fail(false); else paint(initial, false);
  const refilter = () => { history.replaceState(null, "", `#/transactions${[...params()].length ? "?" + params() : ""}`); load(false); };
  let t;
  const pageGen = GEN;
  document.getElementById("fq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { if (!stale(pageGen)) refilter(); }, 250); });
  for (const id of ["fmonth", "fcat", "facct"]) document.getElementById(id).addEventListener("change", refilter);
  $rows.addEventListener("click", (e) => {
    const b = e.target.closest(".catbtn");
    if (!b) return;
    openPicker(b, async () => {
      if (stale(pageGen)) return;
      // Reload what's shown, then put the edited row back where it was on screen.
      const id = b.dataset.id, top = b.closest("tr")?.getBoundingClientRect().top;
      await load(false, offset);
      const row = $rows.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (row && top != null) window.scrollBy(0, row.getBoundingClientRect().top - top);
    });
  });
};

const dayName = (d) => {
  const today = new Date().toLocaleDateString("en-CA"), y = new Date(Date.now() - 864e5).toLocaleDateString("en-CA");
  if (d === today) return "Today";
  if (d === y) return "Yesterday";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) });
};
const catBtn = (t) => `<button class="catbtn${t.overridden ? " set" : ""}" data-id="${esc(t.transaction_id)}" data-cat="${esc(t.cat)}" data-who="${esc(t.who)}" data-ov="${t.overridden ? 1 : 0}" data-rule="${t.ruled ? 1 : 0}" aria-label="Category: ${esc(label(t.cat))}. Change it"><span class="sw" style="background:${catColor(t.cat)}"></span><span class="cl">${esc(label(t.cat))}</span>${icon("down", 14, 2.4).replace("<svg", '<svg class="cv"')}</button>`;

// ---------- category picker ----------
let picker = null, pickerFor = null;
// After the picker closes, focus returns to its category button, or to the list if a filter removed that row.
const refocus = (id) => ([...document.querySelectorAll(`.catbtn[data-id="${CSS.escape(id ?? "")}"]`)].find((b) => b.getClientRects().length && b.offsetWidth)
  ?? document.getElementById("rows")?.closest(".card"))?.focus({ preventScroll: true });
function closePicker() { picker?.remove(); picker = null; document.removeEventListener("mousedown", outside); }
function outside(e) { if (picker && !picker.contains(e.target)) closePicker(); }
function openPicker(btn, done) {
  closePicker();
  const cats = Object.keys(META.labels).sort((a, b) => label(a).localeCompare(label(b)));
  picker = document.createElement("div");
  pickerFor = btn.dataset.id;
  picker.className = "picker";
  picker.setAttribute("role", "dialog");
  picker.setAttribute("aria-label", `Category for ${btn.dataset.who}`);
  picker.innerHTML = `<div class="opts">${cats.map((c) => `<button class="opt${c === btn.dataset.cat ? " on" : ""}" data-c="${c}"><span class="sw" style="background:${catColor(c)}"></span>${esc(label(c))}</button>`).join("")}
      ${btn.dataset.ov === "1" ? `<button class="opt muted" data-c="">Back to automatic</button>` : ""}
      ${btn.dataset.rule === "1" && btn.dataset.ov !== "1" ? `<button class="opt muted" data-c="" data-all="1">Back to automatic for every ${esc(btn.dataset.who)}</button>` : ""}</div>
    <label><input type="checkbox" id="pall"> Every ${esc(btn.dataset.who)} transaction</label>`;
  document.body.append(picker);
  const r = btn.getBoundingClientRect();
  picker.style.left = `${Math.max(8, Math.min(window.innerWidth - 258, r.left + scrollX))}px`;
  const h = picker.offsetHeight, roomBelow = window.innerHeight - r.bottom - (window.innerWidth <= 860 ? 76 : 8);
  picker.style.top = `${(roomBelow < h + 6 && r.top > h + 6 ? r.top - h - 6 : r.bottom + 6) + scrollY}px`;
  (picker.querySelector(".opt.on") ?? picker.querySelector(".opt")).focus();
  const mine = picker, g = GEN;
  picker.addEventListener("click", async (e) => {
    const o = e.target.closest(".opt");
    if (!o || mine.classList.contains("busy")) return;
    mine.classList.add("busy"); mine.setAttribute("aria-busy", "true");
    try {
      await api("/api/category", { transaction_id: btn.dataset.id, category: o.dataset.c || null, merchant: o.dataset.all === "1" || mine.querySelector("#pall").checked });
      if (stale(g)) return;
      if (picker === mine) closePicker();
      await done();
      if (!stale(g)) refocus(btn.dataset.id);
    } catch (err) { if (!stale(g)) { mine.classList.remove("busy"); mine.removeAttribute("aria-busy"); notice(err.message); } }
  });
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
}

// ---------- spending ----------
PAGES.spending = async (q) => {
  const month = q.get("month") ?? "";
  const g = GEN;
  const r = await api(`/api/spending${month ? `?month=${month}` : ""}`);
  if (stale(g)) return;
  const total = r.categories.reduce((s, c) => s + c.spent, 0), n = r.categories.reduce((s, c) => s + c.n, 0);
  const dollars = dollarsByCat(r.categories), drawn = slices(r.categories).reduce((t, c) => t + c.spent, 0);
  const prev = r.history.find((h) => h.month === shiftMonth(r.month, -1));
  $hero.innerHTML = `${monthMenu(r.month, r.history, "spending", "spending")}
    <div class="big num">${money(total)}</div>
    <p>${n ? `${plural(n, "transaction")} in ${plural(r.categories.length, "category", "categories")}.` : "No spending yet."}${prev?.hasData ? ` ${monthName(prev.month)} came to <b class="num">${money(prev.spent)}</b>.` : ""}</p>`;
  // Main column: the ring and the category table. Side column: each month with data as a row with a bar on one
  // zero-based scale, newest first, the open month dark and bold. (Fable, round 6.)
  const months = r.history.filter((h) => h.hasData).reverse(), top = Math.max(1, ...months.map((h) => h.spent));
  const monthRows = months.map((h) => `<a class="mrow${h.month === r.month ? " on" : ""}" data-m="${h.month}" href="#/spending${h.month === thisMonth() ? "" : `?month=${h.month}`}"${h.month === r.month ? ' aria-current="true"' : ""}>
      <span class="ml">${monthName(h.month, "short")}${h.month.slice(0, 4) !== thisMonth().slice(0, 4) ? ` ${h.month.slice(2, 4)}` : ""}${h.month === thisMonth() ? " so far" : ""}</span>
      <span class="mb"><i style="width:${Math.max(0, h.spent) / top * 100}%"></i></span><span class="mv num">${money(h.spent)}</span></a>`).join("");
  $page.innerHTML = `<div class="layout"><div class="stack">
    <div class="card"><h2>Where it went</h2>
      ${r.categories.length ? `<div class="spend"><div class="ring" style="width:220px;height:220px">${donut(r.categories, 220, 26, r.month)}<div class="c">${drawn - total >= 0.5 ? "Before refunds" : "Spent"}<b class="num">${money(drawn)}</b></div></div>
        <table class="rank">${r.categories.map((c) => `<tr><td><span class="sw" style="background:${catColor(c.cat)}"></span><a href="${txLink({ cat: c.cat, month: r.month })}">${esc(label(c.cat))}</a></td><td class="n">${plural(c.n, "transaction")}</td><td class="v num">${signed(dollars.get(c.cat))}</td></tr>`).join("")}</table></div>`
        : `<div class="empty" style="margin-top:8px">No spending in ${monthName(r.month)}. <a class="more" href="#/spending">Back to this month</a></div>`}</div>
    </div><aside class="side stack"><div class="card"><h2>By month</h2><div class="months" id="months">${monthRows}</div></div></aside></div>`;
  if (keepRow) {
    const row = document.querySelector(`.mrow[data-m="${keepRow.month}"]`);
    if (row) { window.scrollBy(0, row.getBoundingClientRect().top - keepRow.top); row.focus({ preventScroll: true }); }
    keepRow = null;
  }
  // Only a click that opens a different month redraws; the open month's own link changes nothing.
  for (const a of document.querySelectorAll(".mrow")) a.addEventListener("click", () => { if (a.dataset.m !== r.month) keepRow = { month: a.dataset.m, top: a.getBoundingClientRect().top }; });
  wireMonthMenu(); wireTips($page);
};
let keepRow = null;

// ---------- budgets ----------
let budgetRev = 0, budgetOrder = null;
const budgetData = (month) => Promise.all([api(`/api/summary${month ? `?month=${month}` : ""}`), api("/api/recurring")]);
PAGES.budgets = async (q, saved, pre) => {
  const month = q.get("month") ?? "", g = GEN;
  const [s, streams] = pre ?? await budgetData(month);
  if (stale(g)) return;
  $hero.innerHTML = budgetHero(s, "budgets");
  const dollars = dollarsByCat(s.categories);
  const tick = s.current ? `<span class="today" style="left:${(s.day / s.days) * 100}%"></span>` : "";
  const field = (b, value, ph) => `<label class="amtin${b.category === saved ? " saved" : ""}"><span class="ok" role="status">${b.category === saved ? "Saved" : ""}</span><span class="fld"><span class="cur">$</span><input inputmode="decimal" data-cat="${b.category}" value="${value != null ? value.toLocaleString("en-US") : ""}" placeholder="${ph ? Math.round(ph) : ""}" aria-label="${esc(b.label)} monthly budget"></span></label>`;
  // Most used first on a fresh visit. A redraw after a save keeps that order, so the row just edited stays put.
  const set = s.budgets.slice().sort((a, b) => used(b) - used(a));
  if (saved && budgetOrder) { const at = (c) => { const i = budgetOrder.indexOf(c); return i < 0 ? Infinity : i; }; set.sort((a, b) => at(a.category) - at(b.category)); }
  budgetOrder = set.map((b) => b.category);
  const unset = s.unset.slice().sort((a, b) => b.spent - a.spent || (b.suggested ?? 0) - (a.suggested ?? 0));
  $page.innerHTML = `<div class="layout"><div class="stack">
    <div class="card"><h2>Budgets</h2>
      ${set.length ? set.map((b) => {
        const over = b.spent > b.budget;
        return `<div class="erow"><div class="brow"><div class="l1"><span class="name">${esc(b.label)}</span><span class="num ${over ? "over" : ""}"><b>${over ? overBy(b, dollars) : leftBy(b, dollars)}</b> ${over ? "over" : "left"}</span></div>
          <div class="bar ${over ? "over" : ""}"><i style="width:${Math.max(0, Math.min(100, used(b) * 100))}%"></i>${over ? "" : tick}</div>
          <div class="l2"><span class="num"><b>${money(dollars.get(b.category) ?? b.spent)}</b> spent</span>${field(b, b.budget)}</div></div></div>`;
      }).join("") : `<div class="empty" style="margin-top:8px">No budgets yet. Set one below, or fill them all from your last 3 months.${s.unset.some((b) => b.suggested) ? ` <button class="more" data-fill>Fill them in</button>` : ""}</div>`}
    </div>
    ${unset.length ? `<div class="card"><h2>Not budgeted</h2>
      ${unset.map((b) => `<div class="erow"><div><div class="name" style="font-weight:600">${esc(b.label)}</div><div class="muted num" style="font-size:14px">${notBudgetedLine(b, dollars.get(b.category) ?? Math.round(b.spent))}</div></div>${field(b, null, suggest(b))}</div>`).join("")}</div>` : ""}
    </div><aside class="side stack">${incomeCard(s, streams)}</aside></div>`;
  for (const inp of $page.querySelectorAll(".amtin input")) {
    const box = inp.closest(".amtin"), status = box.querySelector(".ok");
    const save = async () => {
      const rev = ++budgetRev;
      const v = inp.value.replace(/[$,\s]/g, "");
      if (v === inp.defaultValue.replace(/,/g, "")) return;
      if (v !== "" && !(Number(v) >= 0)) { const typed = inp.value; inp.value = inp.defaultValue; return notice(`"${typed}" isn't an amount. Type a number like 120, or clear the field to remove the budget.`); }
      const g = GEN;
      box.classList.remove("bad", "saved"); box.classList.add("saving"); status.textContent = "Saving";
      try { await api("/api/budget", { category: inp.dataset.cat, monthly: v === "" ? null : Number(v) }); }
      catch { if (!stale(g)) { box.classList.replace("saving", "bad"); status.textContent = "Couldn't save"; } return; }
      // Fetch the new totals first, then snapshot whatever field the owner moved on to and redraw with no wait in
      // between, so nothing typed during the requests is lost. Skip the redraw if they've left the page.
      const pre = await budgetData(month).catch(() => null);
      if (stale(g) || rev !== budgetRev) return; // another page, or a newer save that will redraw
      if (!pre) { box.classList.replace("saving", "saved"); status.textContent = "Saved"; return; }
      const act = document.activeElement?.matches?.(".amtin input") ? document.activeElement : null;
      const keep = act && { cat: act.dataset.cat, value: act.value, from: act.selectionStart, to: act.selectionEnd };
      await PAGES.budgets(q, inp.dataset.cat, pre);
      if (keep) {
        const el = $page.querySelector(`.amtin input[data-cat="${keep.cat}"]`);
        if (el) { el.value = keep.value; el.focus(); el.setSelectionRange(keep.from, keep.to); }
      }
    };
    inp.addEventListener("change", save);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  }
  wireMonthMenu(); wireFill(s, () => PAGES.budgets(q));
};

// ---------- bills ----------
PAGES.bills = async () => {
  const g = GEN;
  const all = await api("/api/recurring");
  if (stale(g)) return;
  const bills = all.filter((r) => r.direction === "outflow" && r.is_active && !r.is_transfer).sort(byNextDue);
  const income = all.filter((r) => r.direction === "inflow" && r.is_active && !r.is_transfer);
  const ended = all.filter((r) => r.direction === "outflow" && !r.is_active && !r.is_transfer);
  const perMonth = bills.reduce((s, r) => s + r.monthly, 0);
  const next = bills.find((r) => r.predicted_next_date);
  // Bills under a subhead per month with its total: what still leaves this month, then next month. (Fable, round 3.)
  const STEP = { WEEKLY: 7, BIWEEKLY: 14, SEMI_MONTHLY: 15 }, MAX = { SEMI_MONTHLY: 2 };
  // A predicted date already past is a late charge that still counts this month.
  const dueMonth = (r) => { const m = (r.predicted_next_date ?? "").slice(0, 7); return !m ? "later" : m < thisMonth() ? thisMonth() : m; };
  const restOfMonth = (r) => {
    let n = 0, d = new Date(r.predicted_next_date + "T12:00:00");
    if (d.toLocaleDateString("en-CA").slice(0, 7) < thisMonth()) return Math.abs(r.average_amount);
    while (d.toLocaleDateString("en-CA").slice(0, 7) === thisMonth() && n < (MAX[r.frequency] ?? 6)) { n++; if (!STEP[r.frequency]) break; d = new Date(d.getTime() + STEP[r.frequency] * 864e5); }
    return n * Math.abs(r.average_amount);
  };
  const groups = [];
  for (const r of bills) {
    const m = dueMonth(r);
    (groups.at(-1)?.[0] === m ? groups.at(-1)[1] : (groups.push([m, []]), groups.at(-1)[1])).push(r);
  }
  $hero.innerHTML = `<div class="k">Bills and subscriptions</div>
    <div class="big num">${money(perMonth)} <span>a month</span></div>
    <p>${next ? `Next up: ${esc(nice(next.who))}, <b class="num">${money(Math.abs(next.average_amount))}</b> on ${shortDate(next.predicted_next_date)}.` : "Plaid hasn't found any repeating charges yet."}</p>`;
  const incomeRow = (r) => `<div class="row"><span class="w"><b>${esc(nice(r.who))}</b><small>${FREQ[r.frequency] ?? esc(r.frequency)}${r.last_date ? `, last ${shortDate(r.last_date)}` : ""}</small></span><span class="amt num in">+${money(Math.abs(r.average_amount), true)}<small>average</small></span></div>`;
  $page.innerHTML = `<div class="layout"><div class="stack">
      <div class="card"><h2>Expected charges</h2>${groups.map(([m, list]) => `<div class="mgrp"><div class="mh"><span>${m === "later" ? "No date yet" : m === thisMonth() ? `Rest of ${monthName(m)}` : `Next in ${monthYear(m).replace(` ${new Date().getFullYear()}`, "")}`}</span>${m === thisMonth() ? `<span class="num">${money(list.reduce((t, r) => t + restOfMonth(r), 0))}</span>` : ""}</div>
        ${list.map((r) => billRow(r, true, true)).join("")}</div>`).join("") || `<div class="empty">None found yet.</div>`}</div>
      ${ended.length ? `<div class="card"><h2>Stopped charging</h2><div style="margin-top:8px">${ended.map((r) => billRow(r)).join("")}</div></div>` : ""}
    </div><aside class="side stack"><div class="card"><h2>Money coming in</h2><div style="margin-top:8px">${income.map(incomeRow).join("") || `<div class="empty">None found yet.</div>`}</div></div></aside></div>`;
};

// ---------- accounts and connections ----------
PAGES.accounts = async () => {
  const g = GEN;
  const [s, sum, set] = await Promise.all([api("/api/status"), api("/api/summary"), api("/api/settings")]);
  if (stale(g)) return;
  const nw = sum.netWorth;
  const accounts = s.items.flatMap((it) => it.accounts.map((a) => ({ ...a, inst: it.institution_name })));
  $hero.innerHTML = `<div class="k">Net worth</div><div class="big num">${money(nw.total)}</div>
    <p><b class="num">${money(nw.cash)}</b> cash, <b class="num">${money(nw.investments)}</b> invested, <b class="num">${money(nw.owed)}</b> owed on cards.</p>`;
  // One full-width card per account type in the main column, connections in the side column, like the other pages.
  // What's owed is a negative balance, formatted once as a signed number.
  const groupCard = ([t, name]) => {
    const owes = t === "credit" || t === "loan", sign = (n) => owes ? -n : n;
    const list = accounts.filter((a) => a.type === t), total = list.filter((a) => !a.closed_at).reduce((x, a) => x + (a.current ?? 0), 0);
    return `<div class="card"><h2>${name} <span class="aside num tot">${signed(sign(total))}</span></h2><div style="margin-top:8px">
      ${list.map((a) => `<div class="row${a.closed_at ? " closed" : ""}"><span class="w"><b>${esc(short(a.name))}${a.closed_at ? '<span class="tag">closed</span>' : ""}</b><small>${esc(a.inst)}${a.mask ? `, ending ${esc(a.mask)}` : ""}${a.closed_at ? `, closed ${shortDate(a.closed_at.slice(0, 10))}` : t === "credit" && a.credit_limit ? `, ${money(a.credit_limit)} limit` : ""}</small></span><span class="amt num">${a.closed_at ? "" : signed(sign(a.current ?? 0), true)}</span></div>`).join("")}</div></div>`;
  };
  const groups = GROUPS.filter(([t]) => accounts.some((a) => a.type === t)).map(groupCard).join("");
  // When every connection synced cleanly in the same minute, the time is said once at the top.
  const when = (iso) => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
  const together = s.items.length > 1 && s.items.every((it) => !it.last_error && it.last_sync && when(it.last_sync) === when(s.items[0].last_sync));
  $page.innerHTML = `<div id="msg"></div>
    ${!s.keys ? `<div class="notice bad">No Plaid keys. Put PLAID_CLIENT_ID and PLAID_SECRET in ${esc(s.keysPath)}.</div>` : ""}
    <div class="layout"><div class="stack">${groups}</div>
    <aside class="side stack"><div class="card"><h2>Connections <span class="aside">${s.used} of ${s.cap} used</span></h2>${together ? `<div class="sub">All synced ${esc(when(s.items[0].last_sync))}</div>` : ""}<div style="margin-top:8px">${s.items.map((it) => {
      const broken = /ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|PENDING_DISCONNECT/.test(it.last_error ?? "");
      // Two lines per connection: the name with its Sync button, then status and what it holds.
      const what = it.tx.n || !it.holdings.n ? plural(it.tx.n, "transaction") : plural(it.holdings.n, "holding");
      return `<div class="conn"><div class="top"><b>${esc(it.institution_name)}</b><button class="more" data-sync="${esc(it.item_id)}" aria-label="Sync ${esc(it.institution_name)} now">Sync</button></div>
        <div class="state ${it.last_error ? "bad" : ""}">${it.last_error ? (broken ? "Sign in again" : "Sync failed") : together ? what : `Synced ${esc(when(it.last_sync))} · ${what}`}</div>
        ${it.last_error ? `<div class="err">${esc(it.last_error)}</div>` : ""}
        ${broken ? `<div class="actions"><button class="btn primary" data-fix="${esc(it.item_id)}">Fix connection</button></div>` : ""}</div>`;
    }).join("") || `<div class="empty">Nothing linked yet.</div>`}</div>
      <div class="actions" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px">
        <button class="btn primary" id="bank" ${!s.keys || s.used >= s.cap ? "disabled" : ""}>Link a bank or card</button>
        <button class="btn" id="brokerage" ${!s.keys || s.used >= s.cap ? "disabled" : ""}>Link a brokerage</button></div>
      <div class="hint" style="margin-top:8px">Each link uses one of ${s.cap} slots for good. Fix a broken one instead of linking it again.</div></div>
    ${settingsCard(set)}</aside></div>`;
  const msg = (t, bad) => { document.getElementById("msg").innerHTML = t ? `<div class="notice ${bad ? "bad" : ""}">${esc(t)}</div>` : ""; };
  for (const b of document.querySelectorAll("[data-sync]")) b.onclick = async () => {
    b.disabled = true; msg("Syncing…");
    const g = GEN;
    try { const { results } = await api("/api/sync", { item_id: b.dataset.sync }); if (stale(g)) return; const e = results.flatMap((r) => r.errors); await PAGES.accounts(); if (e.length) msg(e.join("\n"), true); }
    catch (e) { if (!stale(g)) { msg(e.message, true); b.disabled = false; } }
  };
  for (const b of document.querySelectorAll("[data-fix]")) b.onclick = () => link({ itemId: b.dataset.fix }, msg);
  document.getElementById("bank").onclick = () => link({ kind: "bank" }, msg);
  document.getElementById("brokerage").onclick = () => link({ kind: "brokerage" }, msg);
  wireSettings();
};

// Settings save as they change. Sync on open is for a computer that isn't on every morning for the daily job.
const SYNC_CHOICES = [["1", "If older than 1 hour"], ["6", "If older than 6 hours"], ["12", "If older than 12 hours"], ["24", "If older than a day"], ["off", "Never"]];
const settingsCard = (set) => `<div class="card sets"><h2>Settings</h2>
  <div class="setrow stacked"><label for="autosync">Sync when you open tally</label>
    <select id="autosync" data-key="autoSync">${SYNC_CHOICES.map(([v, t]) => `<option value="${v}"${v === set.autoSync ? " selected" : ""}>${t}</option>`).join("")}</select></div>
  <div class="setrow"><label for="bigcharge">Alert for one charge of</label>
    <span class="amtin"><span class="fld"><span class="cur">$</span><input id="bigcharge" data-key="bigCharge" inputmode="numeric" value="${esc(set.bigCharge)}"></span></span></div>
  <div class="hint">${set.discord ? "Alerts post to Discord with the daily sync." : "Alerts post to Discord once ~/.config/tally/discord.env has a webhook."}</div>
  <div class="ok hint" id="setok" role="status"></div></div>`;
function wireSettings() {
  const ok = document.getElementById("setok");
  for (const el of document.querySelectorAll(".sets [data-key]")) el.addEventListener("change", async () => {
    const v = el.value.replace(/[$,\s]/g, "");
    try { const set = await api("/api/settings", { [el.dataset.key]: v }); el.value = set[el.dataset.key]; ok.textContent = "Saved"; ok.classList.remove("bad"); }
    catch { ok.textContent = el.dataset.key === "bigCharge" ? "Use a whole dollar amount, like 200." : "Couldn't save that."; ok.classList.add("bad"); }
  });
}

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

// tally may run on a laptop that was asleep for the daily sync. On open, and when the tab comes back, the server says
// whether a sync is due (the Sync on open setting) and runs it. The page redraws unless the owner is typing.
async function syncIfDue() {
  const b = document.getElementById("syncall");
  if (b.disabled) return;
  const spin = setTimeout(() => { b.disabled = true; b.classList.add("spin"); }, 400);
  try {
    const r = await api("/api/sync-if-due", {});
    if (r.synced && !document.activeElement?.matches("input, select, textarea") && !picker) await render();
  } catch { /* the Sync button still works, and Accounts shows what failed */ }
  clearTimeout(spin); b.disabled = false; b.classList.remove("spin");
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncIfDue(); });

window.addEventListener("hashchange", render);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (picker) { const id = pickerFor; closePicker(); refocus(id); } if (menuOpen) { const b = menuOpen.querySelector("button"); closeMenu(); b.focus(); } } });
render().then(syncIfDue);
