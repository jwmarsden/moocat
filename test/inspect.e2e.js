// tjs run test/inspect.e2e.js HOST PORT "connect wizard" [#obj]
// Reads an object with the Inspector against a real MOO.
import { Inspector } from '../src/backend/inspect.js';
import { Telnet } from '../src/backend/telnet.js';

const [host = '127.0.0.1', port = '17777', login = 'connect wizard', obj = '#1'] = tjs.args.slice(3);
const enc = new TextEncoder();
const sock = await tjs.connect('tcp', host, Number(port), { noDelay: true });
const { readable, writable } = await sock.opened;
const w = writable.getWriter();
const send = (l) => w.write(enc.encode(l + '\r\n'));
const shown = [];
const ins = new Inspector({ send });
const t = new Telnet({ line: (l) => { if (!ins.line(l)) shown.push(l); }, reply: () => {} });
(async () => { const r = readable.getReader(); while (true) { const { value, done } = await r.read(); if (done) break; t.feed(value); } })();
send(login);
await new Promise((r) => setTimeout(r, 1500));
const mark = shown.length;
try {
  const d = await ins.inspect(obj);
  console.log(d.name, d.obj, 'owner', d.owner, d.ownerName, 'parent', d.parent, 'flags', JSON.stringify(d.flags));
  console.log('ancestors', d.ancestors.map((a) => a.obj + ' ' + a.name).join(', '));
  console.log('description', JSON.stringify(d.description));
  console.log('props', d.properties.length, d.properties.slice(0, 3));
  console.log('verbs', d.verbs.length, d.verbs.slice(0, 3));
  console.log('notes', d.notes);
} catch (e) { console.log('ERROR', e.message); }
await new Promise((r) => setTimeout(r, 500));
console.log('shown during inspect:', JSON.stringify(shown.slice(mark)));
try { await ins.inspect('#999999'); } catch (e) { console.log('invalid ->', e.message); }
send('@quit');
tjs.exit(0);
