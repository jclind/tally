#!/bin/sh
# Uploads site/ to the Netlify site tally-jesselind, which serves https://tally.jesselind.com.
# Needs the Netlify CLI signed in. The site id is not a secret.
# Screenshots come from tally on made-up data: node site/tools/shoot.mjs <base url> site/img
set -eu
cd "$(dirname "$0")"
SITE=33e9a58c-3777-4396-93c8-7442d89b7d88
URL=https://tally.jesselind.com
netlify deploy --prod --no-build --dir . --site "$SITE" >/dev/null
for p in / /docs/ /style.css /img/hero-home.png; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$p")
  [ "$code" = 200 ] || { echo "published, but $URL$p answered $code" >&2; exit 1; }
done
echo "Live at $URL"
