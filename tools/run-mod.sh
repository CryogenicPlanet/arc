#!/usr/bin/env bash
# Launch an isolated mod bundle via LaunchServices; --background uses open -g.
#   tools/run-mod.sh [--validation | --agent <slug> | --debug | --app <ArcMod.app>] [--background] [--guard]
#                    [--cdp-port <1024-65535>] [extra Chromium switches…]
# The everyday ArcMod is installed in /Applications (or ~/Applications) and also opens like any app; this
# launches it, or with --debug the build in build/ArcMod.app (bun tools/build-mod.ts --debug).
# CFBundleName isolates Arc's sidebar and Chromium data, even where Arc ignores --user-data-dir.
# Agent sessions additionally request their own Chromium directory and optional loopback CDP.
# --guard is a verification-only sandbox (Chromium's nested sandbox must be disabled).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD=0
BACKGROUND=0
VALIDATION=0
DEBUG=0
APP_PATH=""
AGENT=""
CDP_PORT=""
EXTRA_ARGS=()
SEEN=" "
fail() { echo "$*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --guard|--validation|--background|--agent|--cdp-port|--debug|--app)
      FLAG="$1"
      [[ "$SEEN" != *" $FLAG "* ]] || fail "duplicate launch argument: $FLAG"
      SEEN="$SEEN$FLAG "
      case "$FLAG" in
        --guard) GUARD=1; shift ;;
        --validation) VALIDATION=1; shift ;;
        --debug) DEBUG=1; shift ;;
        --background) BACKGROUND=1; shift ;;
        --agent|--cdp-port|--app)
          [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "missing value for $FLAG"
          case "$FLAG" in --agent) AGENT="$2" ;; --cdp-port) CDP_PORT="$2" ;; --app) APP_PATH="$2" ;; esac
          shift 2 ;;
      esac
      ;;
    --) shift; EXTRA_ARGS+=("$@"); break ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done
