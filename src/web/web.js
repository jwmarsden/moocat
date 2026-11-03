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

// --- why a connection ended -------------------------------------------------
// What the page saw, for the line shown when the relay's WebSocket closes:
// sleeps (a timer that fires late: the machine or the tab was asleep) and the
// browser going offline, with when. Kept for the last hour.
const events = [];
const note = (what, word = 'at') => {
  events.push({ at: Date.now(), what, word });
  while (events.length && events[0].at < Date.now() - 3600_000) events.shift();
};
let tick = Date.now();
setInterval(() => {
  const gap = Date.now() - tick;
  if (gap > 30_000) note(`asleep for ${ago(gap)}`, 'until');  // noticed on waking
  tick = Date.now();
}, 5_000);
addEventListener('offline', () => note('offline'));
addEventListener('online', () => note('back online'));

// 75 s -> "1m 15s"
function ago(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// what a close code means here (the relay's own closes carry a reason as well)
const CLOSES = {
  1000: 'closed by the relay',
  1001: 'the page or the relay went away',
  1006: 'dropped without a goodbye: the network, a sleep, or a proxy cut it',
  1011: 'the relay hit an error',
  1012: 'the relay restarted',
};

function whyClosed(ev, opened, lastData) {
  const now = Date.now();
  const seen = events.filter((e) => e.at >= opened).map((e) => `${e.what} ${e.word} ${clock(e.at)}`);
  return `Connection lost at ${clock(now)}: ${CLOSES[ev.code] ?? 'closed'} (code ${ev.code}). ` +
    `Connected ${ago(now - opened)}, last from the MOO ${ago(now - lastData)} ago` +
    (seen.length ? `; the page was ${seen.join(', ')}` : '') + '.';
}

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
      const opened = Date.now();
      let lastData = opened;
      let leaving = false;  // we closed it: nothing to explain
      const readable = new ReadableStream({
        start(ctrl) {
          ws.addEventListener('message', (ev) => {
            if (ended) return;
            lastData = Date.now();
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
            const lines = [];
            if (ev.reason) lines.push({ text: ev.reason, kind: 'err' });
            if (!leaving) {
              const why = whyClosed(ev, opened, lastData);
              console.info(`[moocat] ${world.name}: ${why}${ev.reason ? ' ' + ev.reason : ''}`);
              lines.push({ text: why, kind: 'sys' });
            }
            if (lines.length) push('out', { lines });
            ctrl.close();
          });
        },
      });
      return {
        readable,
        write: (bytes) => { if (ws.readyState === WebSocket.OPEN) ws.send(bytes); },
        close: () => { leaving = true; ws.close(); },
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
