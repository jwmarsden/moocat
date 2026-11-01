// tjs run test/ansi.test.js  — colour codes, SMud's true colour, and links
import { ansiToHtml, ansiTags, colourText, plainText } from '../src/frontend/ansi.js';

let failed = 0;
const eq = (got, want, what) => { if (got !== want) { failed++; console.log(`FAIL ${what}:\n  got  ${got}\n  want ${want}`); } };
eq(ansiToHtml('\x1b[33554435;16777450mS\x1b[0m'), '<span style="color:#0000ea;background:#000003">S</span>', 'SMud fg + bg');
eq(ansiToHtml('\x1b[32112640mR'), '<span style="color:#ea0000">R</span>', 'SMud fg alone');
eq(ansiToHtml('\x1b[1;31mx\x1b[44my\x1b[0mz'), '<span class="c1 b">x</span><span class="c1 bg4 b">y</span>z', '16 colours + bg');
eq(ansiToHtml('\x1b[38;5;196ma\x1b[38;2;1;2;3;48;5;240mb'), '<span style="color:#ff0000">a</span><span style="color:#010203;background:#585858">b</span>', '256 and 24-bit');
eq(ansiToHtml('\x1b[2Jplain #12'), 'plain <a href="#" data-obj="#12">#12</a>', 'other escapes dropped, objects linked');
eq(ansiToHtml('<b>&'), '&lt;b&gt;&amp;', 'escaped');
// the MOO's colour tags, as in a description
const tags = (t) => ansiToHtml(ansiTags(t));
eq(tags('[red]Danger[normal] ahead'), '<span class="c1">Danger</span> ahead', 'tag colour + normal');
eq(tags('[bold][b:blue]x[unbold]y'), '<span class="bg4 b">x</span><span class="bg4">y</span>', 'bold, background');
eq(tags('[:196]a[b::021]b'), '<span style="color:#ff0000">a</span><span style="color:#ff0000;background:#0000ff">b</span>', 'xterm 256 tags');
eq(tags('[255:128:0]o[b:0:0:64]p'), '<span style="color:#ff8000">o</span><span style="color:#ff8000;background:#000040">p</span>', '24-bit tags');
eq(tags('[gray]g[null]'), '<span class="c0 b">g</span>', 'gray is bold black; null vanishes');
eq(tags('[b:black] [:5] [rose] [1]'), '[b:black] [:5] [rose] [1]', 'not tags: left alone');
eq(/^<span class="c\d">z<\/span>$/.test(tags('[random]z')), true, 'random is a colour');
eq(tags('[red][b:blue][inverse]x'), '<span class="c4 bg1">x</span>', 'inverse swaps palette colours');
eq(tags('[inverse]x[normal]y'), '<span style="color:var(--bg);background:var(--fg)">x</span>y', 'inverse of the defaults');
eq(tags('[255:0:0][inverse]x'), '<span style="color:var(--bg);background:#ff0000">x</span>', 'inverse of a 24-bit colour');
eq(ansiToHtml('\x1b[7mx\x1b[27my'), '<span style="color:var(--bg);background:var(--fg)">x</span>y', 'inverse off (27)');
eq(tags('[blink]b[unblink]c'), '<span class="blink">b</span>c', 'blink and unblink');
eq(ansiToHtml('\x1b[5;31mb\x1b[0m'), '<span class="c1 blink">b</span>', 'blink escape');
eq(colourText('[green]Bob #12', { links: false }), '<span class="c2">Bob #12</span>', 'no links inside a link');
eq(colourText('[green]Bob #12'), '<span class="c2">Bob <a href="#" data-obj="#12">#12</a></span>', 'links by default');
eq(plainText('[red]Ech[normal]leon\x1b[33554435m!'), 'Echleon!', 'plain text for tab labels');
console.log(failed === 0 ? 'all passed' : failed + ' failed');
tjs.exit(failed ? 1 : 0);
