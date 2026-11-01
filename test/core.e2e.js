// tjs run test/core.e2e.js [PORT]  — the session (core.js) against a real MOO
// (the local ToastCore with the SMud rooms loaded): log in with SMud on, an
// eval comes back, walking into the Tower of Hanoi opens its graphic and its
// lines arrive, a click is answered, disconnect closes the graphic.
import { createSession } from '../src/backend/core.js';

const port = Number(tjs.args[3] ?? 17777);
const pushed = [], opened = [], graphic = [], closed = [];
const session = createSession({
  push: (event, data) => pushed.push([event, data]),
  async connect(world) {
    const sock = await tjs.connect('tcp', world.host, world.port, { noDelay: true });
    const { readable, writable } = await sock.opened;
    const writer = writable.getWriter();
    return { readable, write: (b) => writer.write(b), close: () => sock.close() };
  },
  openGraphic: (win, o) => opened.push([win, o]),
  pushGraphic: (win, event, data) => graphic.push(...data.msgs),
  closeGraphic: (win) => closed.push(win),
});
const { api } = session;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = () => pushed.filter(([e]) => e === 'out').flatMap(([, d]) => d.lines.map((l) => l.text));
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

await api.connect({ world: { name: 'Local', host: '127.0.0.1', port, login: 'connect wizard', smud: true } });
await sleep(2500);
check(api.state().connected, 'connected');
api.send({ line: ';1 + 41' }); await sleep(800);
check(lines().some((l) => l === '=> 42'), 'an eval came back');
api.send({ line: ';move(player, $player_start)' }); await sleep(500);
api.send({ line: ';move(player, $hanoi)' }); await sleep(2500);
const win = opened.find(([, o]) => o.title === 'Tower of Hanoi')?.[0];
check(!!win, 'walking into the Hanoi room opened its graphic');
const ready = win && api.smudReady(null, null, { window: win });
check(ready?.msgs.some((m) => m.cmd === 'create'), 'the graphic got its lines');
if (ready?.id) { api.smudSend({ pairs: [['image', ready.id], ['click', 'left'], ['clickx', 115], ['clicky', 250]] }); await sleep(800); }
check(graphic.some((m) => m.cmd === 'macro'), 'a click on a peg was drawn');
api.send({ line: ';move(player, $player_start)' }); await sleep(1200);
check(closed.includes(win), 'leaving the room closed the graphic');
api.disconnect(); await sleep(300);
check(!api.state().connected && lines().at(-1)?.startsWith('Disconnected'), 'disconnected');
console.log(failed ? `${failed} failed` : 'all passed');
tjs.exit(failed ? 1 : 0);
