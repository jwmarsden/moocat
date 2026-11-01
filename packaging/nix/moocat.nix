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
  # A tinyjs app on Linux writes ~/.local/share/applications/<id>.desktop
  # every time it runs, pointing at the copy that's running, and that file
  # wins over this package's. Here the running copy is a store path, so after
  # an upgrade the menu would keep opening the old version. This build's
  # tinyjs leaves that out (no setting turns it off), so the menu entry below,
  # which runs whatever bin/moocat is now, is the only one.
  tinyjs' = tinyjs.overrideAttrs (old: {
    postInstall = (old.postInstall or "") + ''
      substituteInPlace $out/share/tinyjs/runtime/bridge.js \
        --replace-fail 'if (IS_LINUX && haveInstancePipe) {' 'if (false) {'
    '';
  });
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
        || lib.hasPrefix "test" rel || lib.hasPrefix ".build" rel);
  };

  nativeBuildInputs = [ tinyjs' makeWrapper copyDesktopItems ];

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

  # the menu entry: the app doesn't write its own here (see tinyjs' above)
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
