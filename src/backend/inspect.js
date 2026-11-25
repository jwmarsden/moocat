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
// ([k -> v], ToastStunt) become arrays of [k, v] pairs. \e in a string is
// an escape (ESC, chr(27)): toliteral() passes one through raw, which
// escLiteral() turns into \e for the trip (see there).
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
        if (s[i] === '\\' && s[i + 1] === 'e') { out += '\x1b'; i += 2; continue; }
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

// A string as a MOO literal (an ESC as \e, as parseLiteral reads it).
export const mooString = (s) => '"' + String(s).replace(/[\\"]/g, '\\$&').replaceAll('\x1b', '\\e') + '"';

// MOO code for the toliteral() of expr with each ESC as \e. A MOO string has
// no escape for ESC ("\e" is "e"), a raw one is invisible in a textarea, and
// the server drops one typed back in. ToastStunt's chr(), called by name, as
// a server without it (LambdaMOO) rejects chr(...) when it compiles the eval,
// before any catch; by name it's an E_INVARG when it runs, caught: (LambdaMOO,
// whose strings can't hold an ESC anyway) just the toliteral().
export const escLiteral = (expr) => `\`strsub(toliteral(${expr}), call_function("chr", 27), "\\\\e") ! ANY => toliteral(${expr})'`;

// A literal (checkLiteral's) as MOO code: each \e in its strings as
// " + call_function("chr", 27) + ", the only way to write an ESC (by name:
// see escLiteral).
export function escCode(literal) {
  let out = '', i = 0;
  while (i < literal.length) {
    if (literal[i] !== '"') { out += literal[i++]; continue; }
    let j = i + 1, str = '"';
    while (j < literal.length && literal[j] !== '"') {
      if (literal[j] === '\\' && literal[j + 1] === 'e') { str += '" + call_function("chr", 27) + "'; j += 2; continue; }
      const n = literal[j] === '\\' ? 2 : 1;
      str += literal.slice(j, j + n);
      j += n;
    }
    out += str + '"';
    i = j + 1;
  }
  return out;
}

// An object as the editor names it: #123 or a $name, nothing else (it goes
// into an eval).
function checkObj(obj) {
  if (!/^(#-?\d+|\$\w+)$/.test(obj)) throw new Error('not an object: ' + obj);
  return obj;
}

// A MOO literal as typed (over several lines, say) -> one line, the spaces
// between its parts squeezed and its strings untouched; throws if it isn't a
// literal (parseLiteral's), so nothing else can ride into the eval. Newlines
// inside strings aren't allowed: a string holding one breaks the database.
export function checkLiteral(text) {
  let out = '', i = 0, space = false;
  const s = String(text).trim();
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\n') throw new Error('a newline inside a string');
        j += s[j] === '\\' ? 2 : 1;
      }
      if (space && /[,>]$/.test(out)) out += ' ';
      out += s.slice(i, j + 1);
      i = j + 1;
      space = false;
    } else if (/\s/.test(c)) {
      space = true;
      i++;
    } else {
      // a space kept only where it may matter: after a comma or ->, and between words
      if (space && out && (/[,>]$/.test(out) || (/\w$/.test(out) && /\w/.test(c)))) out += ' ';
      out += c;
      i++;
      space = false;
    }
  }
  parseLiteral(out);
  return out;
}

// A literal's type as typeof() would give it, from how it's written.
export function literalType(literal) {
  const c = literal[0];
  if (c === '"') return 2;
  if (c === '#') return 1;
  if (c === '{') return 4;
  if (c === '[') return 10;
  if (c === 'E') return 3;
  if (c === 't' || c === 'f') return 14;
  return /[.eE]/.test(literal) ? 9 : 0;
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
    // an ESC as \e, not raw: it would colour the object tab
    `  s = ${escLiteral("`o.(n) ! ANY'")}; length(s) > 300 && (s = s[1..300] + "...");`,
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

  // A property, all of it, for the property editor:
  //   { literal, value, type, owner, perms, clear, here, player, wizard }
  // literal: its toliteral() (exact, floats and all), value: that parsed
  // (parseLiteral's; null if it won't); type: typeof() (INT 0,
  // OBJ 1, STR 2, ERR 3, LIST 4, FLOAT 9, MAP 10, ANON 12, WAIF 13, BOOL 14);
  // clear: it has no value of its own (an inherited one shows); here: obj
  // defines it, so there's nothing to clear to. { err } if it can't be read,
  // null for no answer.
  async readProp(obj, prop) {
    const [o, p] = [checkObj(obj), mooString(prop)];
    const v = await this.ask(`{${escLiteral(`${o}.(${p})`)}, typeof(${o}.(${p})), property_info(${o}, ${p}), ` +
                             `is_clear_property(${o}, ${p}), \`${p} in properties(${o}) ! ANY => 0', player, player.wizard}`);
    if (!Array.isArray(v)) return v;
    const [literal, type, [owner, perms], clear, here, player, wizard] = v;
    let value = null;  // (a waif's literal is no literal)
    try { value = parseLiteral(literal); } catch {}
    return { literal, value, type, owner: owner.obj, perms, clear: !!clear, here: !!here, player: player.obj,
             wizard: !!wizard };
  }

  // Sets a property to a MOO literal (one checkLiteral passed), or clears it
  // (literal null), if it's still what was read (expect, its literal then):
  // { ok: true } or { ok: false, literal } (what it is now), or { err }.
  async writeProp(obj, prop, literal, expect) {
    const [o, p] = [checkObj(obj), mooString(prop)];
    const set = literal == null ? `clear_property(${o}, ${p})` : `${o}.(${p}) = ${escCode(checkLiteral(literal))}`;
    const now = escLiteral(`${o}.(${p})`);
    const v = await this.ask(`equal(${now}, ${mooString(expect)}) ? {1, ${set}} | {0, ${now}}`);
    if (!Array.isArray(v)) return v ?? { err: 'no answer from the MOO' };
    return v[0] ? { ok: true } : { ok: false, literal: v[1] };
  }

  // An object's name, for the editor's #123 box: { valid, name }.
  async objName(obj) {
    const o = checkObj(obj);
    const v = await this.ask(`{valid(${o}), \`${o}.name ! ANY => ""'}`);
    return Array.isArray(v) ? { valid: !!v[0], name: v[1] } : { valid: false, name: '' };
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
