// moocat in a web page: the same sessions (backend/sessions.js) and the same page
// (frontend/app.js), with the tinyjs bridge played by this file. A browser
// can't open a telnet connection itself, so the host page supplies open(world),
// a WebSocket to a relay that passes bytes to the MOO and back. SMud graphics
// open as panels in the page (draggable, resizable) rather than as windows.
//
//   import { startWeb } from '.../web/web.js';
//   await startWeb({ root, worlds, open, hint });
//
// root: the element to fill with moocat's page. worlds: [{ name, smud, ... }]
// (no editing here). open(world) => a WebSocket, open, binaryType arraybuffer.
// hint: a line to show under the MOO's welcome (how to log in), if any.
// themes: the colour themes to offer, the default first (see app.js).
import { createSessions } from '../backend/sessions.js';
import { SmudCanvas } from '../frontend/canvas.js';
import { MARKUP } from './markup.js';

export async function startWeb({ root, worlds, open, hint = '', themes }) {
  const listeners = new Map();  // event -> [fn]
  const push = (event, data) => { for (const fn of listeners.get(event) ?? []) fn(data); };
  const panels = new Map();     // window id -> panel

  const sessions = createSessions({
    push,

    async connect(world, { push }) {
      const ws = await open(world);
      ws.binaryType = 'arraybuffer';
      let ended = false;
      let hinted = !hint;
      const readable = new ReadableStream({
        start(ctrl) {
          ws.addEventListener('message', (ev) => {
            if (ended) return;
            ctrl.enqueue(new Uint8Array(ev.data));
            // under the MOO's welcome screen, which comes in a few pieces
            if (!hinted) {
              hinted = true;
              setTimeout(() => push('out', { lines: [{ text: hint, kind: 'sys' }] }), 400);
            }
          });
          ws.addEventListener('close', (ev) => {
            if (ended) return;
            ended = true;
            if (ev.reason) push('out', { lines: [{ text: ev.reason, kind: 'err' }] });
            ctrl.close();
          });
        },
      });
      return {
        readable,
        write: (bytes) => { if (ws.readyState === WebSocket.OPEN) ws.send(bytes); },
        close: () => ws.close(),
      };
    },

    openGraphic: (win, opts) => openPanel(win, opts),
    pushGraphic: (win, event, data) => panels.get(win)?.handle(data.msgs),
    closeGraphic: (win) => panels.get(win)?.remove(),
  });

  const api = {
    ...sessions.api,
    worlds: () => worlds,
    saveWorlds: () => { throw new Error('worlds are fixed here'); },
  };

  // what app.js (and nothing else) expects of tinyjs
  globalThis.tiny = {
    api: {
      call: async (method, params) => api[method](params ?? {}, null, {}),
      on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    },
    win: { setTitle: (title) => { document.title = title.replace(/^moocat/, 'Moocat'); } },
    dialog: { alert: async (text) => alert(text) },
    app: { shell: { open: (url) => window.open(url, '_blank', 'noopener') } },
  };

  // --- SMud panels --------------------------------------------------------

  let top = 10;
  let cascade = 0;

  function openPanel(win, { title, width, height }) {
    const el = document.createElement('section');
    el.className = 'smudpanel';
    el.innerHTML = '<header><span class="title"></span><button type="button" title="Close">×</button></header><div class="body"></div>';
    const titleEl = el.querySelector('.title');
    const body = el.querySelector('.body');
    titleEl.textContent = title;
    const size = (w, h) => {
      body.style.width = Math.min(w, innerWidth - 24) + 'px';
      body.style.height = Math.min(h, innerHeight - 64) + 'px';
    };
    size(width, height);
    const off = 24 * (cascade++ % 8);
    el.style.left = Math.max(8, Math.min(innerWidth - width - 16, (innerWidth - width) / 2 + off)) + 'px';
    el.style.top = Math.max(8, 60 + off) + 'px';
    const raise = () => { el.style.zIndex = String(++top); };
    raise();
    el.addEventListener('pointerdown', raise);

    // drag by the title bar
    const bar = el.querySelector('header');
    bar.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button')) return;
      const x0 = ev.clientX - el.offsetLeft, y0 = ev.clientY - el.offsetTop;
      bar.setPointerCapture(ev.pointerId);
      const move = (e) => {
        el.style.left = Math.max(0, Math.min(innerWidth - 60, e.clientX - x0)) + 'px';
        el.style.top = Math.max(0, Math.min(innerHeight - 30, e.clientY - y0)) + 'px';
      };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });

    let canvas = null;
    const panel = {
      handle(msgs) {
        for (const m of msgs) {
          if (m.cmd !== 'create') { canvas?.handle(m); continue; }
          const w = Number(m.xsize) || 100, h = Number(m.ysize) || 100;
          if (canvas) { canvas.resize(w, h); canvas.rename(m.name || canvas.name); continue; }
          canvas = new SmudCanvas({ id: m.id, width: w, height: h, name: m.name,
                                    send: (pairs) => sessions.api.smudSend({ pairs }, null, { window: win }) });
          canvas.onrename = (name) => { titleEl.textContent = name || 'SMud graphic'; };
          canvas.onresize = (cw, ch) => size(cw, ch);
          body.append(canvas.el);
        }
      },
      remove() { el.remove(); panels.delete(win); },
    };
    el.querySelector('header button').addEventListener('click', () => {
      panel.remove();
      sessions.onWindowClosed(win);
    });
    panels.set(win, panel);
    root.append(el);
    // as smud-win.js does once its page has loaded: what it missed
    const { msgs } = sessions.api.smudReady(null, null, { window: win });
    panel.handle(msgs);
  }

  // --- the page -------------------------------------------------------------

  root.innerHTML = MARKUP;
  root.classList.add('moocat-web');
  if (themes) globalThis.moocatThemes = themes;
  await import('../frontend/app.js');
  return { api };
}
