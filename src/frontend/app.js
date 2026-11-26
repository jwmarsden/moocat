import { highlightMoo, plain } from './moo.js';
import { ansiToHtml, colourText, plainText, linkText } from './ansi.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const call = (m, p) => tiny.api.call(m, p);

const MAX_LINES = 5000;
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// --- colour themes --------------------------------------------------------
// Sets of colours in style.css, chosen by data-moo-theme on <html>. Each app
// lists them in its own order, its default first: the desktop app this one,
// the web version (web.js) its own, set as moocatThemes before this loads.

const THEME_NAMES = { 'tokyo-night': 'Tokyo Night', cata: 'Cata' };
const themes = (globalThis.moocatThemes ?? ['tokyo-night', 'cata']).filter((t) => t in THEME_NAMES);

function setTheme(theme, save = true) {
  if (!themes.includes(theme)) theme = themes[0];
  document.documentElement.dataset.mooTheme = theme;
  $('theme').value = theme;
  if (save) store.set('moocat-theme', theme);
}

$('theme').innerHTML = themes.map((t) => `<option value="${t}">${THEME_NAMES[t]}</option>`).join('');
$('theme').addEventListener('change', (ev) => setTheme(ev.target.value));
// (it was called moomoo-theme before the rename)
setTheme(store.get('moocat-theme', store.get('moomoo-theme', themes[0])), false);


// --- sessions -------------------------------------------------------------
// One per MOO connection, each with a tab and its own output; its edit and
// object tabs sit just to its right. `current` is the session showing (or
// null, before any), `active` the tab of it that's showing: null for the
// session itself. A session stays when its connection drops, to connect again.

const sessions = [];  // { sid, world, connected, mcp, prog, links, el, partial, follow, unseen, missed, scroll, tabs }
// Object numbers are links once the MOO says the player can program (prog,
// from core.js), unless /enable or /disable said otherwise (links).
const objLinks = (s) => !!(s.links ?? s.prog);
let current = null;
let active = null;

const out = $('out');
let resultWatch = null;  // { tab, until, lines } after an upload: the MOO's answer

function newSession(sid, world) {
  const s = { sid, world, connected: false, mcp: 'none', prog: false, links: null, el: document.createElement('div'), partial: '',
              follow: true, unseen: 0, missed: 0, scroll: 0, tabs: [] };
  sessions.push(s);
  return s;
}
const bySid = (sid) => sessions.find((s) => s.sid === sid);

// Before any session: what to do, in the output area.
const home = { el: document.createElement('div'), follow: true, unseen: 0, scroll: 0, partial: '' };
const shown = () => current ?? home;

// Output follows new lines unless you've scrolled up; then a button counts
// what came in below. Following is set only by scrolling, so a resize (the
// prompt line, a taller input, the editor opening) never unpins it.
function atBottom() {
  return out.scrollHeight - out.scrollTop - out.clientHeight < 8;
}

function showJump(s) {
  $('jump').textContent = `↓ ${s.unseen} new line${s.unseen === 1 ? '' : 's'}`;
  $('jump').hidden = !s.unseen;
}

function toBottom() {
  const s = shown();
  s.follow = true;
  out.scrollTop = out.scrollHeight;
  s.unseen = 0;
  showJump(s);
}

out.addEventListener('scroll', () => {
  const s = shown();
  s.follow = atBottom();
  if (s.follow && s.unseen) toBottom();
});
new ResizeObserver(() => { if (shown().follow) out.scrollTop = out.scrollHeight; }).observe(out);
$('jump').addEventListener('click', toBottom);

// The bell (^G in a line): a short tone, at most one per batch of lines.
let audio = null;
function beep() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.15);
  } catch {}
}

// Lines to a session (or to home, before any). Object numbers are links
// only once the MOO has said the player can program (core.js asks).
function addLines(s, lines) {
  s ??= home;
  if (lines.some(({ text, kind }) => kind !== 'me' && text.includes('\x07'))) beep();
  const frag = document.createDocumentFragment();
  for (const { text, kind } of lines) {
    const div = document.createElement('div');
    if (kind) div.className = kind === 'disconnected' ? 'sys' : kind;
    div.innerHTML = kind === 'me' ? esc(text) : ansiToHtml(text, { objects: objLinks(s) });
    if (kind !== 'me' && objLinks(s)) verbLinks(s, plainText(text), div);
    if (kind === 'disconnected') div.insertAdjacentHTML('beforeend', ' <a href="#" data-reconnect title="Connect again">Reconnect</a>');
    frag.append(div);
  }
  s.el.append(frag);
  while (s.el.childElementCount > MAX_LINES) s.el.firstElementChild.remove();
  if (s === shown()) {
    if (s.follow) out.scrollTop = out.scrollHeight;
    else { s.unseen += lines.length; showJump(s); }
  } else if (s.follow) {
    s.scroll = Infinity;
  } else {
    s.unseen += lines.length;
  }
  if (s !== home && (s !== current || active)) {
    s.missed += lines.filter((l) => l.kind !== 'me').length;
    renderTabs();
  }
  if (resultWatch?.tab.session === s) watchResult(lines);
}

