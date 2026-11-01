// moocat's session, whatever it runs in: one MOO connection at a time, MCP
// local editing, object inspection and SMud graphics. The host (main.js for
// the tinyjs app, src/web/web.js for a web page) gives it a way to connect
// and somewhere to put things, and it pushes to the page:
//   'out'     { lines: [{ text, kind }] }  kind: null | 'sys' | 'err'
//   'partial' { text }        text after the last newline (a prompt), or ''
//   'edit'    { id, name, reference, type, protocol, lines }
//   'state'   { connected, world, mcp, prog }   mcp: 'none' | 'up' | 'edit'
//             prog: the player can program (asked once logged in; see inspect.js)
// Each SMud graphic the MOO opens gets a window of its own, pushed
//   'smud'    { msgs }  its lines, parsed (see smud.js)
//
// host: {
//   push(event, data)                      to the page
//   connect(world) => { readable, write(bytes), close() }
//   openGraphic(win, { title, width, height })
//   pushGraphic(win, event, data)
//   closeGraphic(win)
//   winPrefix                              names this session's windows apart
//                                          from others' (see sessions.js)
// }
import { Mcp } from './mcp.js';
import { Telnet } from './telnet.js';
import { Inspector } from './inspect.js';
import { HELLO, parseOob, oobLine } from './smud.js';

const enc = new TextEncoder();

// A world with SMud graphics on announces the client once the player is
// logged in: after the login line, or after a connect typed by hand.
const LOGIN = /^\s*co(?:n(?:n(?:e(?:c(?:t)?)?)?)?)?\s+(\S+)/i;
// The server's word that a login worked, its connect message: "*** Connected
// ***" on most MOOs, "*** DON'T PANIC ***" on Rupert. The first such line
// after a login line counts; then the MOO is asked whether the player can
// program. Not for guests: they can't, and Rupert asks a guest for a name
// next, which the question would answer.
const LOGGED_IN = /^\*\*\* .+ \*\*\*$/;

