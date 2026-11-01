# Packaging moocat

One setup per platform, all building the same tree with the same tinyjs
(`TINYJS_VERSION`; change it there and every build follows). The app's name,
id and version come from `../tinyjs.json`.

| Platform | Run | Makes | Where it builds |
|---|---|---|---|
| Debian / Ubuntu | `packaging/debian/build.sh` | `dist/publish/moocat_<ver>_amd64.deb` | a `debian:12` container (Docker or `DOCKER=podman`) |
| NixOS | `nix-build` / `callPackage` (below) | `$out/bin/moocat` | the Nix sandbox |
| macOS | `packaging/macos/build.sh` | `dist/moocat.app`, `dist/moocat-<ver>-*.dmg` | a Mac |
| Windows | `packaging\windows\build.ps1` | `dist\publish\moocat-<ver>-windows-x64.zip` | Windows x64 |

## Debian

Built inside Debian 12, so the package runs on Debian 12 and Ubuntu 22.04
or later (tinyjs's binaries need glibc 2.35; the script prints the newest
symbol used). Installs to `/opt/moocat`, with `/usr/bin/moocat`, the icon and
a menu entry. `sudo apt install ./dist/publish/moocat_0.1.0_amd64.deb` pulls
in WebKitGTK and the rest.

## Nix

`nix/moocat.nix` takes tinyjs as an argument: the one in nix-config
(`nix/tinyjs.nix`), which is patched for NixOS. In `configuration.nix`:

```nix
(pkgs.callPackage /home/jwm/Source/moocat/packaging/nix/moocat.nix {
  tinyjs = pkgs.callPackage ./tinyjs.nix {};
})
```

or to try it: `nix-build -E 'with import <nixpkgs> {}; callPackage ./packaging/nix/moocat.nix { tinyjs = callPackage ~/nix-config/nix/tinyjs.nix {}; }'`.
The result is wrapped with the GSettings schemas and glib-networking, as
tinyjs is (see tinyjs.nix for why).

## macOS and Windows

Both scripts install the pinned tinyjs into `.tinyjs/<version>/` in this
repo (gitignored), not over another install. On macOS the installer also
points the `tinyjs` on your PATH at it.

macOS builds one universal app. It's ad-hoc signed unless
`TINYJS_SIGN_IDENTITY` (a "Developer ID Application" certificate) and
`TINYJS_NOTARY_PROFILE` (`xcrun notarytool store-credentials`) are set, in
which case it's notarized too. Unsigned, it opens the first time with
right-click > Open.

Windows zips the app folder (`moocat.exe`, `launcher.exe`, `frontend\`);
it needs the WebView2 runtime, which Windows 11 has. Every platform's icon
is made from `assets/icon.png` (drawn in `assets/src/icon.svg`).

## The menu entry on Linux

A tinyjs app writes `~/.local/share/applications/app.moocat.desktop` itself
each time it runs, pointing at wherever it's running from. The Debian and Nix
packages ship one with the same id, so the menu shows one moocat; on NixOS
the user's copy points at a store path and catches up the next time moocat
runs after an upgrade.