// @verbs and @props output: verb names become links that @edit them (as
// in the object tab), property names links to the property editor. Two
// shapes of each: the core's one line,
//   ;verbs(#5) => {"g*et t*ake", "moveto", ...}
//   ;properties($thing) => {"drop_failed_msg", ...}
// and a table (a wizard's @verbs and @props), a line naming the object, then rows:
//   King Elect (#152): 3 verbs
//      #  Names          Args            ...
//      1  reset_board    this none this  ...
// A table of verbs is the named object's; @props + goes on through the
// ancestors with "(inherited)", but its values (and so what to edit) are
// still the first object's. s.table: { what: 'verbs' | 'props', obj } while
// one is going by.
const CORE_LIST = /^;(verbs|properties)\((#\d+|\$\w+)\) => \{"/;
const TABLE_HEAD = /\((#\d+)\): \d+ (verbs?|propert(?:y|ies))\b( \(inherited\))?/;
const TABLE_TOP = /^\s+#\s+Names?\s/;
const TABLE_ROW = /^\s+\d+  (\S+)/;

function verbLinks(s, plain, div) {
  let m;
  if ((m = CORE_LIST.exec(plain))) {
    s.table = null;
    const obj = m[2];
    if (m[1] === 'verbs') linkIn(div, /"([^"]+)"/g, (x) => ({ edit: `${obj}:${verbName(x[1])}` }));
    else linkIn(div, /"([^"]+)"/g, (x) => ({ prop: `${obj}.${x[1]}` }));
  } else if ((m = TABLE_HEAD.exec(plain))) {
    const what = m[2].startsWith('verb') ? 'verbs' : 'props';
    // an inherited section of @props: still the object it began with
    const obj = what === 'props' && m[3] && s.lastTable?.what === 'props' ? s.lastTable.obj : m[1];
    s.table = s.lastTable = { what, obj };
  } else if (s.table && TABLE_TOP.test(plain)) {
    // the column names
  } else if (s.table && (m = TABLE_ROW.exec(plain))) {
    // a name cut short (name~) is no name to find it by
    const { what, obj } = s.table;
    if (!m[1].endsWith('~')) {
      linkIn(div, /^(\s+\d+  )(\S+)/, () => (what === 'verbs' ? { edit: `${obj}:${verbName(m[1])}` } : { prop: `${obj}.${m[1]}` }));
    }
  } else {
    s.table = null;
    // the blank line between @props + sections keeps lastTable
    if (plain.trim()) s.lastTable = null;
  }
}

// In div's text nodes (not those in a link already), each match of re -> a
// link: data-edit (@edit it) or data-prop (the property editor) from
// ref(match), its text the match's last group (or all of it), any text
// before that group left as it was.
function linkIn(div, re, ref) {
  const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n; (n = walker.nextNode());) if (!n.parentElement.closest('a')) nodes.push(n);
  for (const node of nodes) {
    const parts = [];
    let last = 0;
    for (const m of node.data.matchAll(new RegExp(re.source, re.flags.replace('g', '') + 'g'))) {
      const label = m.length > 1 ? m[m.length - 1] : m[0];
      const start = m.index + m[0].lastIndexOf(label);
      parts.push(node.data.slice(last, start));
      const a = document.createElement('a');
      a.href = '#';
      const r = ref(m);
      if (r.edit) { a.dataset.edit = r.edit; a.title = '@edit ' + r.edit; }
      else { a.dataset.prop = r.prop; a.title = 'Edit ' + r.prop; }
      a.textContent = label;
      parts.push(a);
      last = start + label.length;
      if (!re.global) break;
    }
    if (!parts.length) continue;
    parts.push(node.data.slice(last));
    node.replaceWith(...parts.filter((x) => x !== ''));
    if (!re.global) return;
  }
}

// Show a session's output (or home's) in the output area.
function showOutput(s) {
  const was = out.firstElementChild;
  if (was === s.el) return;
  const prev = was === home.el ? home : sessions.find((x) => x.el === was);
  if (prev) prev.scroll = out.scrollTop;
  out.replaceChildren(s.el);
  out.scrollTop = s.follow ? out.scrollHeight : s.scroll;
  showJump(s);
  $('partial').innerHTML = ansiToHtml(s.partial, { objects: objLinks(s) });
}

// (a session's closed tab can still hear its own "Disconnected": dropped)
tiny.api.on('out', ({ sid, lines }) => { if (bySid(sid)) addLines(bySid(sid), lines); });
tiny.api.on('partial', ({ sid, text }) => {
  const s = bySid(sid);
  if (!s) return;
  s.partial = text;
  if (s === shown()) $('partial').innerHTML = ansiToHtml(text, { objects: objLinks(s) });
});

// links open in the browser, object numbers in an object tab (anywhere),
// verbs in @verbs output with @edit in their session, properties in @props
// output in the property editor, Reconnect connects its session again
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-url], a[data-obj], #out a[data-edit], #out a[data-prop], #out a[data-reconnect]');
  if (!a) return;
  ev.preventDefault();
  if (a.dataset.url) tiny.app.shell.open(a.dataset.url);
  else if (a.dataset.obj) openObject(a.dataset.obj);
  else {
    const s = sessions.find((x) => x.el.contains(a));
    if (a.hasAttribute('data-reconnect')) { if (s) reconnect(s); }
    else if (a.dataset.prop) openProp(s, ...propRef(a.dataset.prop));
    else if (s?.connected) editVerb(s, a.dataset.edit);
  }
});

// --- connecting -----------------------------------------------------------
// Connect opens the chosen world in a session tab: one of its own that has
// dropped (the one showing first), or a new one. Closing the tab disconnects.

let worlds = [];

function renderWorlds() {
  const sel = $('world');
  sel.innerHTML = worlds.map((w, i) => `<option value="${i}">${esc(w.name)}</option>`).join('');
  sel.value = String(Math.max(0, worlds.findIndex((w) => w.name === store.get('world', ''))));
}

function setTitle() {
  tiny.win.setTitle(current ? `moocat — ${current.world}` : 'moocat');
}

tiny.api.on('state', ({ sid, connected, world, mcp, prog }) => {
  const s = bySid(sid);
  if (!s) return;
  s.connected = connected;
  s.mcp = mcp;
  s.prog = prog;
  if (!connected) s.localEdit = false;  // a new login may differ
  else s.el.querySelectorAll('a[data-reconnect]').forEach((a) => a.remove());  // back: they've done their job
  if (world) s.world = world;
  renderTabs();
  if (s === current) $('send').disabled = !connected;
});

$('connect').addEventListener('click', () => {
  const w = worlds[Number($('world').value)];
  if (!w) return openWorlds();
  connectWorld(w);
});

async function connectWorld(w) {
  store.set('world', w.name);
  const live = sessions.find((x) => x.world === w.name && (x.connected || x.connecting));
  if (live) {
    activate(live, null);
    return say(`Already ${live.connected ? 'connected' : 'connecting'} to ${w.name}.`);
  }
  const dropped = (s) => s && !s.connected && s.world === w.name;
  const again = dropped(current) ? current : sessions.find(dropped);
  let s = again;
  if (!s) {
    s = newSession(await call('open'), w.name);
    activate(s, null);
  }
  s.connecting = true;
  try { await call('connect', { world: w, sid: s.sid }); } catch {}  // the session says why
  s.connecting = false;
  if (s !== current) activate(s, null);
  renderTabs();
  input.focus();
}

// A session's Reconnect link, or Enter on an empty line while it's disconnected.
function reconnect(s) {
  const w = findWorld(s.world);
  if (w) connectWorld(w);
  else say(`No world "${s.world}". ` + worldNames());
}

// The last one stays (to leave, close moocat).
// typed: by /close, so only unsent edits are asked about
async function closeSession(s, typed = false) {
  if (sessions.length < 2) return;
  const unsent = s.tabs.filter(dirty).length;
  if (((s.connected && !typed) || unsent) && !confirm(
    `Close ${s.world}${s.connected ? ' and disconnect' : ''}?` +
    (unsent ? ` ${unsent} edit${unsent === 1 ? ' has' : 's have'} unsent changes.` : ''))) return;
  if (s.sid != null) call('close', { sid: s.sid }).catch(() => {});
  const i = sessions.indexOf(s);
  sessions.splice(i, 1);
  if (resultWatch?.tab.session === s) resultWatch = null;
  if (s === current) {
    current = null;
    active = null;
    activate(sessions[Math.min(i, sessions.length - 1)] ?? null, null);
  } else {
    renderTabs();
  }
}

// --- input --------------------------------------------------------------

const input = $('input');
// "connect name password" (or co/conn…): echoed and kept in history without
// the password
const LOGIN = /^(\s*co(?:n(?:n(?:e(?:c(?:t)?)?)?)?)?\s+\S+\s+)\S.*$/i;
const history = store.get('history', []).filter((l) => !LOGIN.test(l));
store.set('history', history);
let histPos = history.length;
let draft = '';

function fitInput() {
  input.style.height = 'auto';
  input.style.height = input.scrollHeight ? input.scrollHeight + 2 + 'px' : '';
  maskInput();
}

// A login line's password shows as *s, each character as typed for
// REVEAL_MS first. The textarea's text goes see-through over a copy with the
// password starred (as the code editor's #hl), as a textarea can't style part
// of its text.
const REVEAL_MS = 500;
const inputWrap = document.createElement('div');
inputWrap.id = 'inputWrap';
const inputMask = document.createElement('div');
inputMask.id = 'inputMask';
inputMask.setAttribute('aria-hidden', 'true');
input.replaceWith(inputWrap);
inputWrap.append(inputMask, input);
let reveal = -1;   // the password character to show for now, by its index in the line
let revealTimer = null;

function maskInput() {
  const m = LOGIN.exec(input.value);
  inputWrap.classList.toggle('masked', !!m);
  if (!m) return;
  const at = m[1].length;
  const pw = [...input.value.slice(at)].map((c, i) => at + i === reveal ? c : '*').join('');
  inputMask.innerHTML = esc(m[1] + pw);
  inputMask.scrollTop = input.scrollTop;
}

input.addEventListener('input', (ev) => {
  clearTimeout(revealTimer);
  // only a character just typed at the caret; a paste or a deletion shows nothing
  reveal = ev.inputType === 'insertText' && ev.data?.length === 1 ? input.selectionStart - 1 : -1;
  if (reveal >= 0) revealTimer = setTimeout(() => { reveal = -1; maskInput(); }, REVEAL_MS);
});
input.addEventListener('scroll', () => { inputMask.scrollTop = input.scrollTop; });

