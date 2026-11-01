# moocat

A MOO client built around local editing, on [tinyjs](https://tinyjs.app/):
`@edit` a verb or `@notedit` some text and it opens in a tab beside the
session, with MOO syntax highlighting; Ctrl+S sends it back and the MOO's
answer ("0 errors. Verb programmed." or the `Line n:` errors, marked in the
gutter) shows under the editor.

Speaks both local-editing protocols, ported from mudlet-mooedit's core.lua:

- **MCP 2.1** `dns-org-mud-moo-simpleedit` (ToastCore and other LambdaCore
  descendants with `$mcp`); starts when the server sends `#$#mcp version: 2.1`.
- **MCP 1.0** `#$# edit name: ... upload: ...` (older LambdaCores); ignored
  once an MCP 2.1 session is up.

On the MOO, turn local editing on once: `@edito +local`.
Clicking a verb in an object tab checks first: if the MOO has no MCP
simpleedit it offers the MOO's own editor; if your local editing is off it
offers to turn it on (`@edito +local`) and edit. The answer is kept per session.

## Run

    tinyjs dev        # from this folder
    tinyjs build      # dist/: a local-only build on NixOS (store-linked launcher)

tinyjs itself is packaged in ~/nix-config (nix/tinyjs.nix).

## Use

- Sessions: Connect opens the chosen world in a tab of its own, so several
  MOOs (or the same one twice) can be open at once. The tab is named after
  the world, with a dot (green when connected; hover for MCP) and a count of
  lines that came in while you were elsewhere. A session whose connection
  drops stays, grey: Connect with its world picked connects it again.
  Closing its tab disconnects.
- Commands, typed in the input and never sent to the MOO: `/help` lists
  them. `/close` (this session; the last one only disconnects),
  `/disconnect`, `/connect [world]` (again, or a world in a new tab),
  `/close-tabs` (every edit and object tab), `/enable` / `/disable` (object
  numbers as links in this session, whatever the MOO said), `/clear`,
  `/theme [name]`, `/worlds`. `//text` sends `/text` to the MOO.
- Tabs: each `@edit` opens one, just to the right of its session's tab, so
  it's clear which MOO it belongs to; object tabs likewise.
  Ctrl+Tab / Ctrl+PageDown and Ctrl+Shift+Tab / Ctrl+PageUp move between them,
  Alt+1…9 picks one, middle-click or Ctrl+W closes one.
- Object numbers (`#1024`) in the output are links once the MOO says you
  can program (moocat asks it, hidden, after you log in; never for guests),
  or after `/enable`: clicking one opens the
  object in its own tab, with its flags, parent chain, owner, location,
  description, and its properties and verbs grouped by the ancestor that
  defines them (its own open, inherited folded). Values are cut at 300
  characters. Clicking a verb `@edit`s it. It's read with one `;;` eval, so
  it needs a programmer bit; Refresh reads it again.
- SMud graphics: with "SMud graphics" ticked for a world (Rupert is), moocat
  tells the MOO it's an SMud client once you've logged in, and each picture
  the MOO opens (`#$# image:` lines) gets a window of its own, floating over
  moocat's: on Rupert, the Logic Puzzle (`@go #2003`, `start`) and HMaki
  (`@go #961`, `start`) play there. Lines, shapes, text, macros and the
  buttons and boxes on top are drawn as SMud did, and clicks go back to the
  MOO. The window follows the picture's size and name, shrinks it to fit if
  you make it smaller, and closing it (or Ctrl+W) closes it on the MOO; a
  disconnect closes them all.
- Worlds…: name, host, port, TLS, and a login line sent after connecting
  (`connect wizard`). Kept in `~/.local/share/app.moocat/worlds.json`, mode 600.
- Input: Enter or Send sends, Shift+Enter for several lines, Up/Down for
  history, PageUp/PageDown scroll the output. The output follows new lines
  unless you scroll up; then a button counts what's below. `connect name
  password` is echoed with the password starred and never saved in history.
- Editor: Ctrl+S send, Tab/Shift+Tab indent, Esc back to the session, Wrap
  toggles word wrap. Re-editing the same verb replaces its tab unless it has
  unsent changes (●). Revert goes back to the MOO's text. After a send the
  MOO's answer shows at the bottom, and lines with errors are marked.

## Layout

    src/backend/mcp.js     MCP 2.1 / 1.0 line filter (no I/O)
    src/backend/telnet.js  bytes -> lines, telnet options refused
    src/backend/inspect.js reading an object for its tab (eval + MOO literals)
    src/backend/smud.js    SMud graphics lines and macros (no I/O)
    src/backend/core.js    one session: a connection, MCP, inspecting, SMud
    src/backend/sessions.js several sessions at once, each event and call by sid
    src/backend/main.js    the connections, worlds, the api the page calls
    src/frontend/          the page: app.js, moo.js (highlighter), ansi.js,
                           canvas.js + smud.html/smud-win.js (SMud graphics
                           and their windows)

## Tests

    tjs=$(dirname $(readlink -f $(which tinyjs)))/../share/tinyjs/bin/tjs
    $tjs run test/mcp.test.js
    $tjs run test/inspect.test.js
    $tjs run test/ansi.test.js
    $tjs run test/smud.test.js
    $tjs run test/pixels.test.js
    $tjs run test/inspect.e2e.js 127.0.0.1 17777 "connect wizard" '#2'
    $tjs run test/e2e.js 127.0.0.1 17777 "connect wizard"
    $tjs run test/core.e2e.js 17777
    $tjs run test/sessions.e2e.js 17777

`e2e` needs a MOO: a throwaway ToastCore with
`docker run -d --name moo-mcp-test -p 127.0.0.1:17777:7777 wiredwizard/toaststunt:latest`.
# moocat
