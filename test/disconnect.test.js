// tjs run test/disconnect.test.js  (from the repo root; tjs is tinyjs's bin/tjs)
// The "Disconnected" line has its own kind, so the page can put a Reconnect
// link on it: when the connection drops and on a disconnect, against a
// scripted link. A world's login goes again on connecting again.
import { createSessions } from '../src/backend/sessions.js';

let failed = 0;
function eq(got, want, what) {
  if (got !== want) {
    failed++;
    console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dec = new TextDecoder();
const pushed = [], written = [];
let drop;
const { api } = createSessions({
  push: (event, data) => pushed.push([event, data]),
  async connect() {
    const ended = new Promise((r) => { drop = () => r({ done: true }); });
    return {
      readable: { getReader: () => ({ read: () => ended, releaseLock() {}, cancel() {} }) },
      write: async (b) => { written.push(dec.decode(b)); },
      close: () => drop(),
    };
  },
  openGraphic() {},
  pushGraphic() {},
  closeGraphic() {},
});
const world = { name: 'Test', host: 'localhost', port: 7777, login: 'connect someone' };
const said = (sid) => pushed.filter(([e, d]) => e === 'out' && d.sid === sid).flatMap(([, d]) => d.lines);
const last = (sid) => said(sid).at(-1);

const sid = await api.open();
await api.connect({ world, sid });
await sleep(50);
eq(written.filter((l) => l.startsWith(world.login)).length, 1, 'the login went');

drop();
await sleep(50);
eq(last(sid)?.text, 'Disconnected from Test.', 'dropped: the line');
eq(last(sid)?.kind, 'disconnected', 'dropped: its kind');
eq(pushed.filter(([e]) => e === 'state').at(-1)[1].connected, false, 'dropped: not connected');

await api.connect({ world, sid });
await sleep(50);
eq(pushed.filter(([e]) => e === 'state').at(-1)[1].connected, true, 'again: connected');
eq(written.filter((l) => l.startsWith(world.login)).length, 2, 'again: the login went again');

api.disconnect({ sid });
await sleep(50);
eq(last(sid)?.text, 'Disconnected from Test.', 'disconnect: the line');
eq(last(sid)?.kind, 'disconnected', 'disconnect: its kind');
eq(said(sid).filter((l) => l.kind === 'disconnected').length, 2, 'one line for each');

console.log(failed ? `${failed} failed` : 'all passed');
tjs.exit(failed ? 1 : 0);
