# tally

A Mint-style money app that links accounts through Plaid and keeps the data in SQLite on the server.

Run: `npm start`, or the launchd agent in `launchd/`. Open with `ssh -L 3400:localhost:3400 your-server`, then
http://localhost:3400 in a desktop browser. Keys go in `~/.config/tally/plaid.env`:

    PLAID_CLIENT_ID=...
    PLAID_SECRET=...

Test: `npm test`.
