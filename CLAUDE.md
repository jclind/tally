# tally

A Mint-style money app you run yourself. Plaid links your bank, card, and brokerage accounts, and the data lives in
SQLite at `data/tally.db` on your machine (`data/sandbox.db` when the keys say `PLAID_ENV=sandbox`, so Plaid's test bank
never mixes with real banks). Pages: Home, Activity, Spending, Budgets, Bills, Accounts. Home with nothing linked is a
start screen: the link buttons, or where the keys go when tally can't find them.
The install guide is https://tally.jesselind.com. Its source is `site/`, published with `site/publish.sh`; its screenshots are crops of tally running on made-up data (`site/tools/shoot.mjs`, with the list in `site/tools/shots.json`). A gitignored `CLAUDE.local.md` holds rules for one person's setup.

## Rules

- Plaid's free Trial plan allows 10 Items for life. Removing an Item does not free its slot. A broken
  connection is fixed with update mode (a link token made from the existing access token), never by
  linking the institution again. Never call `/item/remove` without the owner's OK.
- `days_requested` is fixed when an Item is created. Link tokens for new Items ask for 730 days.
- Keys live in `~/.config/tally/plaid.env` (mode 600), outside the repo. Never print `PLAID_SECRET` or an
  access token, in logs, the page, or chat. `/api/status` must never return an access token; a test checks it.
- `data/` holds real account data and access tokens. It is gitignored. Never commit it or copy it off the machine.
- Merchant logos come from the `logo_url` in each stored Plaid record. After any sync the server copies new ones into
  `data/logos` in the background, only from Plaid's two logo hosts. The page loads only those copies, never Plaid's
  addresses. Never send a merchant's name or domain to a favicon service to fill the gaps.
- The server listens on 127.0.0.1 only. To reach it from other devices, `tailscale serve` (tailnet only) proxies to
  it, and `TALLY_HOSTS` names that host. Any other Host and any cross-origin POST is refused. Never expose tally to
  the public internet (no Tailscale Funnel, no port forward): it has no login.
- This repo is public. Real names, banks, amounts, hostnames, and home paths stay out of code, tests, comments,
  and commit messages. Tests and screenshots use made-up data.
- Tests run against a fake Plaid server (`npm test`). They never use real keys.
- Node built-ins only (`node:sqlite`, `node:http`, `fetch`). Add a dependency only with a reason.

## Releases

- The version is in `package.json`. Settings shows it with the commit tally started from (`BUILD` in `server.mjs`).
- main is what people run: the guide's update step is `git pull` and a restart. Push only what passes `npm test`.
- A release: bump the version (0.x: the minor number for a feature, the patch number for a fix), commit, tag
  `vX.Y.Z` on that commit, push the tag, and `gh release create vX.Y.Z` with a few plain lines on what changed for
  someone running tally. No real names, banks, or amounts in the notes.
- Schema changes so far only add tables and columns, at startup in `setupViews()` and the server's table setup. The
  first change that renames, drops, or rewrites data moves to numbered migrations on SQLite's `PRAGMA user_version`,
  run in order at startup, since an install can skip several releases.
- No update check: tally makes no outside calls the owner didn't ask for.

## Money rules

All of them live in `lib/report.mjs`, tested in `test/report.test.mjs`. Plaid's sign: positive is money out.

- Category order: a single-transaction override, then a merchant rule, then Plaid's category. Plaid's
  transfers and card payments become `TRANSFER`; gas and groceries get their own categories.
- Spending is depository and credit accounts only, minus `TRANSFER` and `INCOME`. Refunds lower it.
  Income is `INCOME` on depository accounts.
- A recurring stream is a transfer, not a bill, when its name says payment, pmt, transfer, xfer, or autopay.
  Plaid's category alone isn't trusted there (it has called a hosting bill a transfer).
