#!/bin/sh
# Installs tally as two launchd agents on a Mac: the server (always on) and the daily sync at 7:00.
# Usage: bin/install-mac.sh [--host NAME:PORT] [--print]
#   --host   a hostname tally should answer to besides localhost, like your tailscale serve address
#   --print  write the two plists to stdout and install nothing
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node || true)
HOST="" PRINT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --print) PRINT=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$NODE" ] || { echo "node not found. Install Node 24 or newer first." >&2; exit 1; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 24 ] || { echo "tally needs Node 24 or newer; this is $("$NODE" -v)." >&2; exit 1; }

PAGE="http://localhost:3400"
[ -n "$HOST" ] && PAGE="https://$HOST"
HOSTS_ENV=""
[ -n "$HOST" ] && HOSTS_ENV="<key>TALLY_HOSTS</key><string>$HOST</string>"

server() { cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.tally</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>TALLY_PORT</key><string>3400</string>$HOSTS_ENV</dict>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/tally.log</string>
  <key>StandardErrorPath</key><string>$DIR/tally.log</string>
</dict>
</plist>
EOF
}

daily() { cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.tally-daily</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/bin/daily.mjs</string></array>
  <key>EnvironmentVariables</key><dict><key>TALLY_PORT</key><string>3400</string><key>TALLY_PAGE_URL</key><string>$PAGE</string></dict>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$DIR/tally.log</string>
  <key>StandardErrorPath</key><string>$DIR/tally.log</string>
</dict>
</plist>
EOF
}

if [ -n "$PRINT" ]; then server; daily; exit 0; fi

AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS"
server > "$AGENTS/local.tally.plist"
daily > "$AGENTS/local.tally-daily.plist"
for name in local.tally local.tally-daily; do
  launchctl bootout "gui/$(id -u)/$name" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$name.plist"
done
echo "tally is running at http://localhost:3400. Logs: $DIR/tally.log"
