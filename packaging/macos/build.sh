#!/bin/sh
# moocat for macOS: one universal .app (Apple Silicon and Intel) in a .dmg.
# Run on a Mac, from anywhere:
#
#   packaging/macos/build.sh             -> dist/moocat.app, dist/moocat-<ver>-*.dmg
#
# Unsigned (ad hoc) by default: it opens with right-click > Open the first
# time. To sign and notarize, set both of these first:
#   TINYJS_SIGN_IDENTITY="Developer ID Application: …"
#   TINYJS_NOTARY_PROFILE=<name>   (xcrun notarytool store-credentials <name> …)
set -eu
cd "$(dirname "$0")/../.."
TINYJS_VERSION=$(cat packaging/TINYJS_VERSION)

# the pinned tinyjs, in its own home so it leaves any other install alone
export TINYJS_HOME="$PWD/.tinyjs/$TINYJS_VERSION"
if [ ! -x "$TINYJS_HOME/tinyjs" ]; then
  curl -fsSL https://tinyjs.app/install | TINYJS_VERSION="v$TINYJS_VERSION" sh
fi
tinyjs() { "$TINYJS_HOME/tinyjs" "$@"; }

tinyjs build --universal --dmg
if [ -n "${TINYJS_SIGN_IDENTITY:-}" ] && [ -n "${TINYJS_NOTARY_PROFILE:-}" ]; then
  tinyjs notarize --dmg
fi
ls -d dist/*.app dist/*.dmg