function sendInput() {
  let text = input.value;
  input.value = '';
  fitInput();
  if (text.trim() && !LOGIN.test(text)) {
    if (history.at(-1) !== text) history.push(text);
    if (history.length > 500) history.splice(0, history.length - 500);
    store.set('history', history);
  }
  histPos = history.length;
  const s = current;
  // /commands are moocat's; // sends a line starting with / to the MOO
  if (/^\/(?!\/)/.test(text)) { command(text.trim()); return; }
  if (text.startsWith('//')) text = text.slice(1);
  if (!s?.connected) {
    if (s && !text.trim()) { reconnect(s); return; }
    addLines(s, [{ text: s ? 'Not connected: Connect to connect again.' : 'Not connected: pick a world and Connect.', kind: 'sys' }]);
    return;
  }
  const lines = text.split('\n');
  toBottom();
  addLines(s, lines.map((l) => ({ text: l.replace(LOGIN, '$1********'), kind: 'me' })));
  for (const line of lines) call('send', { sid: s.sid, line });
}

input.addEventListener('input', fitInput);
$('inputForm').addEventListener('submit', (ev) => { ev.preventDefault(); sendInput(); input.focus(); });
input.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendInput();
  } else if (ev.key === 'ArrowUp' && !input.value.slice(0, input.selectionStart).includes('\n')) {
    if (histPos === 0) return;
    if (histPos === history.length) draft = input.value;
    input.value = history[--histPos];
    fitInput();
    ev.preventDefault();
  } else if (ev.key === 'ArrowDown' && !input.value.slice(input.selectionEnd).includes('\n')) {
    if (histPos >= history.length) return;
    input.value = ++histPos === history.length ? draft : history[histPos];
    fitInput();
    ev.preventDefault();
  } else if ((ev.key === 'PageUp' || ev.key === 'PageDown') && !ev.ctrlKey) {
    out.scrollBy(0, (ev.key === 'PageUp' ? -1 : 1) * out.clientHeight * 0.9);
    ev.preventDefault();
  }
});

// --- /commands ------------------------------------------------------------
// Typed in the input, never sent to the MOO (// sends a line starting with /).

const COMMANDS = {
  help: ['', 'these commands', () => say(Object.entries(COMMANDS).map(([n, [args, what]]) =>
    `/${n}${args ? ' ' + args : ''} — ${what}`).concat('//text — send /text to the MOO')) ],
  clear: ['', "clear this session's output", (s) => { (s ?? home).el.replaceChildren(); toBottom(); }],
  close: ['', 'close this session and disconnect (the last one only disconnects)', (s) => {
    if (!s) return say('No session.');
    if (sessions.length > 1) return closeSession(s, true);
    if (s.connected) call('disconnect', { sid: s.sid });
    else say('Not connected (the last session stays open).');
  }],
  disconnect: ['', 'disconnect, keeping the tab', (s) => {
    if (!s?.connected) return say('Not connected.');
    call('disconnect', { sid: s.sid });
  }],
  connect: ['[world]', 'connect this session again, or open a world in a new tab', (s, arg) => {
    if (!arg) {
      if (!s) return say('Which world? ' + worldNames());
      if (s.connected) return say(`Already connected to ${s.world}.`);
      arg = s.world;
    }
    const w = findWorld(arg);
    if (!w) return say(`No world "${arg}". ` + worldNames());
    connectWorld(w);
  }],
  'close-tabs': ['', 'close every edit and object tab', () => {
    const all = sessions.flatMap((x) => x.tabs);
    if (!all.length) return say('No tabs to close.');
    const unsent = all.filter(dirty).length;
    if (unsent && !confirm(`Close all tabs? ${unsent} edit${unsent === 1 ? ' has' : 's have'} unsent changes.`)) return;
    for (const x of sessions) {
      for (const t of x.tabs) if (t.kind === 'edit') call('closeEdit', { sid: x.sid, id: t.id }).catch(() => {});
      x.tabs = [];
    }
    activate(current, null);
    say(`Closed ${all.length} tab${all.length === 1 ? '' : 's'}.`);
  }],
  enable: ['', 'make #object numbers links in this session', (s) => setLinks(s, true)],
  disable: ['', 'stop making #object numbers links in this session', (s) => setLinks(s, false)],
  theme: ['[name]', 'switch colour theme', (s, arg) => {
    const t = arg && themes.find((x) => x === arg.toLowerCase() || THEME_NAMES[x].toLowerCase() === arg.toLowerCase());
    if (!t) return say((arg ? `No theme "${arg}". ` : '') + 'Themes: ' + themes.map((x) => THEME_NAMES[x]).join(', '));
    setTheme(t);
  }],
  worlds: ['', 'add and edit worlds', () => {
    if ($('worlds').offsetParent === null) return say("Worlds are fixed here.");
    openWorlds();
  }],
};

// moocat's own word, in the session showing
const say = (text) => addLines(current, [].concat(text).map((t) => ({ text: t, kind: 'sys' })));
const worldNames = () => 'Worlds: ' + worlds.map((w) => w.name).join(', ');
const findWorld = (name) => worlds.find((w) => w.name.toLowerCase() === name.toLowerCase())
  ?? worlds.find((w) => w.name.toLowerCase().startsWith(name.toLowerCase()));

function command(text) {
  const [, name, arg] = /^\/(\S*)\s*(.*)$/.exec(text);
  addLines(current, [{ text, kind: 'me' }]);
  const c = COMMANDS[name.toLowerCase()];
  if (!c) return say(`Unknown command /${name}: /help lists them.`);
  c[2](current, arg.trim());
}

// /enable, /disable: the session's lines so far too
function setLinks(s, on) {
  if (!s) return say('No session.');
  s.links = on;
  for (const line of s.el.children) if (!line.classList.contains('me')) relink(line, on);
  say(on ? 'Object numbers are links in this session.' : 'Object numbers are plain text in this session.');
}

