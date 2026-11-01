// tjs run test/smud.test.js  — SMud out-of-band lines and canvas macros
import { parseOob, parseMacro, oobLine } from '../src/backend/smud.js';

let failed = 0;
const eq = (got, want, what) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.log(`FAIL ${what}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
eq(parseOob('#$# image: 123 create:  xsize: 1013 ysize: 645 name: Logic Puzzle'),
   { id: '123', cmd: 'create', xsize: '1013', ysize: '645', name: 'Logic Puzzle' }, 'create');
const q = parseOob('#$# image: 5 class: UNDO gettype:  id: 4711');
eq([q.id, q.cmd, q.name, q.gettype, q.task], ['5', 'class', 'UNDO', '', '4711'], 'class query');
eq(parseOob('#$# image: 5 textout:  xpos: 3 ypos: 4 text: Hello: there, you'), { id: '5', cmd: 'textout', xpos: '3', ypos: '4', text: 'Hello: there, you' }, 'text runs to the end');
eq(parseOob('#$# image: 5 pen:  color: $7F7F7F'), { id: '5', cmd: 'pen', color: '$7F7F7F' }, 'pen');
eq(parseOob('#$# image: 5 class: HINT1 property: Visible value: 0'), { id: '5', cmd: 'class', name: 'HINT1', property: 'Visible', value: '0' }, 'property');
eq(parseOob('#$#mcp version: 2.1'), null, 'not ours');
const ops = parseMacro('mv64,64;pw2;pc$7F7F7F;ln127,64;ccUNDO,button,15,402,75,30;tsUNDO,"{\\"Undo; now\\"}";toa,b,c, d;CSX,1,2');
eq(ops, [['mv', '64', '64'], ['pw', '2'], ['pc', '$7F7F7F'], ['ln', '127', '64'], ['cc', 'UNDO', 'button', '15', '402', '75', '30'],
         ['ts', 'UNDO', ['Undo; now']], ['to', 'a', 'b', 'c, d'], ['CS', 'X', '1', '2']], 'macro');
eq(parseOob('#$# image: 7 macro: fr1,2,3,4;').ops, [['fr', '1', '2', '3', '4']], 'macro line');
eq(oobLine([['image', 7], ['click', 'left'], ['clickx', 10], ['clicky', 20]]), '#$# image: 7 click: left clickx: 10 clicky: 20', 'click line');
eq(oobLine([['comptype', 'UNDO'], ['id', 4711], ['type', 'none']]), '#$# comptype: UNDO id: 4711 type: none', 'reply line');
eq(parseMacro('msGO,click,"fr0,0,5,5;pc$FF"'), [['ms', 'GO', 'click', [['fr', '0', '0', '5', '5'], ['pc', '$FF']]]], 'ms macro');
eq(parseOob('#$# image: 7 rename: New name').value, 'New name', 'a command value');
eq(parseOob('#$# image: 7 canvasclickmacro: fr0,0,1,1;bcclRed').ops, [['fr', '0', '0', '1', '1'], ['bc', 'clRed']], 'canvas click macro');
eq(parseOob('#$# image: 7 class: B doubleclickmacro: pw2').dblclickops, [['pw', '2']], 'component double-click macro');
eq(oobLine([['fontinfo', 7], ['id', 1], ['name', 'MS Sans Serif'], ['style', '']]), '#$# fontinfo: 7 id: 1 name: "MS Sans Serif" style: ', 'empty value');
console.log(failed === 0 ? 'all passed' : failed + ' failed');
tjs.exit(failed ? 1 : 0);
