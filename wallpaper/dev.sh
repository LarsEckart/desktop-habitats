#!/bin/sh
# Build and control the isolated Desktop Habitats Dev.app.
# This script never installs, launches, stops, or edits the production wallpaper.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project=$(dirname "$here")
app="$project/.dev-build/Desktop Habitats Dev.app"
binary="$app/Contents/MacOS/Desktop Habitats Dev"
support="$HOME/Library/Application Support/Desktop Habitats Dev"
pidfile="$support/dev.pid"
logfile="$support/dev.log"

usage() {
  cat <<'USAGE'
Usage:
  sh wallpaper/dev.sh build
  sh wallpaper/dev.sh run [--windowed|--desktop] [--diagnostics] [--verify]
      [--scenario ID] [--seed N] [--run ID] [--snapshot]
  sh wallpaper/dev.sh stop
  sh wallpaper/dev.sh export [--timeout SECONDS]

The default run mode is windowed. --desktop is explicit and opt-in.
export sends a fresh request token to the already-running dev process and refuses stale or
incomplete responses. It does not start an app.
USAGE
}

if [ "$(uname -s)" != Darwin ]; then
  echo "dev.sh: macOS is required for Desktop Habitats Dev.app" >&2
  exit 2
fi

require_swift() {
  if ! command -v swiftc >/dev/null 2>&1; then
    echo "dev.sh: swiftc is missing; install the Xcode command line tools" >&2
    exit 1
  fi
}

is_dev_pid() {
  pid=$1
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command=$(ps -p "$pid" -o command= 2>/dev/null || true)
  case "$command" in
    *"$binary"*) return 0 ;;
    *) return 1 ;;
  esac
}

build() {
  require_swift
  builddir=$(mktemp -d)
  trap 'rm -rf "$builddir"' EXIT
  swiftc -O -target "$(uname -m)-apple-macos13.0" \
    -o "$builddir/Desktop Habitats Dev" \
    "$here/DevMain.swift" "$here/DevSupport.swift" "$here/Wallpaper.swift" \
    "$here/Lifecycle.swift" -framework Cocoa -framework WebKit -framework IOKit

  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/scene/scenes"
  cp "$builddir/Desktop Habitats Dev" "$binary"
  cp "$here/DevInfo.plist" "$app/Contents/Info.plist"
  cp -R "$project/scenes/riverscape" "$app/Contents/Resources/scene/scenes/"
  cp -R "$project/vendor" "$app/Contents/Resources/scene/"
  rm -rf "$app/Contents/Resources/scene/scenes/riverscape/tests"
  codesign --force --sign - "$app" >/dev/null 2>&1 || true
  echo "Built isolated dev app: $app"
}

run_dev() {
  mkdir -p "$support"
  if [ -s "$pidfile" ] && is_dev_pid "$(cat "$pidfile")"; then
    echo "dev.sh: Desktop Habitats Dev is already running (pid $(cat "$pidfile"))" >&2
    exit 1
  fi
  build
  # Only the exact dev executable gets this signal and pid tracking. No launch agent or
  # production process is queried or changed.
  "$binary" "$@" >>"$logfile" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$pidfile"
  echo "Started Desktop Habitats Dev (pid $pid); default mode is windowed."
}

stop_dev() {
  if [ ! -s "$pidfile" ]; then
    echo "Desktop Habitats Dev is not running."
    exit 0
  fi
  pid=$(cat "$pidfile")
  if ! is_dev_pid "$pid"; then
    rm -f "$pidfile"
    echo "Desktop Habitats Dev is not running."
    exit 0
  fi
  kill -TERM "$pid"
  i=0
  while is_dev_pid "$pid" && [ "$i" -lt 50 ]; do
    sleep 0.1
    i=$((i + 1))
  done
  if is_dev_pid "$pid"; then
    kill -KILL "$pid"
  fi
  rm -f "$pidfile"
  echo "Stopped Desktop Habitats Dev (pid $pid)."
}

export_dev() {
  timeout=10
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --timeout)
        [ "$#" -ge 2 ] || { echo "dev.sh export: --timeout needs seconds" >&2; exit 2; }
        timeout=$2; shift 2 ;;
      --timeout=*) timeout=${1#--timeout=}; shift ;;
      *) echo "dev.sh export: unknown option $1" >&2; exit 2 ;;
    esac
  done
  case "$timeout" in ''|*[!0-9]*) echo "dev.sh export: timeout must be whole seconds" >&2; exit 2;; esac
  [ "$timeout" -gt 0 ] || { echo "dev.sh export: timeout must be positive" >&2; exit 2; }
  [ -s "$pidfile" ] || { echo "dev.sh export: dev app is not running" >&2; exit 1; }
  pid=$(cat "$pidfile")
  is_dev_pid "$pid" || { echo "dev.sh export: pid is not the dev app" >&2; exit 1; }

  mkdir -p "$support/requests" "$support/exports"
  request=$(uuidgen | tr '[:upper:]' '[:lower:]')
  requested_at=$(date -u '+%Y-%m-%dT%H:%M:%S%z')
  request_tmp="$support/requests/.$request.tmp"
  request_file="$support/requests/$request.json"
  printf '{"requestId":"%s","requestedAt":"%s"}\n' "$request" "$requested_at" >"$request_tmp"
  mv "$request_tmp" "$request_file"
  kill -USR1 "$pid"

  start=$(date +%s)
  response="$support/exports/$request.json"
  while :; do
    if [ -s "$response" ] && grep -Eq '"requestId"[[:space:]]*:[[:space:]]*"'"$request"'"' "$response"; then
      echo "Fresh export: $response"
      if grep -Eq '"fresh"[[:space:]]*:[[:space:]]*true' "$response"; then
        exit 0
      fi
      echo "dev.sh export: response is incomplete; inspect errors in $response" >&2
      exit 1
    fi
    now=$(date +%s)
    [ $((now - start)) -lt "$timeout" ] || {
      echo "dev.sh export: timed out waiting for fresh request $request" >&2
      exit 1
    }
    sleep 0.1
  done
}

[ "$#" -gt 0 ] || { usage; exit 2; }
command=$1; shift
case "$command" in
  build) [ "$#" -eq 0 ] || { usage; exit 2; }; build ;;
  run) run_dev "$@" ;;
  stop) [ "$#" -eq 0 ] || { usage; exit 2; }; stop_dev ;;
  export) export_dev "$@" ;;
  *) usage; exit 2 ;;
esac