[[ -z "$AGENT" || $VALIDATION == 0 ]] || fail "--validation and --agent cannot be combined"
if [[ -n "$AGENT" ]]; then
  [[ ${#AGENT} -le 32 && "$AGENT" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || fail "agent slug must be 1-32 lowercase letters/digits with internal hyphens, starting with a letter"
fi
if [[ -n "$CDP_PORT" ]]; then
  [[ -n "$AGENT" ]] || fail "--cdp-port requires --agent"
  [[ "$CDP_PORT" =~ ^[1-9][0-9]{3,4}$ ]] || fail "CDP port must be an integer from 1024 to 65535"
  [[ $CDP_PORT -ge 1024 && $CDP_PORT -le 65535 ]] || fail "CDP port must be an integer from 1024 to 65535"
fi
[[ $GUARD == 0 || $BACKGROUND == 0 ]] || fail "--background requires a LaunchServices launch and cannot be combined with --guard"
APP_NAME=ArcMod
DOMAIN=company.thebrowser.Browser.mod
if [[ $VALIDATION == 1 ]]; then APP_NAME=ArcModValidation; DOMAIN=company.thebrowser.Browser.mod.validation; fi
if [[ -n "$AGENT" ]]; then
  APP_NAME="ArcModAgent-$AGENT"
  DOMAIN="company.thebrowser.Browser.mod.agent.$AGENT"
  for ARG in ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}; do
    [[ "$ARG" != -- ]] || fail "agent sessions cannot forward a Chromium switch terminator"
    # Chromium accepts both one and two leading dashes on macOS.
    SWITCH="${ARG#-}"
    SWITCH="${SWITCH#-}"
    case "$SWITCH" in
      user-data-dir|user-data-dir=*|remote-debugging-*) fail "agent sessions manage Chromium data/debug switches; use --cdp-port for CDP" ;;
    esac
  done
fi
APP="$ROOT/build/$APP_NAME.app"
if [[ -n "$APP_PATH" ]]; then
  APP="$APP_PATH"
  APP_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$APP_NAME" == ArcMod || "$APP_NAME" == ArcModValidation ]] || fail "not an ArcMod app: $APP"
  [[ "$APP_NAME" == ArcMod ]] || { DOMAIN=company.thebrowser.Browser.mod.validation; VALIDATION=1; }
elif [[ "$APP_NAME" == ArcMod && $DEBUG == 0 ]]; then
  # Where bun tools/build-mod.ts installs it (ARCMOD_INSTALL_DIRS overrides the list for tests).
  IFS=: read -r -a INSTALL_DIRS <<< "${ARCMOD_INSTALL_DIRS:-/Applications:$HOME/Applications}"
  for DIR in "${INSTALL_DIRS[@]}"; do
    if [[ -d "$DIR/ArcMod.app" ]]; then APP="$DIR/ArcMod.app"; break; fi
  done
fi
EXE="$APP/Contents/MacOS/Arc"
DATA="$HOME/Library/Application Support/$APP_NAME"
LOG="$ROOT/build/$APP_NAME-run.log"

BUILD_OPTIONS=""
[[ $VALIDATION == 0 ]] || BUILD_OPTIONS=" --validation"
[[ $DEBUG == 0 ]] || BUILD_OPTIONS=" --debug"
[[ -z "$AGENT" ]] || BUILD_OPTIONS=" --agent $AGENT"
[[ -x "$EXE" ]] || fail "build first: bun tools/build-mod.ts$BUILD_OPTIONS"
MOD_PIDS="$(pgrep -f "(^|/)$APP_NAME[.]app/Contents/MacOS/Arc( |$)" || true)"
[[ -z "$MOD_PIDS" ]] || fail "$APP_NAME already running (pid $MOD_PIDS)"
if [[ -n "$AGENT" ]]; then
  PLIST_AGENT="$(/usr/libexec/PlistBuddy -c 'Print :ArcModAgentSession' "$APP/Contents/Info.plist")"
  [[ "$PLIST_AGENT" == "$AGENT" ]] || fail "agent identity does not match bundle; rebuild --agent $AGENT"
fi
defaults write "$DOMAIN" cloudKitSyncEnabled -bool false
defaults write "$DOMAIN" firebaseSyncEnabled -bool false

SERVICE_RULES="$(/usr/libexec/PlistBuddy -c 'Print :ArcModHostResolverRules' "$APP/Contents/Info.plist")"
ARGS=(--use-mock-keychain --no-default-browser-check ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} --disable-sync --disable-background-networking "--host-resolver-rules=$SERVICE_RULES")
if [[ -n "$AGENT" ]]; then
  CHROMIUM_DATA="$DATA/Agent Chromium Data"
  mkdir -p "$CHROMIUM_DATA"
  chmod 700 "$DATA" "$CHROMIUM_DATA"
  ARGS+=("--user-data-dir=$CHROMIUM_DATA")
  if [[ -n "$CDP_PORT" ]]; then ARGS+=(--remote-debugging-address=127.0.0.1 "--remote-debugging-port=$CDP_PORT"); fi
fi

if [[ $GUARD == 1 ]]; then
  SB="$ROOT/build/$APP_NAME-guard.sb"
  cat >"$SB" <<EOF_GUARD
(version 1)
(allow default)
(deny file-read* file-write* (subpath "$HOME/Library/Application Support/Arc"))
(deny file-write* (subpath "$HOME/Library/Caches/Arc"))
(deny file-write* (subpath "$HOME/Library/Caches/company.thebrowser.Browser"))
(deny file-write* (regex #"^$HOME/Library/Preferences/com\\.launchdarkly"))
(deny file-write* (literal "$HOME/Library/Preferences/company.thebrowser.Browser.plist"))
(deny user-preference-write (preference-domain "company.thebrowser.Browser"))
EOF_GUARD
  echo "launching $APP_NAME under guard ($SB)"
  nohup sandbox-exec -f "$SB" "$EXE" "${ARGS[@]}" --no-sandbox >"$LOG" 2>&1 &
else
  echo "launching $APP_NAME"
  OPEN_ARGS=(-n)
  [[ $BACKGROUND == 0 ]] || OPEN_ARGS+=(-g)
  # LaunchServices owns the app so a short-lived agent shell cannot reap it.
  open "${OPEN_ARGS[@]}" -a "$APP" --stdout "$LOG" --stderr "$LOG" --args "${ARGS[@]}"
fi
echo "log $LOG · data $DATA"
