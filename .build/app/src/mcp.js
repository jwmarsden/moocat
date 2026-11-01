// MCP for local editing, ported from MooEdit's core.lua (mudlet-mooedit): MCP
// 2.1 (mcp-negotiate, dns-org-mud-moo-simpleedit) and the older MCP 1.0 local
// editing ("#$# edit name: ... upload: ..."), as a line filter with no I/O, so
// it can be tested on its own.
//
//   const s = new Mcp({ send(line), edit(e), log(text) })
//   s.line(text)     // each line from the server; returns
//                    //   'hide': an out-of-band line, don't show it
//                    //   'unquote': a #$" line, show it without its first 3 chars
//                    //   null: an ordinary line
//   s.upload(e, lines)  // send an edit's text back; throws if it can't
//   s.reset()        // on connect and disconnect
//
// edit(e) gets { name, reference, type, lines, protocol: '2.1' | '1.0',
// upload } (upload: the 1.0 command the text is sent after).

// Packages this client speaks, with the versions it supports.
export const PACKAGES = {
  'mcp-negotiate': ['1.0', '2.0'],
  'dns-org-mud-moo-simpleedit': ['1.0', '1.0'],
};

function versionNum(v) {
  const m = /^(\d+)\.(\d+)$/.exec(String(v ?? ''));
  return m ? Number(m[1]) * 1000 + Number(m[2]) : null;
}

// The highest version in both ranges, or null.
export function commonVersion(min1, max1, min2, max2) {
  const [a1, b1, a2, b2] = [min1, max1, min2, max2].map(versionNum);
  if ([a1, b1, a2, b2].includes(null)) return null;
  const hi = Math.min(b1, b2);
  if (hi < Math.max(a1, a2)) return null;
  return `${Math.floor(hi / 1000)}.${hi % 1000}`;
}

// 'k1: v1 k2: "v 2"' -> { k1: 'v1', k2: 'v 2' }, or null on a malformed list.
export function parseKeyvals(s) {
  const args = {};
  let i = 0;
  const n = s.length;
  const skip = () => { while (i < n && /\s/.test(s[i])) i++; };
  while (true) {
    skip();
    if (i >= n) return args;
    const m = /^([\w\-*]+):/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    skip();
    if (i >= n) return null;
    let value = '';
    if (s[i] === '"') {
      i++;
      while (true) {
        if (i >= n) return null;
        const c = s[i];
        if (c === '\\') { i++; value += s[i] ?? ''; }
        else if (c === '"') break;
        else value += c;
        i++;
      }
      i++;
    } else {
      const start = i;
      while (i < n && !/\s/.test(s[i])) i++;
      value = s.slice(start, i);
    }
    args[m[1].toLowerCase()] = value;
  }
}

