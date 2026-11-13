# tally

A Mint-style money app you run yourself. Plaid links your bank, card, and brokerage accounts, and the data lives in
SQLite at `data/tally.db` on your machine. Pages: Home, Activity, Spending, Budgets, Bills, Accounts.
The install guide is https://tally.jesselind.com. Its source is `site/`, published with `site/publish.sh`; its screenshots are crops of tally running on made-up data (`site/tools/shoot.mjs`, with the list in `site/tools/shots.json`). A gitignored `CLAUDE.local.md` holds rules for one person's setup.

## Rules

- Plaid's free Trial plan allows 10 Items for life. Removing an Item does not free its slot. A broken
  connection is fixed with update mode (a link token made from the existing access token), never by
  linking the institution again. Never call `/item/remove` without the owner's OK.
- `days_requested` is fixed when an Item is created. Link tokens for new Items ask for 730 days.
- Keys live in `~/.config/tally/plaid.env` (mode 600), outside the repo. Never print `PLAID_SECRET` or an
  access token, in logs, the page, or chat. `/api/status` must never return an access token; a test checks it.
- `data/` holds real account data and access tokens. It is gitignored. Never commit it or copy it off the machine.
- The server listens on 127.0.0.1 only. To reach it from other devices, `tailscale serve` (tailnet only) proxies to
  it, and `TALLY_HOSTS` names that host. Any other Host and any cross-origin POST is refused. Never expose tally to
  the public internet (no Tailscale Funnel, no port forward): it has no login.
- This repo is public. Real names, banks, amounts, hostnames, and home paths stay out of code, tests, comments,
  and commit messages. Tests and screenshots use made-up data.
- Tests run against a fake Plaid server (`npm test`). They never use real keys.
- Node built-ins only (`node:sqlite`, `node:http`, `fetch`). Add a dependency only with a reason.

## Money rules

All of them live in `lib/report.mjs`, tested in `test/report.test.mjs`. Plaid's sign: positive is money out.

- Category order: a single-transaction override, then a merchant rule, then Plaid's category. Plaid's
  transfers and card payments become `TRANSFER`; gas and groceries get their own categories.
- Spending is depository and credit accounts only, minus `TRANSFER` and `INCOME`. Refunds lower it.
  Income is `INCOME` on depository accounts.
- A recurring stream is a transfer, not a bill, when its name says payment, pmt, transfer, xfer, or autopay.
  Plaid's category alone isn't trusted there (it has called a hosting bill a transfer).
- Plaid sends some merchant names as empty strings. Treat `''` as missing (`nullif`).
- Nothing dated after today counts yet: every month figure takes `upTo` (today), so "so far" numbers agree.
- An account Plaid's `/accounts/get` stops listing is closed (`closed_at`): kept for its transactions, left out of
  net worth and balances. It reopens if Plaid lists it again.
- A category set on a pending charge moves to the posted charge (`pending_transaction_id`).
- `/transactions/sync` pages are collected first and written in one transaction; the cursor moves only when every
  page is in. On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` the sync restarts from its first cursor (3 tries).
- Net worth history is the `balances` table: one row per account per day, written on every sync. A sync that
  fails keeps the account's last known balance, so the line doesn't dip. History starts 2026-11-12.
- `?month=YYYY-MM` on the summary, spending, and budgets endpoints shows that month whole. The current month
  runs through today, and "last month" is compared through the same day.

## Design

The look, picked 2026-11-12 from research into Mint's design: a teal band
across the top of every page holding the page's main number, white cards overlapping it on a mint tint, and
side cards on the right. Keep it light. Colors and sizes are the variables at the top of `public/app.css`.

- Mint `#00CDA9` marks progress and money in. Pink `#F877A5` marks spending and over budget, and over budget
  always says "over" in `#B4234D` text.
- Category colors follow the category, never its rank (`CAT_COLOR` in `public/app.js`). The seven hues passed
  the colorblind check as neighbors in that order; every other category is gray "Other". Don't add an eighth.
- Text on the teal band is solid white (4.5:1). Don't fade it with opacity.
- Dark mode (picked 2026-11-13, "Slate"): neutral charcoal page and cards under the same full-strength teal band. It
  follows the device; Appearance on the Settings page overrides it per browser (`localStorage` `tally-appearance`,
  applied by a script in `index.html` before the stylesheet paints). Every color is a variable at the top of
  `public/app.css`, and the dark values are in two blocks there that must match. New colors go in as variables with a
  dark value, never as a literal. The site (`site/style.css`) uses the same palette and swaps in `-dark` screenshots.

A design council (Muse, Opus, and Codex reviewing, Fable judging splits) polished this on 2026-11-12 over 8 rounds.
The rules it settled:

