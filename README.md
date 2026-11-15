# tally

A money app you run on your own computer, in the spirit of Mint. It links your bank, card, and brokerage accounts
through Plaid and shows net worth, spending by month and category, budgets, bills, and every transaction. The data
stays in a SQLite file on your machine.

The full guide, with screenshots: **https://tally.jesselind.com**

## Quick start

You need a Mac, Windows, or Linux computer, Node 24 or newer, git, and your own Plaid keys
(https://dashboard.plaid.com/signup). These commands are for a Mac or Linux; the guide has the PowerShell ones.

    git clone https://github.com/jclind/tally.git
    cd tally
    mkdir -p ~/.config/tally
    printf 'PLAID_CLIENT_ID=...\nPLAID_SECRET=...\nPLAID_ENV=production\n' > ~/.config/tally/plaid.env
    chmod 600 ~/.config/tally/plaid.env
    node server.mjs

Open http://localhost:3400 and link your first bank. To try Plaid's test bank first, use your Sandbox secret and
`PLAID_ENV=sandbox`, and sign in with `user_good` / `pass_good`. Sandbox data goes in `data/sandbox.db`, so it
never mixes with your real banks.

To keep tally running in the background and sync every morning at 7:00, run `bin/install-mac.sh` on a Mac, or
`bin\install-windows.cmd` on Windows.

## Good to know

- tally has no login. It listens on localhost only. To use it from your phone, put it behind
  [Tailscale](https://tailscale.com) with `tailscale serve`, and pass that address to `bin/install-mac.sh --host`
  (`-HostName` on Windows).
  Never expose it to the public internet.
- Plaid's free Trial plan allows 10 connected institutions for life, and removing one doesn't give the slot back.
  Fix a broken connection with Fix connection on the Accounts page instead of linking the bank again.
- `data/tally.db` holds your access tokens. Back it up; losing it means linking every bank again.

Tests: `npm test`. No dependencies, Node built-ins only. MIT license.
