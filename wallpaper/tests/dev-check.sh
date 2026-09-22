#!/bin/sh
# Compile the shared production host plus the isolated dev entry point, then run the
# AppKit-free policy tests. No app is launched by this check.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case "$(uname -s)" in
  Darwin)
    command -v swiftc >/dev/null 2>&1 || {
      echo "dev-check.sh: FAIL: swiftc is missing on macOS" >&2; exit 1;
    }
    swiftc -typecheck \
      "$here/../DevMain.swift" "$here/../DevSupport.swift" \
      "$here/../Wallpaper.swift" "$here/../Lifecycle.swift" \
      -framework Cocoa -framework WebKit -framework IOKit
    bin=$(mktemp -d)
    trap 'rm -rf "$bin"' EXIT
    swiftc "$here/../DevSupport.swift" "$here/dev-isolation.swift" -o "$bin/dev-isolation"
    "$bin/dev-isolation"
    echo "dev-check.sh: shared production/dev Swift typecheck passed."
    ;;
  *)
    echo "dev-check.sh: SKIP native dev Swift checks (this host runs $(uname -s), not macOS)."
    ;;
esac
