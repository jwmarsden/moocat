// MOO code -> highlighted HTML (escaped), for the editor's overlay.

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const KEYWORDS = new Set(('if elseif else endif for endfor in while endwhile fork endfork ' +
  'return try except finally endtry break continue any').split(' '));

// strings, $names and #objects, errors, numbers, words, operators
const TOKEN = /("(?:[^"\\\n]|\\.)*"?)|(\$\w*)|(#-?\d+)|(\bE_[A-Z]+\b)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)|([^\s\w"$#]+)/g;

export function highlightMoo(src) {
  let html = '';
  let last = 0;
  let prev = '';  // last non-space token, to tell properties and verbs apart
  for (const m of src.matchAll(TOKEN)) {
    html += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    const t = m[0];
    let cls = null;
    if (m[1]) cls = 'str';
    else if (m[2] || m[3]) cls = 'obj';
    else if (m[4]) cls = 'err';
    else if (m[5]) cls = 'num';
    else if (m[6]) {
      if (prev === '.') cls = 'prop';
      else if (prev === ':') cls = 'verb';
      else if (KEYWORDS.has(t)) cls = 'kw';
      else if (/^\s*\(/.test(src.slice(last))) cls = 'fn';
    } else if (m[7]) {
      cls = 'op';
    }
    // a statement that is only a string is MOO's comment
    if (cls === 'str' && /^\s*$/.test(src.slice(src.lastIndexOf('\n', m.index - 1) + 1, m.index))
        && /^\s*;\s*$/.test(src.slice(last, (src.indexOf('\n', last) + 1 || src.length + 1) - 1))) cls = 'com';
    html += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
    prev = m[7] ? t.slice(-1) : t;
  }
  return html + esc(src.slice(last));
}

export function plain(src) {
  return esc(src);
}