const OBJ_RE = /(?<![\w#$])#\d+\b/g;
function relink(el, on) {
  if (!on) {
    for (const a of el.querySelectorAll('a[data-obj]')) a.replaceWith(a.textContent);
    el.normalize();
    return;
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('a')) texts.push(walker.currentNode);
  for (const node of texts) {
    const t = node.textContent;
    if (!OBJ_RE.test(t)) continue;
    OBJ_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of t.matchAll(OBJ_RE)) {
      frag.append(t.slice(last, m.index));
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.obj = m[0];
      a.textContent = m[0];
      frag.append(a);
      last = m.index + m[0].length;
    }
    frag.append(t.slice(last));
    node.replaceWith(frag);
  }
}

// --- tabs ---------------------------------------------------------------
// Each session's tab, then its own tabs: each @edit opens one (kind 'edit'),
// and each object clicked one (kind 'obj'). Their keys are strings: an
// edit's id, or the object number. (SMud graphics open windows of their own:
// smud-win.js.)

const ta = $('text');
const hl = $('hl');
const scroller = $('codeScroll');
// edit: { kind, key, session, id, name, reference, type, protocol, orig, text, sel, scroll, bad, result }
// obj:  { kind, key, session, obj, name, data, error, scroll }

const isCode = (t) => t.type === 'moo-code';
const dirty = (t) => t.kind === 'edit' && t.text !== t.orig;

// every tab in order, as [session, tab or null]
const allTabs = () => sessions.flatMap((s) => [[s, null], ...s.tabs.map((t) => [s, t])]);

function sessionTitle(s) {
  return !s.connected ? `${s.world}: not connected (Connect to connect again)`
    : `Connected to ${s.world}` + (s.mcp === 'edit' ? ' · MCP editing' : s.mcp === 'up' ? ' · MCP' : '');
}

function renderTabs() {
  const keys = new Map(allTabs().map(([s, t], i) => [t ?? s, i < 9 ? ` (Alt+${i + 1})` : '']));
  $('tabs').innerHTML = sessions.map((s) =>
    `<div class="tab session${s === current && !active ? ' active' : ''}${s.connected ? ' on' : ''}${s.mcp === 'edit' ? ' edit' : ''}"` +
    ` data-sid="${s.sid ?? ''}" data-key="" title="${esc(sessionTitle(s) + keys.get(s))}">` +
    `<span class="dot"></span><span class="name">${esc(s.world)}</span>` +
    (s.missed ? `<span class="badge">${s.missed > 999 ? '999+' : s.missed}</span>` : '') +
    (sessions.length > 1 ? `<button class="x" title="Close and disconnect">×</button>` : '') + '</div>' +
    s.tabs.map((t) =>
      `<div class="tab ${t.kind}${t === active ? ' active' : ''}${dirty(t) ? ' dirty' : ''}" data-sid="${s.sid ?? ''}" data-key="${esc(t.key)}"` +
      ` title="${esc((t.kind === 'obj' ? t.obj : t.reference) + ' on ' + s.world + keys.get(t))}">` +
      `<span class="name">${esc(t.name)}</span><button class="x" title="Close (Ctrl+W)">×</button></div>`).join('')).join('');
  $('tabs').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  tabArrows();
  setTitle();
}

// No scrollbar on the tab strip: an arrow at each end with tabs past it
// slides it along, and so does the wheel.
const strip = $('tabs');
// (within the strip's own end padding counts as at the end)
function tabArrows() {
  $('tabsLeft').hidden = strip.scrollLeft <= 10;
  $('tabsRight').hidden = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 10;
}
function slide(dir) {
  strip.scrollBy({ left: dir * strip.clientWidth * 0.7, behavior: 'smooth' });
  setTimeout(tabArrows, 400);  // after the slide, should no scroll event come
}
$('tabsLeft').addEventListener('click', () => slide(-1));
$('tabsRight').addEventListener('click', () => slide(1));
strip.addEventListener('scroll', tabArrows);
strip.addEventListener('wheel', (ev) => {
  if (!ev.deltaY || ev.deltaX) return;  // a sideways wheel or touchpad scrolls by itself
  strip.scrollLeft += ev.deltaY;
  ev.preventDefault();
}, { passive: false });
new ResizeObserver(tabArrows).observe(strip);

function stash() {
  if (active?.kind === 'obj') active.scroll = [$('objview').scrollTop, 0];
  if (active?.kind !== 'edit') return;
  active.text = ta.value;
  active.sel = [ta.selectionStart, ta.selectionEnd];
  active.scroll = [scroller.scrollTop, scroller.scrollLeft];
}

// Show session S's tab t (null: the session itself; S null: home).
function activate(s, t) {
  stash();
  current = s;
  active = t;
  showOutput(s ?? home);
  $('session').hidden = !!t;
  $('editor').hidden = t?.kind !== 'edit';
  $('objview').hidden = t?.kind !== 'obj';
  $('send').disabled = !s?.connected;
  if (!t) {
    if (s) s.missed = 0;
    renderTabs();
    input.focus();
    return;
  }
  renderTabs();
  if (t.kind === 'obj') {
    renderObject(t);
    $('objview').scrollTop = t.scroll[0];
    return;
  }
  ta.value = t.text;
  $('editInfo').textContent = `${t.reference} · ${isCode(t) ? 'MOO code' : 'text'} · MCP ${t.protocol}`;
  showResult(t.result ?? '', t.resultClass ?? '');
  render();
  ta.focus();
  ta.setSelectionRange(...t.sel);
  [scroller.scrollTop, scroller.scrollLeft] = t.scroll;
}

function cycle(step) {
  const all = allTabs();
  if (!all.length) return;
  const i = all.findIndex(([s, t]) => s === current && t === active);
  activate(...all[(i + step + all.length) % all.length]);
}

tiny.api.on('edit', (e) => {
  const s = bySid(e.sid);
  if (!s) return;
  const text = e.lines.join('\n');
  // the same verb or text again replaces its tab, unless that has unsent changes
  stash();
  let t = s.tabs.find((x) => x.kind === 'edit' && x.reference === e.reference && !dirty(x));
  if (t) {
    call('closeEdit', { sid: s.sid, id: t.id });
    Object.assign(t, { key: String(e.id), id: e.id, name: e.name, type: e.type, protocol: e.protocol, orig: text, text,
                       sel: [0, 0], scroll: [0, 0], bad: null, result: '' });
    if (t === active) active = null;  // so activate() reloads it
  } else {
    t = { kind: 'edit', key: String(e.id), session: s, id: e.id, name: e.name, reference: e.reference, type: e.type,
          protocol: e.protocol, orig: text, text, sel: [0, 0], scroll: [0, 0], bad: null };
    s.tabs.push(t);
  }
  activate(s, t);
});

function closeTab(t) {
  if (dirty(t) && !confirm(`Close ${t.name} without sending your changes?`)) return;
  const s = t.session;
  const i = s.tabs.indexOf(t);
  s.tabs.splice(i, 1);
  if (t.kind === 'edit') call('closeEdit', { sid: s.sid, id: t.id }).catch(() => {});
  if (t === active) {
    active = null;
    activate(s, s.tabs[Math.min(i, s.tabs.length - 1)] ?? null);
  } else {
    renderTabs();
  }
}

// a tab's element -> [session, tab or null]
function tabFor(el) {
  const s = sessions.find((x) => String(x.sid ?? '') === el.dataset.sid);
  if (!s) return null;
  return [s, el.dataset.key === '' ? null : s.tabs.find((x) => x.key === el.dataset.key) ?? null];
}
function closeEither([s, t]) {
  if (t) closeTab(t);
  else closeSession(s);
}
$('tabs').addEventListener('click', (ev) => {
  const el = ev.target.closest('.tab');
  const st = el && tabFor(el);
  if (!st) return;
  if (ev.target.closest('.x')) closeEither(st);
  else if (st[0] !== current || st[1] !== active) activate(...st);
});
$('tabs').addEventListener('auxclick', (ev) => {
  const el = ev.target.closest('.tab');
  const st = el && tabFor(el);
  if (st && ev.button === 1) closeEither(st);
});

// --- editor -------------------------------------------------------------
// A transparent textarea over the highlighted text, both in one scroller and
// both sized by the text, so they wrap identically; each line is a div whose
// number sits in the gutter, so wrapped lines keep one number.

let wrap = store.get('wrap', true);

function setWrap(on) {
  wrap = on;
  store.set('wrap', on);
  $('code').classList.toggle('nowrap', !on);
  ta.wrap = on ? 'soft' : 'off';
  $('wrap').checked = on;
}

function render() {
  const t = active;
  const html = (isCode(t) ? highlightMoo(ta.value) : plain(ta.value)).split('\n');
  hl.innerHTML = html.map((l, i) =>
    `<div class="ln${t.bad?.has(i + 1) ? ' bad' : ''}" data-n="${i + 1}">${l || '​'}</div>`).join('');
}

// Keep the caret's line on screen: the textarea never scrolls itself.
function caretIntoView() {
  const line = ta.value.slice(0, ta.selectionEnd).split('\n').length - 1;
  const el = hl.children[line];
  if (!el) return;
  const top = el.offsetTop, bottom = top + el.offsetHeight;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight + 8;
}

function showResult(text, cls) {
  const r = $('result');
  r.textContent = text;
  r.className = cls;
  r.title = text;
}

async function sendEdit() {
  const t = active;
  if (t?.kind !== 'edit' || !t.session.connected) return;
  stash();
  try {
    await call('upload', { sid: t.session.sid, id: t.id, text: t.text });
  } catch (e) {
    t.result = String(e.message ?? e);
    t.resultClass = 'bad';
    showResult(t.result, 'bad');
    return;
  }
  t.unsent = t.orig;  // what the MOO has, if it rejects this
  t.orig = t.text;
  t.bad = null;
  t.result = 'Sent…';
  t.resultClass = '';
  showResult('Sent…', '');
  resultWatch = { tab: t, until: Date.now() + 4000, lines: [] };
  renderTabs();
  render();
}

// What the MOO says back after a send, shown under the editor: @program's
// "0 errors." / "Verb programmed." or its "Line 3:  parse error" list.
function watchResult(lines) {
  const w = resultWatch;
  if (Date.now() > w.until) { resultWatch = null; return; }
  for (const { text, kind } of lines) if (kind !== 'me' && text.trim()) w.lines.push(text);
  if (!w.lines.length) return;
  const all = w.lines.join('  ');
  const errs = w.lines.map((l) => /^Line (\d+):/.exec(l)).filter(Boolean).map((m) => Number(m[1]));
  const bad = errs.length > 0 ||
    (/not programmed|syntax|^E_|denied|not found|invalid|I don't understand/im.test(all) && !/\b0 errors\b/.test(all));
  const t = w.tab;
  t.result = w.lines.join(' · ');
  t.resultClass = bad ? 'bad' : 'ok';
  t.bad = errs.length ? new Set(errs) : null;
  if (bad) t.orig = t.unsent;  // not accepted: still unsent
  renderTabs();
  if (t === active) {
    showResult(t.result, t.resultClass);
    render();
  }
}

// Insert keeping the textarea's undo history.
function insert(text) {
  document.execCommand('insertText', false, text);
}

const OPENS = /^\s*(if|elseif|else|for|while|fork|try|except|finally)\b/;

ta.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl || ev.altKey) return;  // tab keys: the document handler
  if (ev.key === 'Escape') { activate(current, null); return; }
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  const lineStart = v.lastIndexOf('\n', s - 1) + 1;
  if (ev.key === 'Tab') {
    ev.preventDefault();
    if (s === e && !ev.shiftKey) return insert('  ');
    // indent or dedent every selected line
    const end = e > s && v[e - 1] === '\n' ? e - 1 : e;
    const block = v.slice(lineStart, end);
    const changed = ev.shiftKey
      ? block.replace(/^ {1,2}/gm, '')
      : block.replace(/^/gm, '  ');
    ta.setSelectionRange(lineStart, end);
    insert(changed);
    ta.setSelectionRange(lineStart, lineStart + changed.length);
  } else if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    const line = v.slice(lineStart, s);
    let indent = /^\s*/.exec(line)[0];
    if (isCode(active) && OPENS.test(line)) indent += '  ';
    insert('\n' + indent);
  }
});

