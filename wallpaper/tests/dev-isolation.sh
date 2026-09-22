#!/bin/sh
# Static guardrails for the dev launcher. The shared host source contains the production
# implementation by design; these checks focus on the separate bundle and launcher.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$here")

bundle_id=$( /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$root/DevInfo.plist" )
[ "$bundle_id" = "com.chaselean.desktop-habitats.dev" ] || {
  echo "FAIL: dev bundle id is not isolated" >&2; exit 1;
}
name=$( /usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$root/DevInfo.plist" )
[ "$name" = "Desktop Habitats Dev" ] || {
  echo "FAIL: dev app name is not isolated" >&2; exit 1;
}
! grep -Eq 'launchctl|osascript|Desktop Habitats\.app/|desktop-habitats\.png' "$root/dev.sh" || {
  echo "FAIL: dev launcher contains production install or still-image actions" >&2; exit 1;
}
! grep -Eq 'LaunchAgents|RunAtLoad|KeepAlive' "$root/dev.sh" || {
  echo "FAIL: dev launcher contains login-item setup" >&2; exit 1;
}
grep -q -- '--desktop' "$root/dev.sh"
grep -q -- '--snapshot' "$root/dev.sh"
# macOS rejects using an app's own bundle ID as a UserDefaults suite; it crashes at
# startup. The dev settings group must also stay separate from production defaults.
grep -q 'UserDefaults(suiteName: "com.chaselean.desktop-habitats.dev.preferences")' "$root/Wallpaper.swift"
grep -q 'screen.window.occlusionState.contains(.visible)' "$root/Wallpaper.swift"
printf '%s\n' 'ALL DEV LAUNCHER ISOLATION CHECKS PASSED'
