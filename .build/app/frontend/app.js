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

// --- output -------------------------------------------------------------

const out = $('out');
let resultWatch = null;  // { id, until, lines } after an upload: the MOO's answer

// Output follows new lines unless you've scrolled up; then a button counts
// what came in below. Following is set only by scrolling, so a resize (the
// prompt line, a taller input, the editor opening) never unpins it.
let follow = true;
let unseen = 0;

function atBottom() {
  return out.scrollHeight - out.scrollTop - out.clientHeight < 8;
}

function toBottom() {
  follow = true;
  out.scrollTop = out.scrollHeight;
  unseen = 0;
  $('jump').hidden = true;
}

out.addEventListener('scroll', () => {
  follow = atBottom();
  if (follow && unseen) toBottom();
});
new ResizeObserver(() => { if (follow) out.scrollTop = out.scrollHeight; }).observe(out);
$('jump').addEventListener('click', toBottom);

function addLines(lines) {
  const frag = document.createDocumentFragment();
  for (const { text, kind } of lines) {
    const div = document.createElement('div');
    if (kind) div.className = kind;
    div.innerHTML = kind === 'me' ? esc(text) : ansiToHtml(text);
    frag.append(div);
  }
  out.append(frag);
  while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
  if (follow) {
    out.scrollTop = out.scrollHeight;
  } else {
    unseen += lines.length;
    $('jump').textContent = `↓ ${unseen} new line${unseen === 1 ? '' : 's'}`;
    $('jump').hidden = false;
  }
  if (active) {
    missed += lines.filter((l) => l.kind !== 'me').length;
    renderTabs();
  }
  if (resultWatch) watchResult(lines);
}

tiny.api.on('out', ({ lines }) => addLines(lines));
tiny.api.on('partial', ({ text }) => { $('partial').innerHTML = ansiToHtml(text); });

// links open in the browser, object numbers in an object tab (anywhere)
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-url], a[data-obj]');
  if (!a) return;
  ev.preventDefault();
  if (a.dataset.url) tiny.app.shell.open(a.dataset.url);
  else openObject(a.dataset.obj);
});

// --- connection ---------------------------------------------------------

let worlds = [];
let connected = false;

function renderWorlds() {
  const sel = $('world');
  sel.innerHTML = worlds.map((w, i) => `<option value="${i}">${esc(w.name)}</option>`).join('');
  sel.value = String(Math.max(0, worlds.findIndex((w) => w.name === store.get('world', ''))));
}

function setState({ connected: c, world, mcp }) {
  connected = c;
  $('connect').textContent = c ? 'Disconnect' : 'Connect';
  $('world').disabled = c;
  const st = $('status');
  st.className = !c ? '' : mcp === 'edit' ? 'edit' : 'on';
  $('statusText').textContent = !c ? 'Not connected'
    : world + (mcp === 'edit' ? ' · MCP editing' : mcp === 'up' ? ' · MCP' : '');
  tiny.win.setTitle(c ? `moocat — ${world}` : 'moocat');
  worldName = c ? world : null;
  renderTabs();
  $('send').disabled = !c;
}
tiny.api.on('state', setState);

$('connect').addEventListener('click', async () => {
  if (connected) return call('disconnect');
  const w = worlds[Number($('world').value)];
  if (!w) return openWorlds();
  store.set('world', w.name);
  try { await call('connect', { world: w }); } catch {}
  $('input').focus();
});

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
}

