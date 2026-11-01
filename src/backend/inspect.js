// Reading an object off the MOO for the object tab: name, description,
// properties and verbs (its own and inherited). Sends one `;;` eval, so it
// needs a programmer; the program notify()s one line per item, each
// "MOOCAT:<tag> <kind> <MOO literal>", which this catches and hides, along
// with the eval's own "=> 0" after it. No I/O here, so it can be tested.
//
//   const ins = new Inspector({ send(line) })
//   ins.inspect('#123') -> Promise<object>   (rejects on timeout)
//   ins.ask(expr) -> Promise<value | null>   a MOO expression's value, hidden
//   ins.probe() -> Promise<boolean>          can the player program?
//   ins.line(text) -> true if the line was ours (don't show it)

const PREFIX = 'MOOCAT:';
const TIMEOUT = 15000;
const PROBE_TIMEOUT = 8000;
// what a MOO says to a non-programmer's eval (LambdaCore, ToastCore)
const HUH = /^I don't understand that\.?$/;

// A MOO literal (toliteral() output) -> JS: strings, numbers, lists as
// arrays, objects as { obj: '#n' }, errors as { err: 'E_X' }. Maps
// ([k -> v], ToastStunt) become arrays of [k, v] pairs.
export function parseLiteral(s) {
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  function value() {
    ws();
    const c = s[i];
    if (c === '"') {
      let out = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') i++;
        out += s[i++];
      }
      if (s[i] !== '"') throw new Error('unterminated string');
      i++;
      return out;
    }
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      const list = [];
      i++;
      ws();
      if (s[i] === close) { i++; return list; }
      while (true) {
        let v = value();
        ws();
        if (close === ']' && s.startsWith('->', i)) { i += 2; v = [v, value()]; ws(); }
        list.push(v);
        if (s[i] === ',') { i++; continue; }
        if (s[i] === close) { i++; return list; }
        throw new Error('bad list at ' + i);
      }
    }
    let m = /^#-?\d+/.exec(s.slice(i));
    if (m) { i += m[0].length; return { obj: m[0] }; }
    m = /^E_[A-Z]+/.exec(s.slice(i));
    if (m) { i += m[0].length; return { err: m[0] }; }
    m = /^-?\d+(\.\d*)?([eE][-+]?\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    m = /^(true|false)\b/.exec(s.slice(i));
    if (m) { i += m[0].length; return m[0] === 'true'; }
    throw new Error('bad literal at ' + i);
  }
  const v = value();
  ws();
  if (i !== s.length) throw new Error('trailing text at ' + i);
  return v;
}

// The eval, one line. Values are sent as toliteral() strings cut at 300
// characters: they're for reading, not parsing. Long objects suspend now and
// then rather than run out of ticks.
export function program(obj, tag) {
  const t = `"${PREFIX}${tag} "`;
  const say = (kind, expr) => `notify(player, ${t} + "${kind} " + toliteral(${expr}));`;
  return [
    `o = ${obj};`,
    `if (!valid(o)) ${say('end', 'E_INVIND')} return; endif`,
    'a = {o}; p = parent(o); while (valid(p) && length(a) < 50) a = {@a, p}; p = parent(p); endwhile',
    say('obj', '{o.name, o.owner, `o.owner.name ! ANY => ""\', parent(o), o.location, ' +
      '`o.location.name ! ANY => ""\', is_player(o), o.wizard, o.programmer, o.r, o.w, o.f, ' +
      'length(children(o)), length(o.contents)}'),
    `for x in (a[2..$]) ${say('anc', '{x, x.name}')} endfor`,
    'd = `o.description ! ANY\';',
    `if (typeof(d) == LIST) for l in (d) ${say('desc', 'tostr(l)')} endfor`,
    `elseif (typeof(d) == STR) ${say('desc', 'd')}`,
    `elseif (typeof(d) != ERR) ${say('desc', 'toliteral(d)')} endif`,
    'for x in (a)',
    ' ps = `properties(x) ! ANY\';',
    ` if (typeof(ps) == ERR) ${say('noprops', '{x, ps}')}`,
    ' else for n in (ps)',
    '  ticks_left() < 4000 && suspend(0);',
    '  i = `property_info(o, n) ! ANY => {0, "?"}\';',
    '  s = toliteral(`o.(n) ! ANY\'); length(s) > 300 && (s = s[1..300] + "...");',
    `  ${say('prop', '{x, n, i[1], i[2], s}')}`,
    ' endfor endif',
    ' vs = `verbs(x) ! ANY\';',
    ` if (typeof(vs) == ERR) ${say('noverbs', '{x, vs}')}`,
    ' else for k in [1..length(vs)]',
    '  ticks_left() < 4000 && suspend(0);',
    '  i = `verb_info(x, k) ! ANY => {0, "?", vs[k]}\';',
    '  g = `verb_args(x, k) ! ANY => {"?", "?", "?"}\';',
    `  ${say('verb', '{x, i[3], i[1], i[2], g[1], g[2], g[3]}')}`,
    ' endfor endif',
    'endfor',
    say('end', '0'),
  ].join(' ');
}

