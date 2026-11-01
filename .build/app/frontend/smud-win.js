// One SMud graphic in its own window (opened by the backend on the MOO's
// create): asks for the lines it missed while loading, then draws whatever
// arrives. The window follows the graphic's size and name.
import { SmudCanvas } from './canvas.js';

const send = (pairs) => tiny.api.call('smudSend', { pairs }).catch(() => {});
let canvas = null;

function handle(msgs) {
  for (const m of msgs) {
    if (m.cmd !== 'create') { canvas?.handle(m); continue; }
    const w = Number(m.xsize) || 100, h = Number(m.ysize) || 100;
    if (canvas) {
      canvas.resize(w, h);
      canvas.rename(m.name || canvas.name);
      continue;
    }
    canvas = new SmudCanvas({ id: m.id, width: w, height: h, name: m.name, send });
    canvas.onrename = (name) => tiny.win.setTitle(name || 'SMud graphic');
    canvas.onresize = (cw, ch) => tiny.win.setSize(cw, ch);
    document.body.append(canvas.el);
    tiny.win.setTitle(m.name || 'SMud graphic');
  }
}

tiny.api.on('smud', ({ msgs }) => handle(msgs));
document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'w') { ev.preventDefault(); tiny.win.close(); }
});
const { msgs } = await tiny.api.call('smudReady');
handle(msgs);
