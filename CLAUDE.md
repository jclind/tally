# tally

A Mint-style money app for the owner. Plaid links their bank, card, and brokerage accounts, and the data lives in
SQLite at `data/tally.db` on the server. Step 1, now, is a link test page. The full app comes after it works.

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