function quote(v) {
  v = String(v);
  if (v !== '' && !/[\s"\\:*]/.test(v)) return v;
  return '"' + v.replace(/[\\"]/g, '\\$&') + '"';
}

const newTag = () => String(Math.floor(1e11 + Math.random() * 9e11));

export class Mcp {
  constructor({ send, edit, log = () => {} }) {
    Object.assign(this, { send, edit, log });
    this.reset();
  }

  reset() {
    this.key = null;       // our authentication key once MCP 2.1 is up
    this.server = {};      // package -> [min, max] the server can do
    this.versions = {};    // package -> agreed version
    this.pending = {};     // data-tag -> multiline message being received
    this.legacy = null;    // the 1.0 edit being received
  }

  get canEdit() {
    return !!this.versions['dns-org-mud-moo-simpleedit'];
  }

  // Send an MCP 2.1 message; `multi` holds the multiline values (key -> lines).
  message(name, args, multi) {
    const parts = ['#$#' + name, this.key];
    for (const [k, v] of args) parts.push(k + ': ' + quote(v));
    let tag;
    if (multi) {
      tag = newTag();
      for (const k of Object.keys(multi)) parts.push(k + '*: ""');
      parts.push('_data-tag: ' + tag);
    }
    this.send(parts.join(' '));
    if (multi) {
      for (const [k, lines] of Object.entries(multi)) {
        for (const l of lines) this.send('#$#* ' + tag + ' ' + k + ': ' + l);
      }
      this.send('#$#: ' + tag);
    }
  }

  start(args) {
    if (!commonVersion(args.version, args.to, '2.1', '2.1')) {
      this.log(`server's MCP ${args.version} isn't 2.1; not starting it`);
      return;
    }
    this.reset();
    this.key = newTag();
    this.send(`#$#mcp authentication-key: ${this.key} version: 2.1 to: 2.1`);
    for (const [pkg, [min, max]] of Object.entries(PACKAGES)) {
      this.message('mcp-negotiate-can', [['package', pkg], ['min-version', min], ['max-version', max]]);
    }
    this.message('mcp-negotiate-end', []);
  }

  dispatch(name, args) {
    if (name === 'mcp-negotiate-can') {
      this.server[args.package ?? ''] = [args['min-version'], args['max-version']];
    } else if (name === 'mcp-negotiate-end') {
      for (const [pkg, [min, max]] of Object.entries(this.server)) {
        const mine = PACKAGES[pkg];
        if (mine) this.versions[pkg] = commonVersion(min, max, mine[0], mine[1]);
      }
      this.log(this.canEdit
        ? 'MCP 2.1 ready: @edit opens here (set @edito +local if it doesn\'t)'
        : 'MCP 2.1 is up, but the server doesn\'t offer simpleedit');
    } else if (name === 'dns-org-mud-moo-simpleedit-content') {
      let text = args.content ?? [];
      if (typeof text === 'string') text = [text];
      this.edit({ protocol: '2.1', name: args.name ?? args.reference, reference: args.reference,
                  type: args.type ?? 'string-list', lines: text });
    }
  }

  line(text) {
    // 1.0 local edit in progress: every line up to "." is the text
    if (this.legacy) {
      if (text === '.') {
        const e = this.legacy;
        this.legacy = null;
        this.edit(e);
      } else {
        this.legacy.lines.push(text);
      }
      return 'hide';
    }

    if (text.startsWith('#$"')) return 'unquote';
    if (!text.startsWith('#$#')) return null;

    // 1.0: "#$# edit name: <name> upload: <command>" (no key, a space after #$#)
    if (text.startsWith('#$# edit ')) {
      if (this.key) return 'hide';  // 2.1 is up, so a 1.0 edit is someone spoofing
      const m = /^name: (.*?) upload: (.*)$/.exec(text.slice(9));
      if (!m) return null;
      this.legacy = { protocol: '1.0', name: m[1], reference: m[1], upload: m[2],
                      type: m[2].startsWith('@program') ? 'moo-code' : 'string-list', lines: [] };
      return 'hide';
    }

    // 2.1 multiline continuation and end
    let m = /^#\$#\* (\S+) ([\w-]+): ?(.*)$/.exec(text);
    if (m) {
      const list = this.pending[m[1]]?.args[m[2].toLowerCase()];
      if (Array.isArray(list)) list.push(m[3]);
      return 'hide';
    }
    m = /^#\$#: (\S+)\s*$/.exec(text);
    if (m) {
      const p = this.pending[m[1]];
      if (p) {
        delete this.pending[m[1]];
        this.dispatch(p.name, p.args);
      }
      return 'hide';
    }

    m = /^#\$#(\S+)\s*(.*)$/.exec(text);
    if (!m) return null;
    const [, name, rest] = m;
    if (name === 'mcp') {
      const args = parseKeyvals(rest);
      if (args?.version) this.start(args);
      return 'hide';
    }
    if (!this.key) return null;  // not ours: no MCP session yet

    const km = /^(\S+)\s*(.*)$/.exec(rest);
    if (!km || km[1] !== this.key) return 'hide';  // wrong key: spoofed, drop it
    const args = parseKeyvals(km[2]);
    if (!args) return 'hide';
    let multi = false;
    for (const k of Object.keys(args)) {
      if (k.endsWith('*')) {
        args[k.slice(0, -1)] = [];
        delete args[k];
        multi = true;
      }
    }
    if (multi && args['_data-tag']) this.pending[args['_data-tag']] = { name, args };
    else this.dispatch(name, args);
    return 'hide';
  }

  upload(e, lines) {
    if (e.protocol === '2.1') {
      if (!this.key) throw new Error('the MCP session has ended (reconnected?); @edit again');
      this.message('dns-org-mud-moo-simpleedit-set',
        [['reference', e.reference], ['type', e.type]], { content: lines });
    } else {
      this.send(e.upload);
      for (const l of lines) this.send(l);
      this.send('.');
    }
  }
}
