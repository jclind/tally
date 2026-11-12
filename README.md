# tally

A Mint-style money app that links accounts through Plaid and keeps the data in SQLite on the server.

Run: `npm start`, or the launchd agent in `launchd/`. Open https://my-mac.example.ts.net:8400
on the tailnet, or http://localhost:3400 on the server. Keys go in `~/.config/tally/plaid.env`:

    PLAID_CLIENT_ID=...
    PLAID_SECRET=...

Test: `npm test`.

Daily: `launchd/local.tally-daily.plist` runs `bin/daily.mjs` at 7:00.
