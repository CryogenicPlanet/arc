#!/usr/bin/env bash
# Launches ArcMod next to (and isolated from) the real Arc. The everyday ArcMod is installed in /Applications
# (or ~/Applications) and also opens like any app; --debug launches build/ArcMod.app (build-mod.ts --debug).
#   tools/run-mod.sh [--validation | --debug | --app <ArcMod.app>] [--guard] [extra Chromium switches…]
#
# Isolation: build-mod.ts sets CFBundleName=ArcMod, and Arc names its data folder after it, so all
# state (sidebar JSON and Chromium "User Data") lives in ~/Library/Application Support/ArcMod.
# Arc ignores --user-data-dir. Mock keychain: never touches the real "Arc Safe Storage" key.
# CloudKit/Firebase sync are turned off in the mod's own prefs domain: the ad hoc copy has no iCloud
# entitlement, and Arc aborts at launch if it tries to open its CloudKit container.
# Normal launches use LaunchServices and vendor-only Chromium resolver rules.
# --validation uses a separate app, preferences domain and data folder.
# --guard additionally runs it under sandbox-exec with a profile that denies ANY read/write of the
# real Arc data and LaunchDarkly cache, as a kernel-enforced backstop to the CFBundleName isolation.
# Seatbelt profiles can't nest, so --guard also passes --no-sandbox to Chromium's children:
# use it for verification runs only, not for browsing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD=0
DEBUG=0
APP_PATH=""
APP_NAME=ArcMod
DOMAIN=company.thebrowser.Browser.mod
while [[ $# -gt 0 ]]; do
  case "$1" in
    --guard) GUARD=1; shift ;;
    --validation) APP_NAME=ArcModValidation; DOMAIN=company.thebrowser.Browser.mod.validation; shift ;;
    --debug) DEBUG=1; shift ;;
    --app) [[ $# -ge 2 && -n "$2" ]] || { echo "missing value for --app" >&2; exit 1; }; APP_PATH="$2"; shift 2 ;;
    *) break ;;
  esac
done
APP="$ROOT/build/$APP_NAME.app"
if [[ -n "$APP_PATH" ]]; then
  APP="$APP_PATH"
  APP_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$APP_NAME" == ArcMod || "$APP_NAME" == ArcModValidation ]] || { echo "not an ArcMod app: $APP" >&2; exit 1; }
  [[ "$APP_NAME" == ArcMod ]] || DOMAIN=company.thebrowser.Browser.mod.validation
elif [[ "$APP_NAME" == ArcMod && $DEBUG == 0 ]]; then
  for INSTALLED in /Applications/ArcMod.app "$HOME/Applications/ArcMod.app"; do
    if [[ -d "$INSTALLED" ]]; then APP="$INSTALLED"; break; fi
  done
fi
EXE="$APP/Contents/MacOS/Arc"
DATA="$HOME/Library/Application Support/$APP_NAME"
LOG="$ROOT/build/$APP_NAME-run.log"

[[ -x "$EXE" ]] || { echo "build first: bun tools/build-mod.ts$([[ $DEBUG == 0 ]] || echo ' --debug')" >&2; exit 1; }
MOD_PIDS="$(pgrep -f "(^|/)$APP_NAME[.]app/Contents/MacOS/Arc( |$)" || true)"
if [[ -n "$MOD_PIDS" ]]; then echo "ArcMod already running (pid $MOD_PIDS)" >&2; exit 1; fi
defaults write "$DOMAIN" cloudKitSyncEnabled -bool false
defaults write "$DOMAIN" firebaseSyncEnabled -bool false

SERVICE_RULES="$(/usr/libexec/PlistBuddy -c 'Print :ArcModHostResolverRules' "$APP/Contents/Info.plist")"
ARGS=(--use-mock-keychain --no-default-browser-check "$@" --disable-sync --disable-background-networking "--host-resolver-rules=$SERVICE_RULES")

if [[ $GUARD == 1 ]]; then
  SB="$ROOT/build/guard.sb"
  cat >"$SB" <<EOF
(version 1)
(allow default)
(deny file-read* file-write* (subpath "$HOME/Library/Application Support/Arc"))
(deny file-write* (subpath "$HOME/Library/Caches/Arc"))
(deny file-write* (subpath "$HOME/Library/Caches/company.thebrowser.Browser"))
(deny file-write* (regex #"^$HOME/Library/Preferences/com\.launchdarkly"))
(deny file-write* (literal "$HOME/Library/Preferences/company.thebrowser.Browser.plist"))
(deny user-preference-write (preference-domain "company.thebrowser.Browser"))
EOF
  echo "launching ArcMod under guard ($SB)"
  nohup sandbox-exec -f "$SB" "$EXE" "${ARGS[@]}" --no-sandbox >"$LOG" 2>&1 &
else
  echo "launching ArcMod"
  # LaunchServices owns the normal app process, so a short-lived agent shell cannot reap it.
  open -n -a "$APP" --stdout "$LOG" --stderr "$LOG" --args "${ARGS[@]}"
fi
echo "log $LOG · data $DATA"