function sendInput() {
  const text = input.value;
  input.value = '';
  fitInput();
  if (text.trim() && !LOGIN.test(text)) {
    if (history.at(-1) !== text) history.push(text);
    if (history.length > 500) history.splice(0, history.length - 500);
    store.set('history', history);
  }
  histPos = history.length;
  if (!connected) {
    addLines([{ text: 'Not connected.', kind: 'sys' }]);
    return;
  }
  const lines = text.split('\n');
  toBottom();
  addLines(lines.map((l) => ({ text: l.replace(LOGIN, '$1********'), kind: 'me' })));
  for (const line of lines) call('send', { line });
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

// --- tabs ---------------------------------------------------------------
// Tab 1 is the session; each @edit opens another (kind 'edit'), and each
// object clicked one more (kind 'obj'). `active` is the tab showing, or null
// for the session. Tab keys are strings: an edit's id, or the object number.
// (SMud graphics open windows of their own: smud-win.js.)

const ta = $('text');
const hl = $('hl');
const scroller = $('codeScroll');
const tabs = [];       // edit: { kind, key, id, name, reference, type, protocol, orig, text, sel, scroll, bad, result }
                       // obj:  { kind, key, obj, name, data, error, scroll }
let active = null;
let missed = 0;        // session lines that came in while an edit tab was showing
let worldName = null;

const isCode = (t) => t.type === 'moo-code';
const dirty = (t) => t.kind === 'edit' && t.text !== t.orig;

function renderTabs() {
  const session = `<div class="tab session${active ? '' : ' active'}" data-key="" title="Alt+1">` +
    `<span class="name">${esc(worldName ?? 'Session')}</span>` +
    (missed ? `<span class="badge">${missed > 999 ? '999+' : missed}</span>` : '') + '</div>';
  $('tabs').innerHTML = session + tabs.map((t, i) =>
    `<div class="tab ${t.kind}${t === active ? ' active' : ''}${dirty(t) ? ' dirty' : ''}" data-key="${esc(t.key)}"` +
    ` title="${esc(t.kind === 'obj' ? t.obj : t.reference)}${i < 8 ? ` (Alt+${i + 2})` : ''}">` +
    `<span class="name">${esc(t.name)}</span><button class="x" title="Close (Ctrl+W)">×</button></div>`).join('');
  $('tabs').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function stash() {
  if (active?.kind === 'obj') active.scroll = [$('objview').scrollTop, 0];
  if (active?.kind !== 'edit') return;
  active.text = ta.value;
  active.sel = [ta.selectionStart, ta.selectionEnd];
  active.scroll = [scroller.scrollTop, scroller.scrollLeft];
}

// Show an edit tab, or the session for null.
function activate(t) {
  stash();
  active = t;
  $('session').hidden = !!t;
  $('editor').hidden = t?.kind !== 'edit';
  $('objview').hidden = t?.kind !== 'obj';
  if (!t) {
    missed = 0;
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
  const all = [null, ...tabs];
  activate(all[(all.indexOf(active) + step + all.length) % all.length]);
}

tiny.api.on('edit', (e) => {
  const text = e.lines.join('\n');
  // the same verb or text again replaces its tab, unless that has unsent changes
  stash();
  let t = tabs.find((x) => x.kind === 'edit' && x.reference === e.reference && !dirty(x));
  if (t) {
    call('closeEdit', { id: t.id });
    Object.assign(t, { key: String(e.id), id: e.id, name: e.name, type: e.type, protocol: e.protocol, orig: text, text,
                       sel: [0, 0], scroll: [0, 0], bad: null, result: '' });
    if (t === active) active = null;  // so activate() reloads it
  } else {
    t = { kind: 'edit', key: String(e.id), id: e.id, name: e.name, reference: e.reference, type: e.type, protocol: e.protocol,
          orig: text, text, sel: [0, 0], scroll: [0, 0], bad: null };
    tabs.push(t);
  }
  activate(t);
});

function closeTab(t) {
  if (dirty(t) && !confirm(`Close ${t.name} without sending your changes?`)) return;
  const i = tabs.indexOf(t);
  tabs.splice(i, 1);
  if (t.kind === 'edit') call('closeEdit', { id: t.id });
  if (t === active) {
    active = null;
    activate(tabs[Math.min(i, tabs.length - 1)] ?? null);
  } else {
    renderTabs();
  }
}

const tabFor = (el) => (el.dataset.key === '' ? null : tabs.find((x) => x.key === el.dataset.key));
$('tabs').addEventListener('click', (ev) => {
  const el = ev.target.closest('.tab');
  if (!el) return;
  const t = tabFor(el);
  if (ev.target.closest('.x')) closeTab(t);
  else if (t !== active) activate(t);
});
$('tabs').addEventListener('auxclick', (ev) => {
  const el = ev.target.closest('.tab');
  if (el && ev.button === 1 && tabFor(el)) closeTab(tabFor(el));
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
  if (t?.kind !== 'edit' || !connected) return;
  stash();
  try {
    await call('upload', { id: t.id, text: t.text });
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
  if (ev.key === 'Escape') { activate(null); return; }
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

// Ctrl+S send, Ctrl+W close, Ctrl+Tab / Ctrl+PageUp/Down next and previous
// tab, Alt+1…9 a tab by number.
document.addEventListener('keydown', (ev) => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  if (ctrl && ev.key === 's') { ev.preventDefault(); sendEdit(); }
  else if (ctrl && ev.key === 'w') { ev.preventDefault(); if (active) closeTab(active); }
  else if (ctrl && (ev.key === 'Tab' || ev.key === 'PageDown' || ev.key === 'PageUp')) {
    ev.preventDefault();
    cycle(ev.key === 'PageUp' || (ev.key === 'Tab' && ev.shiftKey) ? -1 : 1);
  } else if (ev.altKey && /^[1-9]$/.test(ev.key)) {
    const all = [null, ...tabs];
    const i = Number(ev.key) - 1;
    if (i < all.length) { ev.preventDefault(); activate(all[i]); }
  } else if (!ctrl && !ev.altKey && ev.key.length === 1 && active?.kind !== 'edit'
             && !ev.target.closest?.('input, textarea, select, [contenteditable], dialog')) {
    // typing outside a text box (output, tabs, an object tab): to the input,
    // where the key itself lands, as focus moves before it's typed
    if (active) activate(null);
    input.focus();
  }
});

// --- object tabs --------------------------------------------------------

async function openObject(obj) {
  if (!connected) return addLines([{ text: 'Not connected.', kind: 'sys' }]);
  stash();
  let t = tabs.find((x) => x.kind === 'obj' && x.obj === obj);
  if (!t) {
    t = { kind: 'obj', key: obj, obj, name: obj, data: null, error: null, scroll: [0, 0] };
    tabs.push(t);
  }
  t.loading = true;
  activate(t);
  try {
    t.data = await call('inspect', { obj });
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
      `<tr><td class="pname">${esc(p.name)}</td><td class="val">${linkText(p.value)}</td>` +
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

$('objview').addEventListener('click', (ev) => {
  if (ev.target.id === 'objRefresh' && active?.kind === 'obj') {
    openObject(active.obj);
    return;
  }
  const a = ev.target.closest('a[data-edit]');
  if (!a) return;
  ev.preventDefault();
  const cmd = '@edit ' + a.dataset.edit;
  addLines([{ text: cmd, kind: 'me' }]);
  call('send', { line: cmd });
});

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
  setState(await call('state'));
  activate(null);
  fitInput();
  input.focus();
  addLines([{ text: 'moocat: pick a world and Connect. On the MOO, @edito +local once, then @edit a verb.', kind: 'sys' }]);
}

start().catch((e) => addLines([{ text: 'start failed: ' + e, kind: 'err' }]));
