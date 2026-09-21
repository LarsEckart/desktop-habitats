#!/bin/sh
# Typecheck the Swift host sources (main.swift, Wallpaper.swift, Lifecycle.swift).
# The wallpaper is macOS-only, so on any other host we say so explicitly and succeed
# (the JS checks still run). A real Mac must typecheck, and a missing swiftc there is a
# hard failure, not a silent skip.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

case "$(uname -s)" in
  Darwin)
    if ! command -v swiftc >/dev/null 2>&1; then
      echo "check.sh: FAIL: this machine is macOS but 'swiftc' was not found on PATH; cannot typecheck the wallpaper Swift host." >&2
      exit 1
    fi
    swiftc -typecheck "$here/../main.swift" "$here/../Wallpaper.swift" "$here/../Lifecycle.swift"
    echo "check.sh: wallpaper Swift typecheck passed."
    ;;
  *)
    echo "check.sh: SKIP wallpaper Swift typecheck (this host runs $(uname -s), not macOS)."
    ;;
esac