ta.addEventListener('input', () => {
  const t = active;
  const was = dirty(t);
  t.text = ta.value;
  render();
  caretIntoView();
  if (was !== dirty(t)) renderTabs();
});
ta.addEventListener('keyup', (ev) => { if (ev.key.startsWith('Arrow') || ev.key.startsWith('Page') || ev.key === 'Home' || ev.key === 'End') caretIntoView(); });
ta.addEventListener('scroll', () => { ta.scrollTop = 0; });  // the scroller scrolls, never the textarea

$('send').addEventListener('click', sendEdit);
$('revert').addEventListener('click', () => {
  if (active?.kind !== 'edit') return;
  ta.select();
  insert(active.orig);
  ta.setSelectionRange(0, 0);
  scroller.scrollTop = 0;
});
$('wrap').addEventListener('change', (ev) => { setWrap(ev.target.checked); ta.focus(); });
setWrap(wrap);

// Ctrl+S send, Ctrl+W close (a session's tab: disconnect), Ctrl+Tab /
// Ctrl+PageUp/Down next and previous tab, Alt+1…9 a tab by number.
document.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && ev.key === 's') { ev.preventDefault(); sendEdit(); }
  else if (ctrl && ev.key === 'w') { ev.preventDefault(); if (active) closeTab(active); else if (current) closeSession(current); }
  else if (ctrl && (ev.key === 'Tab' || ev.key === 'PageDown' || ev.key === 'PageUp')) {
    ev.preventDefault();
    cycle(ev.key === 'PageUp' || (ev.key === 'Tab' && ev.shiftKey) ? -1 : 1);
  } else if (ev.altKey && /^[1-9]$/.test(ev.key)) {
    const all = allTabs();
    const i = Number(ev.key) - 1;
    if (i < all.length) { ev.preventDefault(); activate(...all[i]); }
  } else if (!ctrl && !ev.altKey && ev.key.length === 1 && active?.kind !== 'edit'
             && !ev.target.closest?.('input, textarea, select, [contenteditable], dialog')) {
    // typing outside a text box (output, tabs, an object tab): to the input,
    // where the key itself lands, as focus moves before it's typed
    if (active) activate(current, null);
    input.focus();
  }
});

// --- object tabs --------------------------------------------------------

// on the session showing
async function openObject(obj) {
  const s = current;
  if (!s?.connected || !objLinks(s)) return;
  stash();
  let t = s.tabs.find((x) => x.kind === 'obj' && x.obj === obj);
  if (!t) {
    t = { kind: 'obj', key: obj, session: s, obj, name: obj, data: null, error: null, scroll: [0, 0] };
    s.tabs.push(t);
  }
  t.loading = true;
  activate(s, t);
  try {
    t.data = await call('inspect', { sid: s.sid, obj });
    t.name = `${plainText(t.data.name)} (${obj})`;
    t.error = null;
  } catch (e) {
    t.error = String(e.message ?? e);
  }
  t.loading = false;
  renderTabs();
  if (active === t) renderObject(t);
}

const objLink = (o, label) => /^#\d+$/.test(o)
  ? `<a href="#" data-obj="${esc(o)}">${esc(label ? `${label} (${o})` : o)}</a>`
  : esc(label ? `${label} (${o})` : o);

// The same in the object's header, with the name's colours.
const objLinkColour = (o, label) => {
  const html = label ? `${colourText(label, { links: false })} (${esc(o)})` : esc(o);
  return /^#\d+$/.test(o) ? `<a href="#" data-obj="${esc(o)}">${html}</a>` : html;
};

// Properties or verbs, grouped by the object that defines them: its own
// first, open; inherited ones collapsed.
function groups(t, items, row, head) {
  const d = t.data;
  const order = [d.obj, ...d.ancestors.map((a) => a.obj)];
  const names = Object.fromEntries([[d.obj, d.name], ...d.ancestors.map((a) => [a.obj, a.name])]);
  return order.map((def) => {
    const mine = items.filter((x) => x.definer === def);
    if (!mine.length) return '';
    const label = def === d.obj ? 'Defined here' : `From ${objLink(def, names[def])}`;
    return `<details ${def === d.obj ? 'open' : ''}><summary>${label} <span class="count">${mine.length}</span></summary>` +
      `<table><thead><tr>${head}</tr></thead><tbody>${mine.map(row).join('')}</tbody></table></details>`;
  }).join('');
}

