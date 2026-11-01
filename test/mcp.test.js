// tjs run test/mcp.test.js  (from the repo root; tjs is tinyjs's bin/tjs)
// The protocol, against a scripted server. Ported from mudlet-mooedit's
// test/test_core.lua.
import { Mcp, parseKeyvals, commonVersion } from '../src/backend/mcp.js';

let failed = 0;
function eq(got, want, what) {
  if (got !== want) {
    failed++;
    console.log(`FAIL ${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// keyval parsing
const kv = parseKeyvals('reference: "#2:hello" name: "Wizard:hello" type: moo-code content*: "" _data-tag: 793');
eq(kv.reference, '#2:hello', 'quoted value');
eq(kv.type, 'moo-code', 'bare value');
eq(kv['content*'], '', 'multiline key');
eq(kv['_data-tag'], '793', 'data tag');
eq(parseKeyvals('a: "say \\"hi\\" \\\\o/"').a, 'say "hi" \\o/', 'escapes');
eq(parseKeyvals('a: "unterminated'), null, 'unterminated quote');
eq(commonVersion('1.0', '2.0', '1.0', '1.0'), '1.0', 'common version');
eq(commonVersion('2.1', '2.1', '1.0', '2.0'), null, 'no common version');

// a 2.1 session against a scripted server
let sent = [], edits = [];
const s = new Mcp({ send: (l) => sent.push(l), edit: (e) => edits.push(e) });
eq(s.line('Hello there'), null, 'ordinary line');
eq(s.line('#$#mcp-negotiate-can x package: foo'), null, '#$# before a session is shown');
eq(s.line('#$#mcp version: 2.1 to: 2.1'), 'hide', 'mcp start');
const key = s.key;
eq(sent[0], `#$#mcp authentication-key: ${key} version: 2.1 to: 2.1`, 'handshake');
eq(sent.at(-1), `#$#mcp-negotiate-end ${key}`, 'negotiate end sent');
s.line(`#$#mcp-negotiate-can ${key} package: mcp-negotiate min-version: 1.0 max-version: 2.0`);
s.line(`#$#mcp-negotiate-can ${key} package: dns-org-mud-moo-simpleedit min-version: 1.0 max-version: 1.0`);
s.line(`#$#mcp-negotiate-can ${key} package: mcp-cord min-version: 1.0 max-version: 1.0`);
s.line(`#$#mcp-negotiate-end ${key}`);
eq(s.versions['dns-org-mud-moo-simpleedit'], '1.0', 'simpleedit agreed');
eq(s.versions['mcp-cord'], undefined, 'unsupported package not agreed');
eq(s.line('#$"#$# not a message'), 'unquote', 'quoted line');
eq(s.line('#$#dns-org-mud-moo-simpleedit-content WRONGKEY reference: x content*: "" _data-tag: 1'), 'hide', 'spoof hidden');
eq(edits.length, 0, 'spoof ignored');
s.line(`#$#dns-org-mud-moo-simpleedit-content ${key} reference: "#2:hello" name: "Wizard:hello" type: moo-code content*: "" _data-tag: 55`);
s.line('#$#* 55 content: player:tell("Hello, \\"world\\"");');
s.line('#$#* 55 content: ');
s.line('#$#* 55 content: return 1;');
eq(edits.length, 0, 'not before the end');
s.line('#$#: 55');
eq(edits.length, 1, 'edit opened');
const e = edits[0];
eq(e.reference, '#2:hello', 'reference');
eq(e.type, 'moo-code', 'type');
eq(e.lines.length, 3, 'line count');
eq(e.lines[0], 'player:tell("Hello, \\"world\\"");', 'line kept verbatim');
eq(e.lines[1], '', 'blank line kept');

sent = [];
s.upload(e, ['return 2;', '']);
const head = new RegExp(`^#\\$#dns-org-mud-moo-simpleedit-set ${key} reference: "#2:hello" type: moo-code content\\*: "" _data-tag: (\\d+)$`).exec(sent[0]);
eq(!!head, true, 'set header: ' + sent[0]);
const tag = head?.[1];
eq(sent[1], `#$#* ${tag} content: return 2;`, 'set line');
eq(sent[2], `#$#* ${tag} content: `, 'set blank line');
eq(sent[3], `#$#: ${tag}`, 'set end');
eq(s.line('#$# edit name: x upload: @quit'), 'hide', '1.0 edit hidden once 2.1 is up');
eq(s.legacy, null, '1.0 edit ignored once 2.1 is up');

// 1.0 local editing
sent = []; edits = [];
const o = new Mcp({ send: (l) => sent.push(l), edit: (e) => edits.push(e) });
eq(o.line('#$# edit name: Rupert:look upload: @program #123:look'), 'hide', '1.0 header');
eq(o.line('player:tell(1);'), 'hide', '1.0 body hidden');
eq(o.line('return;'), 'hide', '1.0 body hidden 2');
eq(o.line('.'), 'hide', '1.0 end');
eq(edits.length, 1, '1.0 edit opened');
eq(edits[0].upload, '@program #123:look', '1.0 upload command');
eq(edits[0].type, 'moo-code', '1.0 @program is code');
o.upload(edits[0], ['return 5;']);
eq(sent.join('|'), '@program #123:look|return 5;|.', '1.0 upload');
eq(o.line('Back to normal'), null, 'after 1.0 edit');

console.log(failed === 0 ? 'all passed' : failed + ' failed');
tjs.exit(failed === 0 ? 0 : 1);