- Pages are Home, Activity, Spending, Budgets, Bills, Accounts, on desktop and phone.
- Money: hero numbers and summaries in whole dollars, single transactions and balances in cents. A month's category
  figures are rounded once together (`dollarsByCat`) and shared by every page, so rows add up and pages agree.
- Over budget is decided in cents, like the daily alert; under a dollar reads "<$1 over".
- Every page but Home uses main-plus-side. Home is one grid written in phone reading order.
- Judge's calls, kept unless the owner says otherwise: the budget field sits on the spent line; Activity's band has no
  all-time count; Bills groups by month; Spending's By month is a side list; links stay deep teal (from the research).


## Site

A design council (Opus and Codex reviewing, Muse for four rounds, Fable judging splits) reworked `site/` on
2026-11-13 over 9 rounds. What it settled:

- Screenshots are whole app cards cropped near their real size, never full pages shrunk down, and never faded at an
  edge. Each heading over a panel is one line holding the one fact the panel can't show, and the picture has to show
  what the heading claims (the Activity panel has the category picker open; Connections has a bank that needs a new
  sign-in). No panel appears twice on a page.
- The made-up data the crops assume: one category over budget (Groceries, $25 over) and every other spending category
  budgeted, so Home's two totals match. `shoot.mjs`'s header says how to set up the Connections error state.
- Each fact appears once per page. Copy that repeats a heading, a panel, or another section gets cut.
- Code on phones keeps its real line breaks and scrolls sideways with an edge fade; only long inline addresses wrap.
- Judge's calls, kept unless the owner says otherwise: the hero is the headline left with the description, one button
  ("Read the install guide"), and fine print right; no address bar over the hero shot, and the phone hero has no
  device frame; the four panels sit in two columns that stack on their own (Budgets and Connections, Bills and
  Activity), with Budgets left out on phones because the phone hero ends on that card; guide steps use plain teal
  numerals hung in the gutter with one left edge for every heading; the guide's only boxes are pink warnings;
  Backups comes right after Keep it running.

A second council on 2026-11-13 (4 rounds, Opus and Codex, Muse for one) measured the install guide against ten
published install guides (Obsidian, Homebrew, Ghost, Next.js, Tailwind, Resend, Sentry, GitBook, Immich, Actual
Budget). Its record and corrected benchmark are in `.council/site-ref/` (`STANDARDS.md`). What it settled:

- Step 2 has three parts: download, "Add your keys", and "Start and check it", each with an anchor. What a command
  prints goes in an `.output` block labeled "Expected output", on the page surface with no Copy button.
- Only code that isn't a terminal command gets a label (`data-label`): a file's path, or "Service environment".
  Terminal blocks stay unlabeled.
- Wherever Mac and Linux split, the platform comes first: an "On a Mac" / "On Linux" h3, or a bold lead-in.
- The outline has sub-entries for keys, start, and update, and tracks the current place by scroll position.
- Judge's calls: every guide h2 is 28px (24px on phones); desktop sub-headings 20px (18px on phones); Using tally
  terms and Troubleshooting answers 17px bold, and each Troubleshooting answer is a linkable `h3.q`; no card grids;
  phone step numerals stay inline; on phones a one-line command that overflows takes Copy in a row above, and the
  Copy row is a 32px button with a 44px tap area.

## Daily job

`bin/daily.mjs`, run at 7:00 by the agent `bin/install-mac.sh` installs: syncs everything through `POST /api/daily`,
writes `data/tally-snapshot.db` for backups, and posts new alerts (broken connection weekly, a charge at or over the alert amount
dated in the last 10 days, a budget gone over) to Discord when alerts are on in Settings. The webhook comes from
Settings, or `DISCORD_WEBHOOK_URL` in `~/.config/tally/discord.env` from before the setting. Long posts are split into several messages, and each message's alerts are marked
sent only after Discord accepts that message.

## Sync and settings

One full sync runs at a time (`syncAllOnce`). Besides the daily job and the Sync button, tally syncs when it starts and
when the page opens or its tab comes back, if any connection is older than the `autoSync` setting or last failed to
reach Plaid; automatic syncs run at most every 10 minutes. Settings live in the `settings` table, each with a default
and a check in `SETTINGS` in `server.mjs`, and show on the Settings page (`#/settings`, the gear in the top bar).
Discord alerts are opt-in (`alerts`, off unless an old `discord.env` exists). The webhook pasted there is stored in
`settings` and never returned by `GET /api/settings`; `POST /api/daily` hands it to `bin/daily.mjs` with the alerts.

## Gig payouts

`GET /api/payouts` gives weekly payouts per gig platform, by the week the work happened. It's empty unless
`~/.config/tally/payouts.mjs` (or `TALLY_PAYOUTS`) exists; `payouts()` in `lib/report.mjs` says what that file returns.
