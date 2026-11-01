// tjs run test/e2e.js HOST PORT "connect wizard"
// Against a real MOO, with the backend's own Telnet and Mcp: log in, wait for
// MCP 2.1, @edit a verb, change it, send it back, @list it. A throwaway
// ToastCore: docker run -d --name moo-mcp-test -p 127.0.0.1:17777:7777 wiredwizard/toaststunt:latest
import { Mcp } from '../src/backend/mcp.js';
import { Telnet } from '../src/backend/telnet.js';

const [host = '127.0.0.1', port = '17777', login = 'connect wizard'] = tjs.args.slice(3);
const enc = new TextEncoder();
const sock = await tjs.connect('tcp', host, Number(port), { noDelay: true });
const { readable, writable } = await sock.opened;
const writer = writable.getWriter();
const send = (l) => writer.write(enc.encode(l + '\r\n'));

const shown = [];
let edit = null;
const mcp = new Mcp({ send, edit: (e) => { edit = e; }, log: (t) => console.log('mcp:', t) });
const telnet = new Telnet({
  line(t) { if (mcp.line(t) !== 'hide') shown.push(t); },
  reply: (b) => writer.write(new Uint8Array(b)),
});
(async () => {
  const r = readable.getReader();
  while (true) {
    const { value, done } = await r.read();
    if (done) break;
    telnet.feed(value);
  }
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, f, ms = 8000) {
  for (let t = 0; t < ms; t += 100) { if (f()) return; await sleep(100); }
  console.log('TIMEOUT waiting for', what, '\n', shown.slice(-15).join('\n'));
  tjs.exit(1);
}

send(login);
await until('MCP simpleedit', () => mcp.canEdit);
console.log('MCP 2.1 up, simpleedit', mcp.versions['dns-org-mud-moo-simpleedit']);
send('@edito +local');
send('@verb me:moocat_test this none this');
await sleep(500);
send('@edit me:moocat_test');
await until('the edit', () => edit);
console.log('edit:', edit.reference, edit.type, edit.lines);
const mark = shown.length;
mcp.upload(edit, ['"moocat was here";', 'return 42;']);
await until('programmed', () => shown.slice(mark).some((l) => /programmed|errors?\./i.test(l)));
console.log('result:', shown.slice(mark).join(' | '));
const mark2 = shown.length;
send(';me:moocat_test()');
await until('call', () => shown.slice(mark2).some((l) => /=>/.test(l)));
console.log('call:', shown.slice(mark2).join(' | '));
// a parse error comes back as "Line n: ..."
edit = null;
send('@edit me:moocat_test');
await until('the edit again', () => edit);
const mark3 = shown.length;
mcp.upload(edit, ['return 42', 'x = ;']);
await until('errors', () => shown.slice(mark3).some((l) => /not programmed|error/i.test(l)));
console.log('bad send:', shown.slice(mark3).join(' | '));
send('@rmverb me:moocat_test');
await sleep(300);
send('@quit');
await sleep(300);
const ok = shown.slice(mark2).some((l) => /=> 42/.test(l));
console.log(ok ? 'e2e passed' : 'e2e FAILED');
tjs.exit(ok ? 0 : 1);
