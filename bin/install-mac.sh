#!/bin/sh
# Installs tally as two launchd agents on a Mac: the server (always on) and the daily sync at 7:00.
# Usage: bin/install-mac.sh [--host NAME[:PORT]] [--port N] [--at HH:MM] [--print]
#   --host   a hostname tally should answer to besides localhost, like your tailscale serve address
#   --port   the local port, 3400 unless that one is taken
#   --at     when the daily sync runs, 07:00 unless you pick another time
#   --print  write the two plists to stdout and install nothing
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node || true)
HOST="" PRINT="" PORT=3400 AT=07:00
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --at) AT="$2"; shift 2 ;;
    --print) PRINT=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$NODE" ] || { echo "node not found. Install Node 24 or newer first." >&2; exit 1; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 24 ] || { echo "tally needs Node 24 or newer; this is $("$NODE" -v)." >&2; exit 1; }

case "$PORT" in ''|*[!0-9]*) echo "--port needs a number, like 3400." >&2; exit 2 ;; esac
case "$AT" in [0-2][0-9]:[0-5][0-9]) ;; *) echo "--at needs a 24-hour time, like 07:00." >&2; exit 2 ;; esac
HOUR=$((10#${AT%%:*})) MINUTE=$((10#${AT##*:}))
[ "$HOUR" -le 23 ] || { echo "--at needs a 24-hour time, like 07:00." >&2; exit 2; }

PAGE="http://localhost:$PORT"
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
  <key>EnvironmentVariables</key><dict><key>TALLY_PORT</key><string>$PORT</string>$HOSTS_ENV</dict>
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
  <key>EnvironmentVariables</key><dict><key>TALLY_PORT</key><string>$PORT</string><key>TALLY_PAGE_URL</key><string>$PAGE</string></dict>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MINUTE</integer></dict>
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
echo "tally is running at http://localhost:$PORT, with the daily sync at $AT. Logs: $DIR/tally.log"