- A subscription is a repeating charge on a regular schedule Plaid is sure of (not `UNKNOWN`, not early detection),
  except bills: housing, metered utilities, loans and card payments, insurance, and bank fees, by detailed
  category. Phone, internet, and cable count. Transfers are left out by name only, since Plaid calls some bills
  account transfers (a hosting bill, 2026-11-16). Edit on
  the Bills card moves one either way, saved per merchant in `stream_kinds` (keyed with SQLite's `lower()`).
- A repeating charge can be renamed on the Bills card's Edit, saved per Plaid stream in `stream_names`, since one
  store can bill two subscriptions under one name. Pages show `name ?? who`; `who` stays Plaid's merchant name,
  because the subscription choice is keyed on it.
- Every repeating amount and total uses the expected next charge (`expected`): a subscription's latest price; for
  other bills and income, the latest charge when the last two match to the cent, else the average of the last
  three. Plaid's `average_amount` spans the whole history and lags a price change by months, so it's only the
  fallback when none of the stream's charges are stored.
- A price increase: the two or three charges before the latest are one price (to the cent) and the latest is at
  least 50 cents more, compared in integer cents. A stream mixing prices never counts. The note lasts one charge,
  and the daily alert (setting `priceAlerts`, on by default) fires once per increase within 45 days.
- Plaid sends some merchant names as empty strings. Treat `''` as missing (`nullif`).
- Budgets are the owner's, added one category at a time; tally never fills them in. The Not budgeted field's hint is
  the 3-month average rounded up to $10 (a one-click fill for every category was removed 2026-11-17).
- A budget repeats every month, every 2, 3, 6, or 12 months from its `start` month, or falls in one month only
  (`every` 0), and counts only in months it's due. A monthly budget can roll over from `rollover_from`: each month
  carries what was left, or what went over, into the next, and reset moves `rollover_from` to this month. tally keeps
  no budget history, so a past month shows today's budgets.
- Everything else (`EVERYTHING_ELSE` in `budgets`) is an optional monthly budget for all spending in categories with
  no budget due that month, including categories whose budget falls in another month. It never rolls over.
- Goals (`goals`) are an amount for one account to reach, read from its balance: a cash or investment account saves
  up to it, a card or loan pays down to it from what it owed when the goal was set (`start_balance`). One goal per
  account, so two goals never count the same money. Reaching one alerts once.
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
  edge. Each card's caption is one line holding the one fact the card can't show, and the picture has to show what
  the caption claims (the Activity panel has the category picker open; Connections has a bank that needs a new
  sign-in). No panel appears twice on a page.
- The made-up data the crops assume: one category over budget (Groceries, $25 over) and every other spending category
  budgeted, so Home's two totals match. `shoot.mjs`'s header says how to set up the Connections error state.
- Each fact appears once per page. Copy that repeats a heading, a panel, or another section gets cut.
- Code on phones keeps its real line breaks and scrolls sideways with an edge fade; only long inline addresses wrap.
- Judge's calls still standing: no address bar over the hero shot; Budgets is left out of the panels on phones because
  the phone hero ends on that card; guide steps use plain teal numerals hung in the gutter with one left edge for every
  heading; the guide's only boxes are pink warnings; Backups comes right after Keep it running.
- The homepage is the owner's pick from a design-variants run on 2026-11-13 (design 5e), which replaced the judge's
  hero and panel layout. The headline is "Like Mint, but it runs on your own computer" (the owner's pick, 2026-11-16), and the
  description opens with "An open-source budgeting app", so it names open source and tells a reader who never used Mint
  what tally is. The hero is centered in
  the band with "Read the install guide" and a "jclind/tally" button, then one fine-print line. The Home screenshot
  sits in a frame with a deep shadow, lifted off the band, and the band ends a third of the way down it, so the band's
  teal never meets the screenshot's own band edge to edge. The four panels are a two by two grid on the app's mint,
  each with one short caption under it. Setup is one code block whose comments carry what you need, with no
  requirements list. Everything uses the app's type (Avenir Next, Nunito Sans as the fallback); the owner turned down
  serif and display faces.
- The band is a deep teal (#136564, #104F4E in dark) on both pages. A light/dark button in the header overrides the
  device; `site/theme.js` sets `data-theme` on the root before the page draws, and the stylesheet's dark tokens hang
  off `[data-theme="dark"]`, never off a `prefers-color-scheme` query. The script also points each screenshot's
  dark-twin `<source>` at the mode in use, so a new screenshot needs only the usual `<picture>` markup. Switching
  modes cross-fades the page with a view transition while the moon shrinks and turns away and the sun's rays grow out
  (the owner's reference video, 2026-11-16); reduced motion and browsers without view transitions just switch.
- Setup goes straight to production keys in three steps (get keys, install, link your banks). Plaid's test bank is an
  optional section after the steps, since a connection only counts once a bank links, and wrong keys fail before
  Plaid's window opens.
- Before you start is the owner's pick from a design-variants run on 2026-11-16 (design E): the system switch on the
  heading's line, two lines with mint checks (Node and git with each system's install command, a US bank), and a
  copyable prompt for a coding agent folded under "Setting up with a coding agent?". The prompt keeps the Plaid keys
  out of the chat and asks before anything that runs at login; keep both if the prompt changes.

A second council on 2026-11-13 (4 rounds, Opus and Codex, Muse for one) measured the install guide against ten
published install guides (Obsidian, Homebrew, Ghost, Next.js, Tailwind, Resend, Sentry, GitBook, Immich, Actual
Budget). Its record and corrected benchmark are in `.council/site-ref/` (`STANDARDS.md`). What it settled:

- Step 2 has three parts: download, "Add your keys", and "Start and check it", each with an anchor. What a command
  prints goes in an `.output` block labeled "Expected output", on the page surface with no Copy button.
- Only code that isn't a terminal command gets a label (`data-label`): a file's path, or "Service environment".
  Terminal blocks stay unlabeled.
- Wherever Mac and Linux split, the platform comes first: an "On a Mac" / "On Linux" h3, or a bold lead-in.
- Since 2026-11-15 the guide also covers Windows. The Mac / Windows / Linux switch beside the Before you start heading
  (its group label is "Show commands for") shows one system's commands; anything tagged `data-os="mac"`, `"windows"`, `"linux"`, or a mix like `"mac linux"` hides
  for the others. The head script picks the reader's own system until they choose, and with no script every system
  shows, so the platform lead-ins stay.
- The outline has sub-entries for keys, start, and update, and tracks the current place by scroll position.
- Judge's calls: every guide h2 is 28px (24px on phones); desktop sub-headings 20px (18px on phones); Using tally
  terms and Troubleshooting answers 17px bold, and each Troubleshooting answer is a linkable `h3.q`; no card grids;
  phone step numerals stay inline; on phones a one-line command that overflows takes Copy in a row above, and the
  Copy row is a 32px button with a 44px tap area.

## Windows

`bin/install-windows.ps1`, run through `bin\install-windows.cmd`, makes two scheduled tasks in a `\tally\` folder
for the signed-in user, with no admin rights: `tally` at sign-in and `tally-daily` at 7:00. Both run `bin/run-windows.cmd` through `conhost --headless`,
which loops the server with a 5-second pause and reads `TALLY_PORT`, `TALLY_HOSTS`, and `TALLY_PAGE_URL` from
`tally.env` (gitignored, written by the installer). What was learned getting it to work, each one tested on a real
Windows 11 PC:

- Windows PowerShell's default policy refuses any `.ps1`, `npm.ps1` included, so the guide starts tally with
  `node server.mjs`, and people run the installer through `bin\install-windows.cmd`, which calls it with
  `-ExecutionPolicy Bypass`.
- Task Scheduler's defaults stop a task after 72 hours and never start it on battery; the installer turns both off.
- `conhost --headless "path\run-windows.cmd" server` keeps a path with spaces whole; `cmd /c ""path" server"` passed
  through conhost does not, and fails silently.
- Stopping a task ends only conhost, so `Stop-Tally` also ends the `run-windows.cmd` tree with `taskkill /T`.
- Two processes can't append to one log at once, so the daily job writes `tally-daily.log`.
- Tasks made from an admin PowerShell can't be replaced from a normal one; the installer says so.
- Windows PowerShell spends 2 seconds on IPv6 for `localhost`, and tally listens on 127.0.0.1, so the installer
  checks `127.0.0.1`.
- Windows doesn't use the file modes tally sets, so the data is private only inside the user folder. The installer
  warns when the checkout is outside it.
- The keys file may be UTF-16 (Windows PowerShell's `Out-File`) or carry a byte-order mark (Notepad); `readText` in
  `server.mjs` reads both.
- The tests run on Windows in GitHub Actions (`.github/workflows/test.yml`). A test that deletes a folder must wait
  for the server it started to exit, since Windows won't delete an open database.

## Daily job

`bin/daily.mjs`, run at 7:00 by the agent `bin/install-mac.sh` installs, or the task `bin/install-windows.ps1` makes: syncs everything through `POST /api/daily` and posts new alerts (broken connection weekly, a charge at or over the alert amount
dated in the last 10 days, a budget gone over, a goal reached) to Discord when alerts are on in Settings. The webhook comes from
Settings, or `DISCORD_WEBHOOK_URL` in `~/.config/tally/discord.env` from before the setting. Long posts are split into several messages, and each message's alerts are marked
sent only after Discord accepts that message.

## Sync and settings

One full sync runs at a time (`syncAllOnce`). Besides the daily job and the Sync button, tally syncs when it starts and
when the page opens or its tab comes back, if any connection is older than the `autoSync` setting or last failed to
reach Plaid; automatic syncs run at most every 10 minutes. Settings live in the `settings` table, each with a default
and a check in `SETTINGS` in `server.mjs`, and show on the Settings page (`#/settings`, the gear in the top bar).
Every full sync (`syncAll`) ends by writing `data/tally-snapshot.db` (`sandbox-snapshot.db` on sandbox keys) for backups, so a backup exists without the
daily job. The connection limit is the `itemCap` setting (default 10, or `TALLY_ITEM_CAP`), shown on Settings.
A request for a Host outside loopback and `TALLY_HOSTS` is logged once per name. Discord alerts are opt-in (`alerts`, off unless an old `discord.env` exists). The webhook pasted there is stored in
`settings` and never returned by `GET /api/settings`; `POST /api/daily` hands it to `bin/daily.mjs` with the alerts.

## Gig payouts

`GET /api/payouts` gives weekly payouts per gig platform, by the week the work happened. It's empty unless
`~/.config/tally/payouts.mjs` (or `TALLY_PAYOUTS`) exists; `payouts()` in `lib/report.mjs` says what that file returns.
