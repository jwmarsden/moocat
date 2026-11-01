// tjs run test/sessions.e2e.js [PORT]  — two sessions at once (sessions.js)
// against a real MOO (the local ToastCore with the SMud rooms loaded): each
// one's lines carry its sid, an SMud graphic's window is named for its
// session and a click from it reaches that session, and closing one leaves
// the other connected. And the programmer probe: a wizard can program, a
// non-programmer (made for the test, and recycled after) can't and never sees
// the MOO's "I don't understand that.", and a failed login isn't asked.
import { createSessions } from '../src/backend/sessions.js';

const port = Number(tjs.args[3] ?? 17777);
const pushed = [], opened = [];
const { api } = createSessions({
  push: (event, data) => pushed.push([event, data]),
  async connect(world) {
    const sock = await tjs.connect('tcp', world.host, world.port, { noDelay: true });
    const { readable, writable } = await sock.opened;
    const writer = writable.getWriter();
    return { readable, write: (b) => writer.write(b), close: () => sock.close() };
  },
  openGraphic: (win, o) => opened.push([win, o]),
  pushGraphic: () => {},
  closeGraphic: () => {},
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const linesOf = (sid) => pushed.filter(([e, d]) => e === 'out' && d.sid === sid).flatMap(([, d]) => d.lines.map((l) => l.text));
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };
const world = { name: 'Local', host: '127.0.0.1', port, login: 'connect wizard', smud: true };

const a = await api.open();
const b = await api.open();
check(a !== b, 'two sessions, two sids');
await api.connect({ world, sid: a });
await api.connect({ world: { ...world, login: 'connect rah', smud: false }, sid: b });
await sleep(2500);
check(api.sessions().filter((s) => s.connected).length === 2, 'both connected');
api.send({ sid: a, line: ';1 + 1' });
api.send({ sid: b, line: ';2 + 2' });
await sleep(800);
check(linesOf(a).includes('=> 2') && !linesOf(a).includes('=> 4'), "a's answer went to a only");
check(linesOf(b).includes('=> 4') && !linesOf(b).includes('=> 2'), "b's answer went to b only");

const stateOf = (sid) => api.sessions().find((x) => x.sid === sid);
check(stateOf(a).prog && stateOf(b).prog, 'the wizards can program');
check(!linesOf(a).some((l) => l.startsWith('MOOCAT:')), "the probe's answer was hidden");
api.send({ sid: a, line: ';;r = $wiz_utils:make_player("moocat_probe", ""); o = r[1]; o.programmer = 0; o.password = #2.password; return o;' });
await sleep(1000);
const c = await api.open();
await api.connect({ world: { ...world, login: 'connect moocat_probe', smud: false }, sid: c });
const d = await api.open();
await api.connect({ world: { ...world, login: 'connect nobody_at_all', smud: false }, sid: d });
await sleep(3500);
check(stateOf(c).connected && !stateOf(c).prog, "a non-programmer can't program");
check(!linesOf(c).some((l) => /I don't understand that/.test(l)), "and didn't see the probe's huh");
check(!stateOf(d).prog && linesOf(d).filter((l) => /I don't understand that/.test(l)).length === 0,
      "a failed login isn't probed");
api.close({ sid: c });
api.close({ sid: d });
await sleep(300);
api.send({ sid: a, line: ';;for p in (players()) if (p.name == "moocat_probe") recycle(p); endif endfor' });
await sleep(800);

api.send({ sid: a, line: ';move(player, $player_start)' }); await sleep(500);
api.send({ sid: a, line: ';move(player, $hanoi)' }); await sleep(2500);
const win = opened.find(([, o]) => o.title === 'Tower of Hanoi')?.[0];
check(win?.startsWith(`s${a}-`), "a's graphic window is named for a");
const ready = win && api.smudReady(null, null, { window: win });
check(ready?.msgs.some((m) => m.cmd === 'create'), 'its window found its session');
api.send({ sid: a, line: ';move(player, $player_start)' }); await sleep(1000);

api.close({ sid: a });
await sleep(500);
check(api.sessions().length === 1 && api.sessions()[0].sid === b && api.sessions()[0].connected, 'closing a left b connected');
api.send({ sid: b, line: ';3 + 3' }); await sleep(800);
check(linesOf(b).includes('=> 6'), 'b still answers');
api.close({ sid: b });
await sleep(300);
console.log(failed ? `${failed} failed` : 'all passed');
tjs.exit(failed ? 1 : 0);