const name = (v) => v?.obj ?? String(v);

export class Inspector {
  constructor({ send }) {
    this.send = send;
    this.pending = new Map();  // tag -> { obj, data, resolve, reject, timer }
    this.swallow = new Set();  // after an "end": the eval's result lines still to hide
    this.swallowUntil = 0;
    this.asking = null;        // { tag, done }: the question out
    this.queue = Promise.resolve();
  }

  // A MOO expression's value (as parseLiteral gives it; an error raised is
  // { err }), by one eval whose answer is hidden. A non-programmer's eval
  // gets the MOO's "I don't understand that." instead, hidden too: null, as
  // for no answer at all. One question at a time.
  ask(expr) {
    const next = this.queue.then(() => new Promise((resolve) => {
      const tag = Math.random().toString(36).slice(2, 10);
      const timer = setTimeout(() => done(null), PROBE_TIMEOUT);
      const done = (v) => { clearTimeout(timer); this.asking = null; resolve(v); };
      this.asking = { tag, done };
      this.send(`;;notify(player, "${PREFIX}${tag} val " + toliteral(\`${expr} ! ANY'));`);
    }));
    this.queue = next;
    return next;
  }

  // Whether the player can program (a programmer or a wizard).
  probe() {
    return this.ask('player.programmer || player.wizard').then((v) => typeof v === 'number' && v !== 0);
  }

  inspect(obj) {
    if (!/^#-?\d+$/.test(obj)) return Promise.reject(new Error('not an object number: ' + obj));
    const tag = Math.random().toString(36).slice(2, 10);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tag);
        reject(new Error('no answer from the MOO: reading objects needs a programmer bit ' +
                         '(any error is in the session tab)'));
      }, TIMEOUT);
      this.pending.set(tag, {
        obj, resolve, reject, timer,
        data: { obj, ancestors: [], description: [], properties: [], verbs: [], notes: [] },
      });
      this.send(';;' + program(obj, tag));
    });
  }

  line(text) {
    if (this.asking && HUH.test(text)) { this.asking.done(null); return true; }
    if (this.asking && text.startsWith(`${PREFIX}${this.asking.tag} val `)) {
      this.swallow = new Set(['result', 'used']);
      this.swallowUntil = Date.now() + 3000;
      let v = null;
      try { v = parseLiteral(text.slice(`${PREFIX}${this.asking.tag} val `.length)); } catch {}
      this.asking.done(v);
      return true;
    }
    if (!text.startsWith(PREFIX)) {
      // the eval's "=> 0" and, with eval-time on, "[used n ticks, …]"
      const kind = text.startsWith('=> ') ? 'result' : /^\[used \d+ ticks/.test(text) ? 'used' : null;
      if (kind && this.swallow.has(kind) && Date.now() < this.swallowUntil) {
        this.swallow.delete(kind);
        return true;
      }
      return false;
    }
    const m = /^MOOCAT:(\w+) (\w+) (.*)$/.exec(text);
    const p = m && this.pending.get(m[1]);
    if (!p) return true;  // a reply we've given up on
    let v;
    try { v = parseLiteral(m[3]); } catch { p.data.notes.push(`unreadable line: ${m[3]}`); return true; }
    const d = p.data;
    switch (m[2]) {
      case 'obj': {
        const [nm, owner, ownerName, parent, location, locName, isPlayer, wizard, programmer, r, w, f,
               children, contents] = v;
        Object.assign(d, { name: nm, owner: name(owner), ownerName, parent: name(parent),
                           location: name(location), locationName: locName,
                           flags: { player: !!isPlayer, wizard: !!wizard, programmer: !!programmer,
                                    r: !!r, w: !!w, f: !!f },
                           children, contents });
        break;
      }
      case 'anc': d.ancestors.push({ obj: name(v[0]), name: v[1] }); break;
      case 'desc': d.description.push(String(v)); break;
      case 'prop':
        d.properties.push({ definer: name(v[0]), name: v[1], owner: name(v[2]), perms: v[3], value: v[4] });
        break;
      case 'verb':
        d.verbs.push({ definer: name(v[0]), names: v[1], owner: name(v[2]), perms: v[3],
                       args: [v[4], v[5], v[6]].join(' ') });
        break;
      case 'noprops': d.notes.push(`can't list ${name(v[0])}'s properties: ${name(v[1]?.err ?? v[1])}`); break;
      case 'noverbs': d.notes.push(`can't list ${name(v[0])}'s verbs: ${name(v[1]?.err ?? v[1])}`); break;
      case 'end':
        clearTimeout(p.timer);
        this.pending.delete(m[1]);
        this.swallow = new Set(['result', 'used']);
        this.swallowUntil = Date.now() + 3000;
        if (v?.err) p.reject(new Error(`${p.obj} is not a valid object`));
        else p.resolve(d);
        break;
    }
    return true;
  }
}
