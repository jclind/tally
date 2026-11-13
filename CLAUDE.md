# tally

A Mint-style money app for the owner. Plaid links their bank, card, and brokerage accounts, and the data lives in
SQLite at `data/tally.db` on the server. Pages: Overview, Transactions, Spending, Budgets, Bills, Accounts.

## Rules

- The owner, 2026-11-12: "unless it is something risky or very much needs my opinion, I will hand trust your judgement
  on fixing things." Fix bugs and review findings without asking, test them, and ship them. Ask first only for
  something risky (anything that could burn a Plaid slot, lose `data/`, touch keys, or change the tailnet setup) or a
  real product choice.
- Plaid's free Trial plan allows 10 Items for life. Removing an Item does not free its slot. A broken
  connection is fixed with update mode (a link token made from the existing access token), never by
  linking the institution again. Never call `/item/remove` without the owner's OK.
- `days_requested` is fixed when an Item is created. Link tokens for new Items ask for 730 days.
- Keys live in `~/.config/tally/plaid.env` (mode 600), outside the repo. Never print `PLAID_SECRET` or an
  access token, in logs, the page, or chat. `/api/status` must never return an access token; a test checks it.
- `data/` holds real account data and access tokens. It is gitignored. Never commit it, never copy it off the machine.
- The server listens on 127.0.0.1 only. `tailscale serve` on https port 8400 (tailnet only) proxies to it, and
  `TALLY_HOSTS` in the plist names that host. Any other Host and any cross-origin POST is refused.
  Never turn on Tailscale Funnel for tally: it has no login.
- Tests run against a fake Plaid server (`npm test`). They never use real keys.
- Node built-ins only (`node:sqlite`, `node:http`, `fetch`). Add a dependency only with a reason.

## Money rules

All of them live in `lib/report.mjs`, tested in `test/report.test.mjs`. Plaid's sign: positive is money out.

- Category order: a single-transaction override, then a merchant rule, then Plaid's category. Plaid's
  transfers and card payments become `TRANSFER`; gas and groceries get their own categories.
- Spending is depository and credit accounts only, minus `TRANSFER` and `INCOME`. Refunds lower it.
  Income is `INCOME` on depository accounts.
- A recurring stream is a transfer, not a bill, when its name says payment, pmt, transfer, xfer, or autopay.
  Plaid's category alone isn't trusted there (it calls Railway's hosting bill a transfer).
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

The owner picked the look on 2026-11-12, from the Mint research (round G on the design notes): a teal band
across the top of every page holding the page's main number, white cards overlapping it on a mint tint, and
side cards on the right. Keep it light. Colors and sizes are the variables at the top of `public/app.css`.

- Mint `#00CDA9` marks progress and money in. Pink `#F877A5` marks spending and over budget, and over budget
  always says "over" in `#B4234D` text.
- Category colors follow the category, never its rank (`CAT_COLOR` in `public/app.js`). The seven hues passed
  the colorblind check as neighbors in that order; every other category is gray "Other". Don't add an eighth.
- Text on the teal band is solid white (4.5:1). Don't fade it with opacity.

A design council (Muse, Opus, and Codex reviewing, Fable judging splits) polished this on 2026-11-12 over 8 rounds.
Its record is `.council/design/STATE.md` (local only, not in git). The rules it settled:

- Pages are Home, Activity, Spending, Budgets, Bills, Accounts, on desktop and phone.
- Money: hero numbers and summaries in whole dollars, single transactions and balances in cents. A month's category
  figures are rounded once together (`dollarsByCat`) and shared by every page, so rows add up and pages agree.
- Over budget is decided in cents, like the daily alert; under a dollar reads "<$1 over".
- Every page but Home uses main-plus-side. Home is one grid written in phone reading order.
- Judge's calls, kept unless the owner says otherwise: the budget field sits on the spent line; Activity's band has no
  all-time count; Bills groups by month; Spending's By month is a side list; links stay deep teal (from the research).
- Fake-data screenshots for any design review: `.council/design/seed.mjs`, `serve.sh` (port 3499), `shoot.mjs`.

## Daily job

`bin/daily.mjs`, agent `local.tally-daily` at 7:00: syncs everything through `POST /api/daily`, writes
`data/tally-snapshot.db` for the nightly backup, and posts new alerts (broken connection weekly, charge of
$200 or more dated in the last 10 days, a budget gone over) to Discord. The webhook is `DISCORD_WEBHOOK_URL` in
`~/.config/tally/discord.env`. Long posts are split into several messages, and each message's alerts are marked
sent only after Discord accepts that message.
