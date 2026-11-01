// Several sessions (core.js) at once, one per MOO connection, for a host
// that has one page: main.js (the tinyjs app) and src/web/web.js. Every
// event a session pushes carries its sid, and every call names the sid it's
// for; SMud windows are named "s<sid>-smud-<image>", so a call or close from
// one finds its session by the window alone.
//
// host: as createSession's (push, connect, openGraphic, pushGraphic,
// closeGraphic), for every session; connect(world, { push }) also gets a push
// that goes to that session's tab.
//
// api (the page's calls, as core.js's but each with { sid }):
//   open()                     => sid  a new session, not connected yet
//   connect({ world, sid? })   => sid  connects sid (again), or a new session
//   disconnect({ sid })        close({ sid })  (disconnects and forgets it)
//   send, upload, inspect, closeEdit   ({ sid, ... })
//   smudReady, smudSend        from a graphic's window: found by the window
//   sessions()                 => [{ sid, connected, world, mcp }]
import { createSession } from './core.js';

export function createSessions(host) {
  const sessions = new Map();  // sid -> session
  let nextSid = 1;

  function open() {
    const sid = nextSid++;
    const push = (event, data) => host.push(event, { ...data, sid });
    const session = createSession({
      ...host,
      push,
      // the host's connect gets this session's push too, for lines of its own
      connect: (world) => host.connect(world, { push }),
      winPrefix: `s${sid}-`,
    });
    sessions.set(sid, session);
    return sid;
  }

  function get(sid) {
    const s = sessions.get(Number(sid));
    if (!s) throw new Error('no such session');
    return s;
  }

  const ofWindow = (win) => sessions.get(Number(/^s(\d+)-/.exec(win ?? '')?.[1]));

  // calls the page makes about one session: passed on to it
  const forward = (method) => (params, ...rest) => get(params.sid).api[method](params, ...rest);

  const api = {
    open: () => open(),
    async connect({ world, sid }) {
      if (sid == null || !sessions.has(Number(sid))) sid = open();
      await get(sid).api.connect({ world });
      return sid;
    },
    disconnect: forward('disconnect'),
    close({ sid }) {
      const s = sessions.get(Number(sid));
      if (!s) return false;
      s.api.disconnect();
      sessions.delete(Number(sid));
      return true;
    },
    send: forward('send'),
    upload: forward('upload'),
    inspect: forward('inspect'),
    closeEdit: forward('closeEdit'),
    smudReady: (params, app, meta) => ofWindow(meta?.window)?.api.smudReady(params, app, meta) ?? { id: null, msgs: [] },
    smudSend: (params, app, meta) => ofWindow(meta?.window)?.api.smudSend(params, app, meta) ?? false,
    sessions: () => [...sessions].map(([sid, s]) => ({ sid, ...s.api.state() })),
  };

  // a graphic's window closed by the user
  const onWindowClosed = (win) => ofWindow(win)?.onWindowClosed(win);

  return { api, onWindowClosed };
}
