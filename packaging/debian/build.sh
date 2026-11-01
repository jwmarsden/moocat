#!/bin/sh
# moocat as a .deb, built in a Debian 12 container (so the package runs on
# Debian 12 / Ubuntu 22.04 and later: tinyjs's binaries need glibc 2.35).
#
#   packaging/debian/build.sh            -> dist/publish/moocat_<ver>_amd64.deb
#
# Needs docker (or podman: DOCKER=podman). Installs into /opt/moocat, with
# /usr/bin/moocat, a menu entry and the icon.
set -eu
cd "$(dirname "$0")/../.."
DOCKER=${DOCKER:-docker}
TINYJS_VERSION=$(cat packaging/TINYJS_VERSION)
mkdir -p dist/publish

"$DOCKER" run --rm -i \
  -v "$PWD:/src:ro" -v "$PWD/dist/publish:/out" \
  -e TINYJS_VERSION="v$TINYJS_VERSION" -e OWNER="$(id -u):$(id -g)" \
  debian:12 sh -eu <<'IN'
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -qq -y --no-install-recommends ca-certificates curl python3 binutils \
  libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libxtst6 libpipewire-0.3-0 libffi8 >/dev/null
# a stalled GitHub download hangs the installer: give it a few tries
for try in 1 2 3; do
  timeout 300 sh -c 'curl -fsSL --retry 3 https://tinyjs.app/install | sh' >/dev/null && break
  [ $try = 3 ] && exit 1
done
export PATH="$HOME/.local/bin:$HOME/.tinyjs/bin:$PATH"

cp -r /src /build && cd /build && rm -rf dist .tinyjs
tinyjs build
# the newest glibc symbol used; Debian 12 has 2.36
objdump -T dist/moocat dist/launcher 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1

VERSION=$(python3 -c 'import json; print(json.load(open("tinyjs.json"))["version"])')
P=/pkg
mkdir -p $P/DEBIAN $P/opt/moocat $P/usr/bin $P/usr/share/applications \
  $P/usr/share/icons/hicolor/512x512/apps
cp -r dist/. $P/opt/moocat/
ln -s /opt/moocat/moocat $P/usr/bin/moocat
cp dist/icon.png $P/usr/share/icons/hicolor/512x512/apps/moocat.png
cp packaging/debian/app.moocat.desktop $P/usr/share/applications/
sed "s/@VERSION@/$VERSION/; s/@SIZE@/$(du -sk $P/opt | cut -f1)/" packaging/debian/control > $P/DEBIAN/control
cp packaging/debian/postinst packaging/debian/postrm $P/DEBIAN/
chmod 755 $P/DEBIAN/postinst $P/DEBIAN/postrm
dpkg-deb --root-owner-group -Zxz --build $P /out/moocat_${VERSION}_amd64.deb
chown "$OWNER" /out/moocat_${VERSION}_amd64.deb
IN
ls -l dist/publish/*.deb
