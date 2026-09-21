#!/bin/sh
# Build and run the deterministic tests for the AppKit-free lifecycle helpers, against the
# same Lifecycle.swift the app compiles. No Mac display or browser is needed.
#
# The wallpaper is macOS-only, so on any other host we say so explicitly and succeed
# (the JS tests still run). A real Mac must build and run these tests, and a missing
# swiftc there is a hard failure, not a silent skip.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

case "$(uname -s)" in
  Darwin)
    if ! command -v swiftc >/dev/null 2>&1; then
      echo "run.sh: FAIL: this machine is macOS but 'swiftc' was not found on PATH; cannot build the wallpaper lifecycle tests." >&2
      exit 1
    fi
    bin=$(mktemp -d)
    trap 'rm -rf "$bin"' EXIT
    swiftc "$here/../Lifecycle.swift" "$here/main.swift" -o "$bin/lifecycle-test"
    "$bin/lifecycle-test"
    ;;
  *)
    echo "run.sh: SKIP wallpaper lifecycle tests (this host runs $(uname -s), not macOS)."
    ;;
esac
