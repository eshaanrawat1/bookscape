#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.atlas.reading-snapshot.plist"
LOG_DIR="${HOME}/Library/Logs"
mkdir -p "${LOG_DIR}"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.atlas.reading-snapshot</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PYTHON_BIN}</string>
    <string>${ROOT_DIR}/scripts/reading_snapshot_job.py</string>
    <string>--mode</string>
    <string>login-backup</string>
    <string>--root</string>
    <string>${ROOT_DIR}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PYTHONPATH</key>
    <string>${ROOT_DIR}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/atlas-reading-snapshot.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/atlas-reading-snapshot.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"

echo "Installed launch agent at ${PLIST_PATH}"
echo "Now add nightly finalize cron line (crontab -e):"
echo "0 23 * * * cd ${ROOT_DIR} && PYTHONPATH=${ROOT_DIR} ${PYTHON_BIN} ${ROOT_DIR}/scripts/reading_snapshot_job.py --mode nightly-finalize --root ${ROOT_DIR}"