function renderObject(t) {
  const v = $('objview');
  const head = `<div class="objhead"><h1>${t.data?.name != null ? colourText(t.data.name, { links: false }) : esc(t.obj)} <span class="objnum">${esc(t.obj)}</span></h1>` +
    `<button id="objRefresh"${t.loading ? ' disabled' : ''}>${t.loading ? 'Reading…' : 'Refresh'}</button></div>`;
  if (!t.data) {
    v.innerHTML = head + `<p class="${t.error ? 'objerr' : 'dim'}">${esc(t.error ?? 'Reading the object…')}</p>`;
    return;
  }
  const d = t.data;
  const flags = Object.entries(d.flags).filter(([, on]) => on).map(([f]) =>
    `<span class="chip">${{ player: 'player', wizard: 'wizard', programmer: 'programmer', r: 'readable', w: 'writable', f: 'fertile' }[f]}</span>`).join('');
  const parentName = d.ancestors[0]?.name;
  const ownProps = d.properties.filter((p) => p.definer === d.obj).length;
  const ownVerbs = d.verbs.filter((x) => x.definer === d.obj).length;
  v.innerHTML = head + (t.error ? `<p class="objerr">${esc(t.error)}</p>` : '') +
    `<div class="chips">${flags}</div>` +
    `<dl class="meta">` +
    `<dt>Parent</dt><dd>${objLinkColour(d.parent, parentName)}</dd>` +
    `<dt>Owner</dt><dd>${objLinkColour(d.owner, d.ownerName)}</dd>` +
    `<dt>Location</dt><dd>${objLinkColour(d.location, d.locationName)}</dd>` +
    `<dt>Ancestry</dt><dd>${d.ancestors.map((a) => objLinkColour(a.obj, a.name)).join(' → ') || 'none'}</dd>` +
    `<dt>Children / contents</dt><dd>${d.children} / ${d.contents}</dd></dl>` +
    `<h2>Description</h2><div class="desc">${d.description.length ? d.description.map((l) => colourText(l)).join('<br>') : '<span class="dim">none</span>'}</div>` +
    (d.notes.length ? `<p class="objerr">${d.notes.map(esc).join('<br>')}</p>` : '') +
    `<h2>Properties <span class="count">${ownProps} here, ${d.properties.length} in all</span></h2>` +
    groups(t, d.properties, (p) =>
      `<tr><td class="pname"><a href="#" data-prop="${esc(d.obj)}.${esc(p.name)}" title="Edit ${esc(d.obj)}.${esc(p.name)}">${esc(p.name)}</a></td>` +
      `<td class="val">${linkText(p.value)}</td>` +
      `<td>${objLink(p.owner)}</td><td class="perms">${esc(p.perms)}</td></tr>`,
      '<th>Name</th><th>Value</th><th>Owner</th><th>Perms</th>') +
    `<h2>Verbs <span class="count">${ownVerbs} here, ${d.verbs.length} in all</span></h2>` +
    groups(t, d.verbs, (x) =>
      `<tr><td class="pname"><a href="#" data-edit="${esc(x.definer)}:${esc(verbName(x.names))}" title="@edit ${esc(x.definer)}:${esc(verbName(x.names))}">${esc(x.names)}</a></td>` +
      `<td class="args">${esc(x.args)}</td><td>${objLink(x.owner)}</td><td class="perms">${esc(x.perms)}</td></tr>`,
      '<th>Names</th><th>Args</th><th>Owner</th><th>Perms</th>');
}

// "l*ook examine" -> "look": a name @edit can find the verb by
const verbName = (names) => names.split(' ')[0].replace('*', '');

