// A line of MOO output -> HTML (escaped): ANSI SGR colours (16, 256, 24-bit
// and SMud's true colour), backgrounds, bold, underline and reset; links and
// object numbers made clickable. Other escape sequences are dropped.

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// links and object numbers (#1024, not #-1 or a #fragment in a link)
const LINK_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]|(?<![\w#$])#\d+\b/g;

// Plain text -> HTML (escaped) with links and object numbers clickable.
export function linkText(text) {
  let html = '', last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const attr = m[0][0] === '#' ? 'data-obj' : 'data-url';
    html += esc(text.slice(last, m.index)) + `<a href="#" ${attr}="${esc(m[0])}">${esc(m[0])}</a>`;
    last = m.index + m[0].length;
  }
  return html + esc(text.slice(last));
}
const linkify = linkText;

// The xterm 256-colour palette above the first 16: a 6×6×6 cube, then greys.
function xterm256(n) {
  if (n >= 232) { const v = 8 + (n - 232) * 10; return rgb(v, v, v); }
  n -= 16;
  const step = (v) => (v ? 55 + v * 40 : 0);
  return rgb(step(Math.floor(n / 36)), step(Math.floor(n / 6) % 6), step(n % 6));
}
const rgb = (r, g, b) => '#' + [r, g, b].map((v) => (v & 255).toString(16).padStart(2, '0')).join('');

// SMud's true colour: one SGR parameter holding 0x1000000 + 0xRRGGBB for the
// foreground, or 0x2000000 + 0xRRGGBB for the background (as Rupert's
// colortest sends, e.g. ESC[33554435;16777450m).
const SMUD_FG = 0x1000000, SMUD_BG = 0x2000000;

// The MOO's colour tags (the ANSI package, $ansi_utils 2.6, as on Rupert and
// ToastCore): what a property holds, e.g. "[red]Danger[normal]". The MOO
// turns them into escape codes on the way out, so text read from a property
// (an object's description) still has them. These are the tags
// $ansi_utils:notify replaces, as it would for a player with every option
// on: [red] [b:blue] [bold] [normal] [random], [:196] and [b::021] (xterm
// 256), [255:128:0] and [b:0:0:64] (24-bit). Anything else is left as text.
const TAG_RE = /\[(b:)?(random|normal|bold|unbold|bright|unbright|red|green|yellow|blue|purple|cyan|gray|grey|magenta|white|underline|inverse|blink|unblink|beep|:(?:[01]\d\d|2[0-4]\d|25[0-5])|:random|(\d+):(\d+):(\d+))\]/g;
const TAG_SGR = { normal: '0', bold: '1', bright: '1', unbold: '22', unbright: '22', underline: '4',
                  inverse: '7', blink: '5', unblink: '25', red: '31', green: '32', yellow: '33',
                  blue: '34', purple: '35', magenta: '35', cyan: '36', white: '37', gray: '1;30',
                  grey: '1;30' };
const TAG_BG = { red: '41', green: '42', yellow: '43', blue: '44', purple: '45', magenta: '45',
                 cyan: '46', white: '47' };
const RANDOM = ['red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'gray', 'white'];

// "[red]x[normal]" -> "\x1b[31mx\x1b[0m": for ansiToHtml.
export function ansiTags(text) {
  return text.replace(TAG_RE, (_, b, name, r, g, bl) => {
    const sgr = (code) => (code ? `\x1b[${code}m` : '');
    if (r != null) return sgr(`${b ? 48 : 38};2;${r};${g};${bl}`);
    if (name === ':random') return sgr(`${b ? 48 : 38};5;${Math.floor(Math.random() * 255)}`);
    if (name[0] === ':') return sgr(`${b ? 48 : 38};5;${Number(name.slice(1))}`);
    if (name === 'random') name = RANDOM[Math.floor(Math.random() * RANDOM.length)];
    return sgr(b ? TAG_BG[name] : TAG_SGR[name]);
  }).replaceAll('[null]', '');
}

// fg and bg are a palette index (0-15, styled by the c<n>/bg<n> classes) or
// a '#rrggbb' string (an inline style). links: false for text going inside a
// link of its own (an object's name in an object link).
export function ansiToHtml(line, { links = true } = {}) {
  const text = links ? linkify : esc;
  if (!line.includes('\x1b')) return text(line);
  let html = '';
  let fg = null, bg = null, bold = false, under = false, inverse = false, blink = false;
  const parts = line.split(/(\x1b\[[0-9;]*[A-Za-z])/);
  for (const p of parts) {
    if (p.startsWith('\x1b[')) {
      if (!p.endsWith('m')) continue;
      const codes = p.slice(2, -1).split(';').map((n) => Number(n || 0));
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { fg = bg = null; bold = under = inverse = blink = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c === 4) under = true;
        else if (c === 24) under = false;
        else if (c === 5 || c === 6) blink = true;
        else if (c === 25) blink = false;
        else if (c === 7) inverse = true;
        else if (c === 27) inverse = false;
        else if (c >= 30 && c <= 37) fg = c - 30;
        else if (c >= 90 && c <= 97) fg = c - 90 + 8;
        else if (c === 39) fg = null;
        else if (c >= 40 && c <= 47) bg = c - 40;
        else if (c >= 100 && c <= 107) bg = c - 100 + 8;
        else if (c === 49) bg = null;
        else if (c === 38 || c === 48) {
          // 38;5;n and 38;2;r;g;b (48 for the background)
          let col = null;
          if (codes[i + 1] === 5) { const n = codes[i + 2] ?? 0; col = n < 16 ? n : xterm256(n); i += 2; }
          else if (codes[i + 1] === 2) { col = rgb(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0); i += 4; }
          if (c === 38) fg = col; else bg = col;
        }
        else if (c >= SMUD_BG && c < SMUD_BG + 0x1000000) bg = '#' + (c - SMUD_BG).toString(16).padStart(6, '0');
        else if (c >= SMUD_FG && c < SMUD_FG + 0x1000000) fg = '#' + (c - SMUD_FG).toString(16).padStart(6, '0');
      }
      continue;
    }
    if (!p) continue;
    // inverse swaps the colours, the default ones included
    const [f, k] = inverse ? [bg ?? 'var(--bg)', fg ?? 'var(--fg)'] : [fg, bg];
    const cls = [typeof f === 'number' && `c${f}`, typeof k === 'number' && `bg${k}`, bold && 'b', under && 'u', blink && 'blink'].filter(Boolean);
    const style = [typeof f === 'string' && `color:${f}`, typeof k === 'string' && `background:${k}`].filter(Boolean);
    html += cls.length || style.length
      ? `<span${cls.length ? ` class="${cls.join(' ')}"` : ''}${style.length ? ` style="${style.join(';')}"` : ''}>${text(p)}</span>`
      : text(p);
  }
  return html;
}

// Text from the MOO with its colours, tags or escape codes, as HTML.
export const colourText = (text, opts) => ansiToHtml(ansiTags(text), opts);

// The same text without them: for a tab's label.
export const plainText = (text) => ansiTags(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