export function createSession(host) {
  let conn = null;          // { link, world, hello, prog, login }  login: a login sent, its *** not seen yet
  const edits = new Map();  // id -> edit, as sent to the page
  let nextEdit = 1;
  let partialTimer = null;
  let pendingOut = [];
  let outTimer = null;

  // Lines go to the page in batches: a big @list or @dump is thousands.
  function out(text, kind = null) {
    pendingOut.push({ text, kind });
    outTimer ??= setTimeout(() => {
      outTimer = null;
      const lines = pendingOut;
      pendingOut = [];
      host.push('out', { lines });
    }, 16);
  }

  function stateOf() {
    return { connected: !!conn, world: conn?.world.name ?? null,
             mcp: !mcp.key ? 'none' : mcp.canEdit ? 'edit' : 'up', prog: !!conn?.prog };
  }

  function state() {
    host.push('state', stateOf());
  }

  function sendLine(line) {
    if (!conn) throw new Error('not connected');
    Promise.resolve(conn.link.write(enc.encode(line + '\r\n'))).catch(() => {});
  }

  const mcp = new Mcp({
    send: sendLine,
    log: (text) => { out(text, 'sys'); state(); },
    edit(e) {
      const id = nextEdit++;
      edits.set(id, e);
      host.push('edit', { id, name: e.name, reference: e.reference, type: e.type,
                          protocol: e.protocol, lines: e.lines });
    },
  });

  const inspector = new Inspector({ send: sendLine });

  const telnet = new Telnet({
    line(text) {
      if (text.startsWith('#$# image: ')) {
        const msg = parseOob(text);
        if (msg) { smudLine(msg); return; }
      }
      if (inspector.line(text)) return;
      if (conn?.login && LOGGED_IN.test(text)) afterLogin();
      const r = mcp.line(text);
      if (r === 'hide') return;
      out(r === 'unquote' ? text.slice(3) : text);
    },
    reply(bytes) {
      if (conn) Promise.resolve(conn.link.write(new Uint8Array(bytes))).catch(() => {});
    },
  });

  // After each chunk: a line without its newline yet is shown as the prompt,
  // unless more arrives quickly (most partial lines are just a split packet).
  function afterChunk() {
    clearTimeout(partialTimer);
    const text = telnet.partial;
    if (!text) { host.push('partial', { text: '' }); return; }
    partialTimer = setTimeout(() => host.push('partial', { text: telnet.partial }), 150);
  }

  async function readLoop(c) {
    const reader = c.link.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || conn !== c) break;
        telnet.feed(value);
        afterChunk();
      }
    } catch (e) {
      if (conn === c) out('Connection error: ' + e.message, 'err');
    }
    if (conn === c) {
      if (telnet.partial) telnet.flush();
      conn = null;
      mcp.reset();
      closeAllGraphics();
      out(`Disconnected from ${c.world.name}.`, 'sys');
      host.push('partial', { text: '' });
      state();
    }
  }

  function afterSend(line) {
    const c = conn;
    const m = c && LOGIN.exec(line);
    if (!m) return;
    c.login = /^guest$/i.test(m[1]) ? 'guest' : 'player';
    if (!c.world.smud || c.hello) return;
    c.hello = true;
    setTimeout(() => { if (conn === c) sendLine(HELLO); }, 1500);
  }

  // once the welcome has had a moment to arrive
  function afterLogin() {
    const c = conn;
    const guest = c.login === 'guest';
    c.login = null;  // this login's: the next *** line isn't
    if (guest) return;
    setTimeout(() => {
      if (conn === c && !c.prog) inspector.probe().then((p) => { if (conn === c) { c.prog = p; state(); } });
    }, 1000);
  }

  // --- SMud graphics windows --------------------------------------------
  // A create opens a window; the graphic's lines wait in its queue until the
  // window has loaded and asked for them (smudReady), then go in batches. A
  // destroy closes the window; the user closing it tells the MOO. Queries
  // about a graphic we don't have are answered as SMud would.

  const graphics = new Map();     // image id -> { win, ready, queue, timer }
  const graphicWins = new Map();  // window id -> image id

  function smudLine(msg) {
    let g = graphics.get(msg.id);
    if (msg.cmd === 'create' && !g) {
      const win = (host.winPrefix ?? '') + 'smud-' + msg.id;
      g = { win, ready: false, queue: [msg], timer: null };
      graphics.set(msg.id, g);
      graphicWins.set(win, msg.id);
      host.openGraphic(win, { title: msg.name || 'SMud graphic',
                              width: Number(msg.xsize) || 100, height: Number(msg.ysize) || 100 });
      return;
    }
    if (!g) {
      if (msg.cmd === 'valid') sendLine(oobLine([['id', msg.task], ['valid', 0]]));
      else if (msg.cmd === 'class' && msg.gettype != null) sendLine(oobLine([['comptype', msg.name], ['id', msg.task], ['type', 'none']]));
      return;
    }
    if (msg.cmd === 'destroy') { closeGraphic(msg.id); return; }
    g.queue.push(msg);
    if (!g.ready) return;
    // a query (it has a task id) has a MOO task waiting on it: send it, and
    // everything queued before it, now rather than on the timer
    if (msg.task != null) { clearTimeout(g.timer); flushGraphic(g); }
    else g.timer ??= setTimeout(() => flushGraphic(g), 16);
  }

  function flushGraphic(g) {
    g.timer = null;
    const msgs = g.queue;
    g.queue = [];
    if (msgs.length) host.pushGraphic(g.win, 'smud', { msgs });
  }

  // Closed by the MOO or by a disconnect: nothing to tell the MOO.
  function closeGraphic(id) {
    const g = graphics.get(id);
    if (!g) return;
    graphics.delete(id);
    graphicWins.delete(g.win);
    clearTimeout(g.timer);
    try { host.closeGraphic(g.win); } catch {}
  }

  function closeAllGraphics() {
    for (const id of [...graphics.keys()]) closeGraphic(id);
  }

  // Closed by the user.
  function onWindowClosed(win) {
    const id = graphicWins.get(win);
    if (id == null) return;
    graphicWins.delete(win);
    clearTimeout(graphics.get(id)?.timer);
    graphics.delete(id);
    if (conn) sendLine(oobLine([['image', id], ['closed', 1]]));
  }

  // --- api --------------------------------------------------------------

  const api = {
    async connect({ world }) {
      if (conn) api.disconnect();
      out(`Connecting to ${world.name} (${world.host}:${world.port}${world.tls ? ', TLS' : ''})…`, 'sys');
      let link;
      try {
        link = await host.connect(world);
      } catch (e) {
        out(`Couldn't connect: ${e.message}`, 'err');
        throw e;
      }
      telnet.buf = [];
      mcp.reset();
      const c = { link, world, hello: false, prog: false, login: null };
      conn = c;
      state();
      readLoop(c);
      if (world.login) { sendLine(world.login); afterSend(world.login); }
      return true;
    },

    disconnect() {
      const c = conn;
      if (!c) return false;
      conn = null;
      mcp.reset();
      closeAllGraphics();
      try { c.link.close(); } catch {}
      out(`Disconnected from ${c.world.name}.`, 'sys');
      host.push('partial', { text: '' });
      state();
      return true;
    },

    send({ line }) {
      sendLine(line);
      afterSend(line);
      return true;
    },

    // A graphic's window has loaded: what it has missed, and which it is.
    smudReady(_, _app, meta) {
      const id = graphicWins.get(meta?.window);
      const g = graphics.get(id);
      if (!g) return { id: null, msgs: [] };
      g.ready = true;
      const msgs = g.queue;
      g.queue = [];
      return { id, msgs };
    },

    // An SMud graphics line from a graphic's window: a click, or a query's answer.
    smudSend({ pairs }) {
      sendLine(oobLine(pairs));
      return true;
    },

    // Send an edit's text back to the MOO.
    upload({ id, text }) {
      const e = edits.get(id);
      if (!e) throw new Error('no such edit');
      if (!conn) throw new Error('not connected');
      mcp.upload(e, text.replace(/\r/g, '').split('\n'));
      return true;
    },

    // An object's name, description, properties and verbs (see inspect.js).
    inspect({ obj }) {
      if (!conn) throw new Error('not connected');
      return inspector.inspect(obj);
    },

    closeEdit({ id }) {
      edits.delete(id);
      return true;
    },

    state: () => stateOf(),
  };

  return { api, onWindowClosed };
}