// A question with buttons: [{ label, value, primary }] -> the value chosen,
// or null for Esc. text is HTML.
function choose(title, text, buttons) {
  const dlg = $('askDialog');
  $('askTitle').textContent = title;
  $('askText').innerHTML = text;
  $('askButtons').innerHTML = buttons.map((b, i) =>
    `<button value="${i}"${b.primary ? ' class="primary" autofocus' : ''}>${esc(b.label)}</button>`).join('');
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(buttons[Number(dlg.returnValue)]?.value ?? null), { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

// @edit from the object tab: only into a tab here if the MOO does MCP
// editing and the player's local editing is on; otherwise say so first,
// offering to turn it on (@edito +local), as @edit would otherwise open the
// MOO's own editor in the session.
async function editVerb(s, ref) {
  const edit = () => {
    addLines(s, [{ text: '@edit ' + ref, kind: 'me' }]);
    call('send', { sid: s.sid, line: '@edit ' + ref });
  };
  if (s.localEdit) return edit();
  const MOO_EDITOR = { label: "Use the MOO's editor", value: 'moo' };
  const CANCEL = { label: 'Cancel', value: null };
  let check;
  try { check = await call('editCheck', { sid: s.sid }); } catch { return; }
  let choice;
  if (check.mcp !== 'edit') {
    choice = await choose('No local editing here',
      `${esc(s.world)} hasn't offered MCP editing${check.mcp === 'none' ? ' (no MCP at all)' : ''}, so ` +
      `<code>@edit ${esc(ref)}</code> would open the MOO's own editor in the session, not a tab here.`,
      [CANCEL, MOO_EDITOR]);
  } else if (check.local) {
    s.localEdit = true;
    return edit();
  } else {
    choice = await choose('Local editing is off',
      (check.local === false ? 'Your local editing is off' : "moocat couldn't tell whether your local editing is on") +
      `, so <code>@edit ${esc(ref)}</code> may open the MOO's own editor in the session. ` +
      'Turn it on (<code>@edito +local</code>) to edit verbs in a tab here.',
      [CANCEL, MOO_EDITOR, { label: 'Turn it on and edit', value: 'local', primary: true }]);
  }
  if (choice === 'local') {
    addLines(s, [{ text: '@edito +local', kind: 'me' }]);
    call('send', { sid: s.sid, line: '@edito +local' });
    s.localEdit = true;
  }
  if (choice) edit();
}

$('objview').addEventListener('click', (ev) => {
  if (ev.target.id === 'objRefresh' && active?.kind === 'obj') {
    openObject(active.obj);
    return;
  }
  const a = ev.target.closest('a[data-edit], a[data-prop]');
  if (!a) return;
  ev.preventDefault();
  const s = active?.session;
  if (a.dataset.prop) openProp(s, ...propRef(a.dataset.prop));
  else if (s?.connected) editVerb(s, a.dataset.edit);
});

// --- property editor ------------------------------------------------------
// One property of one object in a popup, from the object tab or @props
// output: read whole (the object tab's values are cut short), edited by its
// type or as a MOO literal, and saved only if it's still what was read.

const TYPE_NAMES = { 0: 'integer', 1: 'object', 2: 'string', 3: 'error', 4: 'list', 9: 'float', 10: 'map',
                     12: 'anonymous object', 13: 'waif', 14: 'true/false' };
const ERRORS = ('E_NONE E_TYPE E_DIV E_PERM E_PROPNF E_VERBNF E_VARNF E_INVIND E_RECMOVE E_MAXREC E_RANGE ' +
                'E_ARGS E_NACC E_INVARG E_QUOTA E_FLOAT E_FILE E_EXEC E_INTRPT').split(' ');
// an ESC as \e, as the backend reads it (inspect.js's mooString)
const mooStr = (t) => '"' + t.replace(/[\\"]/g, '\\$&').replaceAll('\x1b', '\\e') + '"';
// The text editors show an ESC (an ANSI code's start, invisible) as \e, and
// read \e back as one; a preview under them shows the colours.
const showEsc = (t) => t.replaceAll('\x1b', '\\e');
const readEsc = (t) => t.replaceAll('\\e', '\x1b');
const PREVIEW_HINT = ' An ANSI code\'s ESC is \\e (\\e[1;31m red, \\e[0m back to normal), previewed below.';

// Under a string's textarea: its lines in colour, when it has any (\e codes
// or ToastCore's [red] tags).
function colourPreview() {
  const el = $('pvPreview'), v = $('pv').value;
  el.hidden = !/\\e\[|\[[a-z]+\]/.test(v);
  if (!el.hidden) el.innerHTML = v.split('\n').map((l) => `<div>${colourText(readEsc(l), { links: false }) || '​'}</div>`).join('');
}
const propDlg = $('propDialog');

// { s, obj, name, info (readProp's), expect (the literal to find on saving),
//   kind (the editor showing), literal, value } or null
let prop = null;

// The editor for a value: by type, a list of strings as lines; the rest, and
// a list of strings one of which holds a newline, as a MOO literal.
function editorKind(type, value) {
  if (type === 12 || type === 13 || (value == null && type !== 0)) return 'readonly';
  const kinds = { 0: 'int', 9: 'float', 1: 'obj', 3: 'err', 14: 'bool', 2: 'str' };
  if (kinds[type]) return kinds[type];
  if (type === 4 && value.length && value.every((x) => typeof x === 'string' && !x.includes('\n'))) return 'lines';
  return 'literal';
}

// A long list or map, one element to a line, nested ones too while they're
// long; short ones as they are. Strings are kept whole.
function pretty(literal, indent = '') {
  if (literal.length + indent.length <= 76 || !/^[{[]/.test(literal)) return literal;
  const parts = [];
  let depth = 0, start = 1, i = 1;
  for (; i < literal.length - 1; i++) {
    const c = literal[i];
    if (c === '"') { i++; while (i < literal.length && literal[i] !== '"') i += literal[i] === '\\' ? 2 : 1; }
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { parts.push(literal.slice(start, i).trim()); start = i + 1; }
  }
  const last = literal.slice(start, -1).trim();
  if (last) parts.push(last);
  if (!parts.length) return literal;
  const inner = indent + '  ';
  return literal[0] + '\n' + parts.map((x) => inner + pretty(x, inner)).join(',\n') + '\n' + indent + literal.at(-1);
}

async function openProp(s, obj, name) {
  if (!s?.connected || !objLinks(s)) return;
  prop = { s, obj, name, info: null };
  $('propTitle').textContent = `${obj}.${name}`;
  $('propMeta').textContent = '';
  $('propBody').innerHTML = '<p class="dim">Reading…</p>';
  $('propRaw').hidden = true;
  $('propClear').hidden = true;
  $('propSave').disabled = true;
  propMsg('');
  if (!propDlg.open) propDlg.showModal();
  let info;
  try {
    info = await call('readProp', { sid: s.sid, obj, prop: name });
  } catch (e) {
    info = { err: String(e.message ?? e) };
  }
  if (prop?.obj !== obj || prop.name !== name) return;  // closed, or another opened
  if (!info || info.err) {
    $('propBody').innerHTML = '';
    propMsg(`Couldn't read it: ${info?.err ?? 'no answer from the MOO'}` +
            (info?.err === 'E_PERM' ? " (it isn't readable by you)" : ''), true);
    return;
  }
  Object.assign(prop, { info, expect: info.literal });
  const canWrite = info.wizard || info.owner === info.player || info.perms.includes('w');
  $('propMeta').innerHTML = `${esc(TYPE_NAMES[info.type] ?? 'type ' + info.type)} · owner ${objLink(info.owner)} · ` +
    `perms ${esc(info.perms || '—')}` + (info.clear ? ' · <b>inherited</b>: no value of its own' : '');
  $('propClear').hidden = info.here || info.clear;
  $('propSave').disabled = !canWrite;
  $('propClear').disabled = !canWrite;
  if (!canWrite) propMsg("Read-only: it isn't yours, and it isn't writable (w).");
  showEditor(info.type, info.value, info.literal);
}

function propMsg(text, bad = false) {
  $('propMsg').textContent = text;
  $('propMsg').classList.toggle('bad', bad);
}

// Fills the body with the editor for this value (literal: as the MOO wrote it).
function showEditor(type, value, literal, asLiteral = false) {
  const kind = asLiteral ? 'literal' : editorKind(type, value);
  Object.assign(prop, { kind, type, value, literal });
  const body = $('propBody');
  const raw = $('propLiteral');
  $('propRaw').hidden = kind === 'readonly';
  raw.checked = kind === 'literal';
  // a value with no editor of its own can't leave the literal one
  raw.disabled = kind === 'literal' && editorKind(type, value) === 'literal';
  switch (kind) {
    case 'readonly':
      body.innerHTML = `<pre class="mooHl">${highlightMoo(literal)}</pre><p class="hint">A ${esc(TYPE_NAMES[type])} can't be edited here.</p>`;
      $('propSave').disabled = true;
      break;
    case 'str':
      body.innerHTML = '<textarea id="pv" spellcheck="false"></textarea><div id="pvPreview" hidden></div>' +
        '<p class="hint">One line: ANSI and SMud codes as written. Several lines are saved as a list of strings.' +
        PREVIEW_HINT + '</p>';
      $('pv').value = showEsc(value);
      $('pv').addEventListener('input', colourPreview);
      colourPreview();
      break;
    case 'lines':
      body.innerHTML = '<textarea id="pv" class="big" spellcheck="false"></textarea><div id="pvPreview" hidden></div>' +
        `<p class="hint">A list of strings, one to a line.${PREVIEW_HINT}</p>`;
      $('pv').value = value.map(showEsc).join('\n');
      $('pv').addEventListener('input', colourPreview);
      colourPreview();
      break;
    case 'int': case 'float':
      body.innerHTML = '<input id="pv" spellcheck="false" inputmode="decimal">';
      $('pv').value = literal;
      break;
    case 'obj':
      body.innerHTML = '<input id="pv" spellcheck="false" placeholder="#123"><p class="hint objname" id="pvName"></p>';
      $('pv').value = value.obj;
      $('pv').addEventListener('input', objPreview);
      objPreview();
      break;
    case 'err':
      body.innerHTML = `<select id="pv">${ERRORS.map((e) => `<option>${e}</option>`).join('')}</select>`;
      $('pv').value = value.err;
      break;
    case 'bool':
      body.innerHTML = '<label class="check"><input type="checkbox" id="pv"> true</label>';
      $('pv').checked = value === true;
      break;
    default:
      body.innerHTML = '<div class="hlbox"><pre class="mooHl" aria-hidden="true"></pre>' +
        '<textarea id="pv" class="big" spellcheck="false"></textarea></div>' +
        '<p class="hint">Any MOO value: {lists}, ["maps" -> 1], "strings", #objects, numbers, E_ERRORS. Laid out over lines as you like.</p>';
      $('pv').value = pretty(literal);
      highlightBox($('pv'));
  }
  $('pv')?.focus();
}

// Highlights a textarea's MOO as you type, as the code editor does: the
// textarea's text is see-through, over a <pre> of the highlighted copy.
function highlightBox(el) {
  const back = el.previousElementSibling;
  // a trailing newline is a line in the textarea but not in the <pre>
  const draw = () => { back.innerHTML = highlightMoo(el.value) + (el.value.endsWith('\n') ? ' ' : ''); scroll(); };
  const scroll = () => { back.scrollTop = el.scrollTop; back.scrollLeft = el.scrollLeft; };
  el.addEventListener('input', draw);
  el.addEventListener('scroll', scroll);
  draw();
}

// the #123 box's object, named as you type
let previewTimer = null;
function objPreview() {
  clearTimeout(previewTimer);
  const el = $('pvName');
  const o = $('pv').value.trim();
  if (!/^#-?\d+$/.test(o)) { el.textContent = 'An object number: #123'; el.classList.add('bad'); return; }
  previewTimer = setTimeout(async () => {
    const p = prop;
    const r = await call('objName', { sid: p.s.sid, obj: o }).catch(() => null);
    if (prop !== p || $('pv')?.value.trim() !== o) return;
    el.textContent = r?.valid ? plainText(r.name) || '(no name)' : `${o} isn't a valid object (it can still be saved)`;
    el.classList.toggle('bad', !r?.valid);
  }, 250);
}

// What the editor holds, as a MOO literal; null if there's nothing to save
// (a question answered Cancel). Throws, saying why, if it can't be one.
async function editorLiteral() {
  const el = $('pv');
  const v = (prop.kind === 'str' || prop.kind === 'lines' ? readEsc : String)(el?.value ?? '');
  switch (prop.kind) {
    case 'str': {
      if (!v.includes('\n')) return mooStr(v);
      // a newline in a string property breaks the database: not that
      const how = await choose('Several lines',
        'A string property can\'t hold a newline. Save the lines as a list of strings, or joined into one line?',
        [{ label: 'Cancel', value: null }, { label: 'Join them', value: 'join' },
         { label: 'List of strings', value: 'list', primary: true }]);
      if (!how) return null;
      const lines = v.replace(/\n$/, '').split('\n');
      return how === 'join' ? mooStr(lines.join(' ')) : `{${lines.map(mooStr).join(', ')}}`;
    }
    case 'lines':
      return `{${v.replace(/\n$/, '').split('\n').map(mooStr).join(', ')}}`;
    case 'int':
      if (!/^-?\d+$/.test(v.trim())) throw new Error('Not a whole number.');
      return v.trim();
    case 'float': {
      const t = v.trim();
      if (!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) throw new Error('Not a number.');
      return /[.e]/i.test(t) ? t : t + '.0';  // stays a float
    }
    case 'obj':
      if (!/^#-?\d+$/.test(v.trim())) throw new Error('Not an object number: #123.');
      return v.trim();
    case 'err': return v;
    case 'bool': return el.checked ? 'true' : 'false';
    default:
      return (await call('literal', { sid: prop.s.sid, text: v })).literal;
  }
}

$('propLiteral').addEventListener('change', async (ev) => {
  if (!prop?.info) return;
  try {
    if (ev.target.checked) {
      const lit = await editorLiteral();
      if (lit == null) { ev.target.checked = false; return; }
      showEditor(prop.type, prop.value, lit, true);
    } else {
      const r = await call('literal', { sid: prop.s.sid, text: $('pv').value });
      showEditor(r.type, r.value, r.literal);
    }
    propMsg('');
  } catch (e) {
    ev.target.checked = !ev.target.checked;
    propMsg(String(e.message ?? e), true);
  }
});

async function saveProp(clear = false) {
  const p = prop;
  if (!p?.info) return;
  let literal = null;
  if (!clear) {
    try {
      literal = await editorLiteral();
    } catch (e) {
      propMsg(String(e.message ?? e), true);
      return;
    }
    if (literal == null) return;
  }
  $('propSave').disabled = $('propClear').disabled = true;
  propMsg(clear ? 'Clearing…' : 'Saving…');
  let r;
  try {
    r = await call('writeProp', { sid: p.s.sid, obj: p.obj, prop: p.name, literal, expect: p.expect });
  } catch (e) {
    r = { err: String(e.message ?? e) };
  }
  if (prop !== p) return;
  $('propSave').disabled = $('propClear').disabled = false;
  if (r.err) {
    propMsg(`The MOO said ${r.err}` + (r.err === 'E_PERM' ? ": you can't write it." : '') +
            (r.err === 'E_TYPE' ? ': it may only take some types.' : ''), true);
  } else if (!r.ok) {
    // someone (or some verb) changed it meanwhile: say what to, save again to overwrite
    p.expect = r.literal;
    propMsg(`It changed since you opened it, to ${r.literal.length > 120 ? r.literal.slice(0, 120) + '…' : r.literal}. ` +
            'Save again to overwrite that, or Cancel.', true);
  } else {
    propDlg.close();
    addLines(p.s, [{ text: `${clear ? 'Cleared' : 'Set'} ${p.obj}.${p.name}.`, kind: 'sys' }]);
    if (active?.kind === 'obj' && active.obj === p.obj && active.session === p.s) openObject(p.obj);
  }
}

$('propSave').addEventListener('click', () => saveProp());
$('propClear').addEventListener('click', () => saveProp(true));
// (its close event comes after close(): by then another may have opened)
propDlg.addEventListener('close', () => { if (!propDlg.open) { prop = null; clearTimeout(previewTimer); } });
// Enter in a one-line box saves; in a text box it's a newline
$('propForm').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.id === 'pv') { ev.preventDefault(); saveProp(); }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); saveProp(); }
});

// "#152.state" -> [obj, name]
const propRef = (ref) => { const i = ref.indexOf('.'); return [ref.slice(0, i), ref.slice(i + 1)]; };

// --- worlds dialog ------------------------------------------------------

const dlg = $('worldsDialog');
const form = $('worldsForm');
let editing = [];
let selIdx = -1;

function fillForm() {
  const w = editing[selIdx] ?? { name: '', host: '', port: 7777, tls: false, login: '', smud: false };
  form.name.value = w.name;
  form.host.value = w.host;
  form.port.value = w.port;
  form.tls.checked = w.tls;
  form.login.value = w.login;
  form.smud.checked = !!w.smud;
  $('worldList').innerHTML = editing.map((x, i) =>
    `<li data-i="${i}" class="${i === selIdx ? 'sel' : ''}">${esc(x.name || '(new)')}</li>`).join('');
  $('worldDelete').disabled = selIdx < 0;
}

function readForm() {
  return { name: form.name.value.trim(), host: form.host.value.trim(), port: Number(form.port.value),
           tls: form.tls.checked, login: form.login.value, smud: form.smud.checked };
}

function openWorlds() {
  editing = worlds.map((w) => ({ ...w }));
  selIdx = Math.max(0, Number($('world').value) || 0);
  if (!editing.length) selIdx = -1;
  fillForm();
  dlg.showModal();
}

$('worlds').addEventListener('click', openWorlds);
$('worldList').addEventListener('click', (ev) => {
  const li = ev.target.closest('li');
  if (!li) return;
  selIdx = Number(li.dataset.i);
  fillForm();
});
form.addEventListener('input', () => {
  if (selIdx < 0) return;
  editing[selIdx] = readForm();
  const li = $('worldList').children[selIdx];
  if (li) li.textContent = editing[selIdx].name || '(new)';
});
$('worldNew').addEventListener('click', () => {
  editing.push({ name: 'New world', host: '', port: 7777, tls: false, login: '', smud: false });
  selIdx = editing.length - 1;
  fillForm();
  form.host.focus();
});
$('worldDelete').addEventListener('click', () => {
  if (selIdx < 0) return;
  editing.splice(selIdx, 1);
  selIdx = Math.min(selIdx, editing.length - 1);
  fillForm();
});
$('worldSave').addEventListener('click', async () => {
  if (selIdx >= 0 && !form.reportValidity()) return;
  const bad = editing.find((w) => !w.name || !w.host || !(w.port > 0));
  if (bad) return tiny.dialog.alert('Each world needs a name, host and port.');
  const key = (w) => w.name.toLowerCase();
  const twice = editing.find((w, i) => editing.findIndex((x) => key(x) === key(w)) !== i);
  if (twice) return tiny.dialog.alert(`There is already a world called "${twice.name}".`);
  worlds = editing;
  await call('saveWorlds', { worlds });
  if (worlds[selIdx]) store.set('world', worlds[selIdx].name);
  renderWorlds();
  dlg.close();
});

// --- start --------------------------------------------------------------

async function start() {
  worlds = await call('worlds');
  renderWorlds();
  // sessions the backend already has (the page was reloaded)
  for (const x of await call('sessions')) Object.assign(newSession(x.sid, x.world ?? 'Session'), { connected: x.connected, mcp: x.mcp, prog: x.prog });
  activate(sessions[0] ?? null, null);
  fitInput();
  input.focus();
  addLines(null, [{ text: 'moocat: pick a world and Connect. On the MOO, @edito +local once, then @edit a verb.', kind: 'sys' }]);
}

start().catch((e) => addLines(null, [{ text: 'start failed: ' + e, kind: 'err' }]));
