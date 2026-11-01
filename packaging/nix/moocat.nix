# moocat for Nix, built from this tree with the tinyjs from nix-config
# (~/nix-config/nix/tinyjs.nix, passed in). `tinyjs build` copies the
# launcher and the tjs runtime into dist/, already patched to store paths, so
# this only needs to wrap them.
#
#   moocat = pkgs.callPackage /home/jwm/Source/moocat/packaging/nix/moocat.nix {
#     tinyjs = pkgs.callPackage ./tinyjs.nix {};
#   };
{ lib, stdenv, tinyjs, makeWrapper, makeDesktopItem, copyDesktopItems
, glib-networking, gsettings-desktop-schemas }:

let
  root = ../..;
  info = lib.importJSON (root + "/tinyjs.json");
in
stdenv.mkDerivation {
  pname = "moocat";
  inherit (info) version;

  src = lib.cleanSourceWith {
    src = root;
    filter = path: type:
      let rel = lib.removePrefix (toString root + "/") (toString path); in
      !(lib.hasPrefix "dist" rel || lib.hasPrefix ".tinyjs" rel
        || lib.hasPrefix "node_modules" rel || lib.hasPrefix "packaging" rel
        || lib.hasPrefix "test" rel);
  };

  nativeBuildInputs = [ tinyjs makeWrapper copyDesktopItems ];

  # the binaries are tjs plus an appended bundle; strip would cut it off
  dontStrip = true;
  dontPatchELF = true;

  buildPhase = ''
    runHook preBuild
    export HOME=$TMPDIR
    tinyjs build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/moocat $out/bin $out/share/icons/hicolor/512x512/apps
    cp -r dist/. $out/share/moocat/
    cp dist/icon.png $out/share/icons/hicolor/512x512/apps/moocat.png
    # see tinyjs.nix for why these two
    makeWrapper $out/share/moocat/moocat $out/bin/moocat \
      --prefix XDG_DATA_DIRS : ${gsettings-desktop-schemas}/share/gsettings-schemas/${gsettings-desktop-schemas.name} \
      --prefix GIO_EXTRA_MODULES : ${glib-networking}/lib/gio/modules
    runHook postInstall
  '';

  # The app also writes ~/.local/share/applications/app.moocat.desktop when it
  # runs (pointing at its store path, so it goes stale after an upgrade until
  # moocat is run again). This one has the same id, and the user's copy wins,
  # so the menu shows one moocat either way.
  desktopItems = [
    (makeDesktopItem {
      name = info.id;
      desktopName = info.title;
      exec = "moocat %u";
      icon = "moocat";
      startupWMClass = info.id;
      categories = [ "Network" ];
    })
  ];

  meta = {
    description = "A MOO client";
    mainProgram = "moocat";
    platforms = [ "x86_64-linux" ];
  };
}
