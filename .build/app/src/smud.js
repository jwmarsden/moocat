// SMud graphics: the out-of-band canvas protocol of the SMud client, as
// Rupert's $canvas / Legacy SMud Plugin (#2897) speak it. No I/O here.
//
// After login the client announces itself:
//   #$# client: SMud version: <v> release: <n>
// (release 23+ for components, 40 or less for this line format). The MOO
// then sends lines like
//   #$# image: 123 create:  xsize: 1013 ysize: 645 name: Logic Puzzle
//   #$# image: 123 macro: mv64,64;pw2;pc$7F7F7F;ln127,64;…
//   #$# image: 123 class: UNDO gettype:  id: 4711        (a query: answer it)
// and the client sends clicks and answers back the same way:
//   #$# image: 123 click: left clickx: 10 clicky: 20
//   #$# comptype: UNDO id: 4711 type: none
//
//   parseOob(line) -> { id, cmd, …fields } or null if not an SMud image line
//                     (a query's own id, the task to resume, is `task`)
//   parseMacro(str) -> [[op, …args], …]   (ts's text as a list of lines, ms's
//                       macro as ops; clickmacro lines get clickops the same)
//   oobLine([[key, value], …]) -> the line to send

import { parseLiteral } from './inspect.js';

export const HELLO = '#$# client: SMud version: 1.0b3p3-moocat release: 40';

// keys whose value runs to the end of the line (they may hold spaces)
const REST = new Set(['macro', 'name', 'text', 'settext', 'clickmacro', 'doubleclickmacro',
                      'canvasclickmacro', 'canvasdoubleclickmacro']);

// " key: value key: value…" -> [[key, value], …]; values are raw text
function keyvals(s) {
  const out = [];
  const re = /(?:^|\s)([A-Za-z]+): ?/g;
  let m = re.exec(s);
  while (m) {
    const key = m[1];
    const start = re.lastIndex;
    if (REST.has(key)) { out.push([key, s.slice(start)]); break; }
    const next = re.exec(s);
    out.push([key, s.slice(start, next ? next.index : s.length).trim()]);
    m = next;
  }
  return out;
}

export function parseOob(line) {
  const m = /^#\$# image: (-?\d+) (.*)$/.exec(line);
  if (!m) return null;
  const kv = keyvals(m[2]);
  if (!kv.length) return null;
  const [cmd, value] = kv[0];
  const msg = { id: m[1], cmd };  // a string: ToastStunt ids can pass 2^53
  if (cmd === 'macro' || cmd === 'canvasclickmacro' || cmd === 'canvasdoubleclickmacro') {
    msg.ops = parseMacro(value);
    return msg;
  }
  if (cmd === 'class') msg.name = value;
  else if (value !== '') msg.value = value;
  for (const [k, v] of kv.slice(1)) msg[k === 'id' ? 'task' : k] = v;
  if (cmd === 'class' && msg.settext != null) msg.lines = textList(msg.settext);
  if (msg.clickmacro != null) msg.clickops = parseMacro(msg.clickmacro);
  if (msg.doubleclickmacro != null) msg.dblclickops = parseMacro(msg.doubleclickmacro);
  return msg;
}

// '"{\"Undo\"}"' (a list literal, itself quoted) -> ['Undo']
function textList(s) {
  try {
    let v = parseLiteral(s.trim());
    for (let i = 0; i < 2 && typeof v === 'string' && /^[{"]/.test(v); i++) v = parseLiteral(v);
    return Array.isArray(v) ? v.map(String) : [String(v)];
  } catch {
    return [s];
  }
}

// Split on ';' outside double quotes.
function splitMacro(s) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q && c === '\\') { cur += c + (s[++i] ?? ''); continue; }
    if (c === '"') q = !q;
    if (c === ';' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// how many comma-separated arguments each op takes; the last takes the rest
const ARGS = { to: 3, cc: 6, cp: 3, cs: 3, CS: 3, ts: 2, tc: 2, ms: 3, ff: 4 };

export function parseMacro(s) {
  const ops = [];
  for (const item of splitMacro(s)) {
    if (item.length < 2) continue;
    const op = item.slice(0, 2);
    const rest = item.slice(2);
    const n = ARGS[op];
    let args;
    if (n) {
      args = [];
      let r = rest;
      for (let i = 1; i < n && r.includes(','); i++) {
        const c = r.indexOf(',');
        args.push(r.slice(0, c));
        r = r.slice(c + 1);
      }
      args.push(r);
    } else {
      args = rest === '' ? [] : rest.split(',');
    }
    if (op === 'ts') args = [args[0], textList(args[1] ?? '')];
    if (op === 'ms') {
      // msNAME,click,"macro": the macro, parsed too
      let m = args[2] ?? '';
      try { m = parseLiteral(m); } catch {}
      args[2] = parseMacro(String(m));
    }
    ops.push([op, ...args]);
  }
  return ops;
}

// [[key, value], …] -> "#$# key: value …", quoting values with spaces. An
// empty value goes bare: the MOO's parser reads "key: " as "", but would
// keep the quotes of "".
export function oobLine(pairs) {
  return '#$#' + pairs.map(([k, v]) => {
    if (!/^[A-Za-z]+$/.test(k)) throw new Error('bad key ' + k);
    v = String(v ?? '').replace(/[\r\n]/g, ' ');
    if (/[\s":]/.test(v)) v = '"' + v.replace(/[\\"]/g, '\\$&') + '"';
    return ` ${k}: ${v}`;
  }).join('');
}
