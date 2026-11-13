# tally

A money app you run on your own computer, in the spirit of Mint. It links your bank, card, and brokerage accounts
through Plaid and shows net worth, spending by month and category, budgets, bills, and every transaction. The data
stays in a SQLite file on your machine.

The full guide, with screenshots: **https://tally.jesselind.com**

## Quick start

You need Node 24 or newer and your own Plaid keys (https://dashboard.plaid.com/signup).

    git clone https://github.com/jclind/tally.git
    cd tally
    mkdir -p ~/.config/tally
    printf 'PLAID_CLIENT_ID=...\nPLAID_SECRET=...\nPLAID_ENV=sandbox\n' > ~/.config/tally/plaid.env
    chmod 600 ~/.config/tally/plaid.env
    npm start

Open http://localhost:3400 and link an account from the Accounts page. With `PLAID_ENV=sandbox`, Plaid's test bank
works with `user_good` / `pass_good`. Change it to `production` for your real accounts.

On a Mac, `bin/install-mac.sh` keeps tally running in the background and syncs every morning at 7:00.

## Good to know

- tally has no login. It listens on localhost only. To use it from your phone, put it behind
  [Tailscale](https://tailscale.com) with `tailscale serve`, and pass that address to `bin/install-mac.sh --host`.
  Never expose it to the public internet.
- Plaid's free Trial plan allows 10 connected institutions for life, and removing one doesn't give the slot back.
  Fix a broken connection with Fix connection on the Accounts page instead of linking the bank again.
- `data/tally.db` holds your access tokens. Back it up; losing it means linking every bank again.

Tests: `npm test`. No dependencies, Node built-ins only. MIT license.
