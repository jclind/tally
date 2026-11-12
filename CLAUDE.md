# tally

A Mint-style money app for the owner. Plaid links their bank, card, and brokerage accounts, and the data lives in
SQLite at `data/tally.db` on the server. Pages: Overview, Transactions, Spending, Budgets, Bills, Accounts.

## Rules

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

## Daily job

`bin/daily.mjs`, agent `local.tally-daily` at 7:00: syncs everything through `POST /api/daily`, writes
`data/tally-snapshot.db` for the nightly backup, and posts new alerts (broken connection weekly, charge of
$200 or more, a budget gone over) to Discord. The webhook is `DISCORD_WEBHOOK_URL` in
`~/.config/tally/discord.env`. Alerts are marked sent only after Discord accepts the post.
