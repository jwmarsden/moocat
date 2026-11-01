// tjs run test/inspect.test.js  — the MOO literal parser and the reply lines
import { parseLiteral, Inspector } from '../src/backend/inspect.js';

let failed = 0;
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${what}: got ${JSON.stringify(got)}`); }
};
eq(parseLiteral('{"a \\"b\\" \\\\", 3, -2.5, #12, #-1, E_PERM, {}}'),
   ['a "b" \\', 3, -2.5, { obj: '#12' }, { obj: '#-1' }, { err: 'E_PERM' }, []], 'list of everything');
eq(parseLiteral('["k" -> 1, 2 -> {}]'), [['k', 1], [2, []]], 'map');
eq(parseLiteral('"#$# {not, a} list"'), '#$# {not, a} list', 'string with braces');
let threw = false; try { parseLiteral('{1, 2'); } catch { threw = true; }
eq(threw, true, 'unterminated list throws');

const sent = [];
const ins = new Inspector({ send: (l) => sent.push(l) });
const p = ins.inspect('#5');
const tag = /MOOCAT:(\w+) /.exec(sent[0])[1];
eq(sent[0].startsWith(';;o = #5;'), true, 'eval sent');
const lines = [
  `MOOCAT:${tag} obj {"Box", #2, "Wizard", #1, #62, "Room", 0, 0, 0, 1, 0, 1, 0, 2}`,
  `MOOCAT:${tag} anc {#1, "Root Class"}`,
  `MOOCAT:${tag} desc "A box."`,
  `MOOCAT:${tag} prop {#5, "size", #2, "rc", "{1, 2}"}`,
  `MOOCAT:${tag} verb {#5, "op*en", #2, "rxd", "this", "none", "none"}`,
  `MOOCAT:${tag} end 0`,
  '=> 0',
];
for (const l of lines) eq(ins.line(l), true, 'hidden: ' + l);
eq(ins.line('=> 0'), false, 'only the eval result after end is hidden');
eq(ins.line('Hello'), false, 'ordinary line shown');
const d = await p;
eq([d.name, d.parent, d.flags.r, d.flags.f, d.contents], ['Box', '#1', true, true, 2], 'obj fields');
eq(d.properties[0], { definer: '#5', name: 'size', owner: '#2', perms: 'rc', value: '{1, 2}' }, 'prop');
eq(d.verbs[0].args, 'this none none', 'verb args');
eq(d.description, ['A box.'], 'description');

// the programmer probe: a programmer's answer is hidden, with its "=> 0"
const sent2 = [];
const ins2 = new Inspector({ send: (l) => sent2.push(l) });
const yes = ins2.probe();
const ptag = /MOOCAT:(\w+) prog/.exec(sent2[0])?.[1];
eq(sent2[0].startsWith(';;notify(player, '), true, 'probe sent as an eval');
eq(ins2.line(`MOOCAT:${ptag} prog 1`), true, "a programmer's answer is hidden");
eq(ins2.line('=> 0'), true, 'and its result');
eq(await yes, true, 'a programmer can program');
// a non-programmer gets the MOO's huh, hidden: no
const no = ins2.probe();
eq(ins2.line("I don't understand that."), true, "the MOO's huh is hidden");
eq(await no, false, "a guest can't program");
eq(ins2.line("I don't understand that."), false, 'a huh with no probe out is shown');
// a wizard who isn't a programmer: player.wizard is 1
const wiz = ins2.probe();
const wtag = /MOOCAT:(\w+) prog/.exec(sent2.at(-1))[1];
ins2.line(`MOOCAT:${wtag} prog 1`);
eq(await wiz, true, 'a wizard can');
const zero = ins2.probe();
const ztag = /MOOCAT:(\w+) prog/.exec(sent2.at(-1))[1];
ins2.line(`MOOCAT:${ztag} prog 0`);
eq(await zero, false, 'prog 0: no');

console.log(failed === 0 ? 'all passed' : failed + ' failed');
tjs.exit(failed ? 1 : 0);
