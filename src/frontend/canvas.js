// SMud graphics in a tab: a canvas the MOO draws on (pen, brush and font,
// lines, shapes, text, macros) with components (buttons, edit boxes, lists)
// over it, as the SMud client did. Clicks and the answers to the MOO's
// queries go back as #$# lines. Drawing follows Delphi's TCanvas, and
// colours are TColors: $BBGGRR.
//
//   const c = new SmudCanvas({ id, width, height, name, send(pairs) })
//   c.el            the element to show
//   c.handle(msg)   a parsed line (backend/smud.js), except create/destroy,
//                   which are the tab's
//   c.onrename(name), c.onresize(width, height)   when the MOO renames or
//                   resizes it

const NAMED = {
  clblack: 0x000000, clmaroon: 0x000080, clgreen: 0x008000, clolive: 0x008080, clnavy: 0x800000,
  clpurple: 0x800080, clteal: 0x808000, clgray: 0x808080, clsilver: 0xc0c0c0, clred: 0x0000ff,
  cllime: 0x00ff00, clyellow: 0x00ffff, clblue: 0xff0000, clfuchsia: 0xff00ff, claqua: 0xffff00,
  clwhite: 0xffffff, clbtnface: 0xd8e9ec, clwindow: 0xffffff, clwindowtext: 0x000000,
};
const FACE = 0xd8e9ec;  // what a system colour (clBtnFace and co.) comes out as

// "$4444DF", 14540253 or "clRed" -> "#df4444"
export function color(v) {
  const s = String(v ?? '').trim().toLowerCase();
  let n;
  if (/^\$[0-9a-f]+$/.test(s)) n = parseInt(s.slice(1), 16);
  else if (/^-?\d+$/.test(s)) n = Number(s);
  else n = NAMED[s] ?? 0;
  if (n < 0 || n > 0xffffff) n = FACE;
  return '#' + [n & 255, (n >> 8) & 255, (n >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// a list of strings as a MOO literal: {"a", "b"}
const literal = (list) => '{' + list.map((s) => '"' + String(s).replace(/[\\"]/g, '\\$&') + '"').join(', ') + '}';

// "psDash" or "dash" -> "dash"
const style = (v, prefix) => String(v ?? '').trim().toLowerCase().replace(new RegExp('^' + prefix), '');
const num = (v) => Math.round(Number(v) || 0);

const DASH = { solid: [], insideframe: [], dash: [18, 6], dot: [3, 3], dashdot: [9, 6, 3, 6], dashdotdot: [9, 3, 3, 3, 3, 3] };
// GDI raster ops, as near as canvas compositing gets; the rest draw as copy
const MODE = { xor: 'difference', notxor: 'difference', not: 'difference', merge: 'lighten', mask: 'darken',
               mergepennot: 'lighten', maskpennot: 'darken', mergenotpen: 'lighten', masknotpen: 'darken' };
const invert = (c) => '#' + (0xffffff - parseInt(c.slice(1), 16)).toString(16).padStart(6, '0');
const CELLS = new Map();  // font -> its ascent and descent per pixel of size
const FONTS = { 'ms sans serif': 'Tahoma, "DejaVu Sans", sans-serif', system: 'sans-serif', 'courier new': '"Courier New", monospace',
                courier: '"Courier New", monospace', fixedsys: 'monospace', terminal: 'monospace' };

export class SmudCanvas {
  constructor({ id, width, height, name, send }) {
    this.id = id;
    this.name = name;
    this.send = send;
    this.onrename = () => {};
    this.onresize = () => {};
    this.pen = { color: '#000000', width: 1, style: 'solid', mode: 'copy' };
    this.brush = { color: '#ffffff', style: 'solid' };
    this.font = { name: 'MS Sans Serif', size: 8, height: -11, color: '#000000', style: new Set() };
    this.clickops = null;     // the canvas's own click and double-click macros
    this.dblclickops = null;
    this.pos = [0, 0];
    this.comps = new Map();  // name -> { type, el, clickops, dblclickops, tag }
    this.fit = true;

    this.el = document.createElement('div');
    this.el.className = 'smud';
    this.el.innerHTML = '<div class="smudbar"><span class="dim"></span><span class="spacer"></span>' +
      '<label class="check" title="Shrink the picture to fit the window"><input type="checkbox" checked> Fit</label></div>' +
      '<div class="smudscroll"><div class="smudsizer"><div class="smudboard"><canvas></canvas><div class="comps"></div></div></div></div>';
    this.scroll = this.el.querySelector('.smudscroll');
    this.sizer = this.el.querySelector('.smudsizer');
    this.board = this.el.querySelector('.smudboard');
    this.cv = this.el.querySelector('canvas');
    this.layer = this.el.querySelector('.comps');
    this.el.querySelector('input').addEventListener('change', (ev) => { this.fit = ev.target.checked; this.layout(); });
    new ResizeObserver(() => this.layout()).observe(this.scroll);

    // A double-click is a click, then a doubleclick: SMud sent both.
    this.cv.addEventListener('click', (ev) => {
      const [x, y] = this.at(ev);
      const kind = ev.detail === 2 ? 'doubleclick' : ev.detail === 1 ? 'click' : null;
      const ops = kind === 'click' ? this.clickops : kind === 'doubleclick' ? this.dblclickops : null;
      if (ops) this.run(ops);
      if (kind) this.send([['image', this.id], [kind, 'left'], ['clickx', x], ['clicky', y]]);
    });
    this.cv.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const [x, y] = this.at(ev);
      this.send([['image', this.id], ['click', 'right'], ['clickx', x], ['clicky', y]]);
    });

    this.resize(num(width) || 100, num(height) || 100);
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // canvas pixels under a mouse event, whatever the scale
  at(ev) {
    const r = this.cv.getBoundingClientRect();
    return [Math.floor((ev.clientX - r.left) * this.width / r.width),
            Math.floor((ev.clientY - r.top) * this.height / r.height)];
  }

  layout() {
    const w = this.scroll.clientWidth, h = this.scroll.clientHeight;
    const s = this.fit && w && h ? Math.min(1, w / this.width, h / this.height) : 1;
    this.board.style.transform = s === 1 ? '' : `scale(${s})`;
    this.sizer.style.width = this.width * s + 'px';
    this.sizer.style.height = this.height * s + 'px';
    this.el.querySelector('.dim').textContent = `${this.width}×${this.height}` + (s < 1 ? ` · ${Math.round(s * 100)}%` : '');
  }

  // keeps what's drawn
  resize(w, h) {
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    let old = null;
    if (this.ctx) {
      old = document.createElement('canvas');
      old.width = this.cv.width;
      old.height = this.cv.height;
      old.getContext('2d').drawImage(this.cv, 0, 0);
    }
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.board.style.width = w + 'px';
    this.board.style.height = h + 'px';
    this.ctx = this.cv.getContext('2d', { willReadFrequently: false });
    this.ctx.fillStyle = color(FACE);
    this.ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    if (old) this.ctx.drawImage(old, 0, 0);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  // --- drawing tools -----------------------------------------------------

  // Set the context up for the pen; false for a clear pen.
  usePen() {
    const p = this.pen, c = this.ctx;
    if (p.style === 'clear' || p.mode === 'nop') return false;
    c.strokeStyle = { not: '#ffffff', black: '#000000', white: '#ffffff', notcopy: invert(p.color),
                      notmerge: invert(p.color), notmask: invert(p.color) }[p.mode] ?? p.color;
    c.lineWidth = Math.max(1, p.width);
    c.setLineDash(p.width > 1 ? [] : DASH[p.style] ?? []);
    c.lineCap = p.width > 1 ? 'round' : 'butt';
    c.lineJoin = p.width > 1 ? 'round' : 'miter';
    c.globalCompositeOperation = MODE[p.mode] ?? 'source-over';
    return true;
  }

  // the brush as a fill style, or null for a clear one
  brushFill() {
    const b = this.brush;
    if (b.style === 'clear') return null;
    if (b.style === 'solid' || !b.style) return b.color;
    const t = document.createElement('canvas');
    t.width = t.height = 8;
    const c = t.getContext('2d');
    c.strokeStyle = b.color;
    c.lineWidth = 1;
    c.beginPath();
    const h = b.style === 'horizontal' || b.style === 'cross', v = b.style === 'vertical' || b.style === 'cross';
    const f = b.style === 'fdiagonal' || b.style === 'diagcross', bd = b.style === 'bdiagonal' || b.style === 'diagcross';
    if (h) { c.moveTo(0, 3.5); c.lineTo(8, 3.5); }
    if (v) { c.moveTo(3.5, 0); c.lineTo(3.5, 8); }
    if (f) { c.moveTo(0, 0); c.lineTo(8, 8); }
    if (bd) { c.moveTo(8, 0); c.lineTo(0, 8); }
    c.stroke();
    return this.ctx.createPattern(t, 'repeat');
  }

  // half a pixel for odd pens, so 1-pixel lines land on pixels
  get off() { return this.pen.width % 2 ? 0.5 : 0; }

  fillAndStroke(path, fill = true) {
    const c = this.ctx;
    const f = fill && this.brushFill();
    if (f) { c.globalCompositeOperation = 'source-over'; c.fillStyle = f; c.fill(path); }
    if (this.usePen()) c.stroke(path);
    c.globalCompositeOperation = 'source-over';
  }

  // The font as GDI sizes it: Delphi's Font.Height is the letters' size when
  // negative, the whole cell (ascent + descent) when positive. TextOut puts
  // the cell's top at y.
  metrics() {
    const f = this.font, st = f.style;  // a Set
    const family = FONTS[f.name.toLowerCase()] ?? `"${f.name.replace(/"/g, '')}", sans-serif`;
    const look = `${st.has('italic') ? 'italic ' : ''}${st.has('bold') ? 'bold ' : ''}`;
    let r = CELLS.get(look + family);
    if (!r) {
      this.ctx.font = `${look}100px ${family}`;
      const m = this.ctx.measureText('Hg');
      r = { asc: (m.fontBoundingBoxAscent || 90) / 100, desc: (m.fontBoundingBoxDescent || 25) / 100 };
      CELLS.set(look + family, r);
    }
    const em = f.height > 0 ? f.height / (r.asc + r.desc) : -f.height;
    return { css: `${look}${em}px ${family}`, em, ascent: em * r.asc, cell: Math.round(em * (r.asc + r.desc)) };
  }

  textSize(text) {
    const m = this.metrics();
    this.ctx.font = m.css;
    return [Math.ceil(this.ctx.measureText(text).width), m.cell];
  }

  // --- drawing -----------------------------------------------------------

  moveTo(x, y) { this.pos = [x, y]; }

  lineTo(x, y) {
    const [x0, y0] = this.pos, o = this.off;
    const p = new Path2D();
    p.moveTo(x0 + o, y0 + o);
    p.lineTo(x + o, y + o);
    this.fillAndStroke(p, false);
    this.pos = [x, y];
  }

  // Rectangle and FillRect leave out the right and bottom edges, as GDI does.
  rectangle(x1, y1, x2, y2) {
    const c = this.ctx, f = this.brushFill(), o = this.off;
    if (f) { c.fillStyle = f; c.fillRect(x1, y1, x2 - x1, y2 - y1); }
    if (this.usePen()) {
      const w = this.pen.width, i = this.pen.style === 'insideframe' ? Math.floor(w / 2) : 0;
      c.strokeRect(x1 + o + i, y1 + o + i, x2 - x1 - 1 - 2 * i, y2 - y1 - 1 - 2 * i);
    }
    c.globalCompositeOperation = 'source-over';
  }

  fillRect(x1, y1, x2, y2) {
    const f = this.brushFill();
    if (!f) return;
    this.ctx.fillStyle = f;
    this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  ellipse(x1, y1, x2, y2) {
    const p = new Path2D();
    p.ellipse((x1 + x2 - 1) / 2 + this.off, (y1 + y2 - 1) / 2 + this.off,
              Math.max(0, (x2 - x1 - 1) / 2), Math.max(0, (y2 - y1 - 1) / 2), 0, 0, Math.PI * 2);
    this.fillAndStroke(p);
  }

  roundRect(x1, y1, x2, y2, xd, yd) {
    const p = new Path2D(), o = this.off;
    const rx = Math.min(xd / 2, (x2 - x1) / 2), ry = Math.min(yd / 2, (y2 - y1) / 2);
    p.roundRect(x1 + o, y1 + o, x2 - x1 - 1, y2 - y1 - 1, [{ x: rx, y: ry }]);
    this.fillAndStroke(p);
  }

  // Arc, Chord and Pie: part of the ellipse in (x1,y1)-(x2,y2), anticlockwise
  // from where a line from its centre to (x3,y3) crosses it to (x4,y4)
  arc(kind, x1, y1, x2, y2, x3, y3, x4, y4) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(0.5, (x2 - x1) / 2), ry = Math.max(0.5, (y2 - y1) / 2);
    const ang = (x, y) => Math.atan2((y - cy) / ry, (x - cx) / rx);
    let a0 = ang(x3, y3), a1 = ang(x4, y4);
    if (a0 === a1) a1 = a0 - Math.PI * 2;
    const p = new Path2D();
    if (kind === 'pie') p.moveTo(cx, cy);
    p.ellipse(cx, cy, rx, ry, 0, a0, a1, true);
    if (kind !== 'arc') p.closePath();
    this.fillAndStroke(p, kind !== 'arc');
  }

  // TextOut: the brush behind the text, the pen moved to its end
  textOut(x, y, text) {
    const c = this.ctx;
    const [w, h] = this.textSize(text);
    const m = this.metrics();
    const f = this.brushFill();
    if (f) { c.fillStyle = f; c.fillRect(x, y, w, h); }
    c.font = m.css;
    c.fillStyle = this.font.color;
    c.textBaseline = 'alphabetic';
    c.fillText(text, x, y + m.ascent);
    const st = this.font.style;
    if (st.has('underline') || st.has('strikeout')) {
      const t = Math.max(1, Math.round(m.em / 14));
      if (st.has('underline')) c.fillRect(x, Math.round(y + m.ascent + t + 1), w, t);
      if (st.has('strikeout')) c.fillRect(x, Math.round(y + m.ascent - m.em * 0.3), w, t);
    }
    this.pos = [x + w, y];
  }

  // FloodFill with the brush colour, from (x,y): "border" fills up to the
  // given colour, "surface" fills what is that colour. A little tolerance,
  // for edges the canvas smoothed.
  floodFill(x, y, col, how) {
    const c = this.ctx, d = this.dpr, W = this.cv.width, H = this.cv.height;
    const sx = Math.round(x * d), sy = Math.round(y * d);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const img = c.getImageData(0, 0, W, H), px = img.data;
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [tr, tg, tb] = hex(color(col));
    const [fr, fg, fb] = hex(this.brush.color);
    const near = (i) => Math.abs(px[i] - tr) + Math.abs(px[i + 1] - tg) + Math.abs(px[i + 2] - tb) < 60;
    const surface = style(how, 'fs') === 'surface';
    const inside = (i) => (surface ? near(i) : !near(i));
    const seen = new Uint8Array(W * H);
    const stack = [sy * W + sx];
    while (stack.length) {
      const p = stack.pop();
      if (seen[p] || !inside(p * 4)) continue;
      seen[p] = 1;
      px[p * 4] = fr; px[p * 4 + 1] = fg; px[p * 4 + 2] = fb; px[p * 4 + 3] = 255;
      const px0 = p % W;
      if (px0 > 0) stack.push(p - 1);
      if (px0 < W - 1) stack.push(p + 1);
      if (p >= W) stack.push(p - W);
      if (p < W * (H - 1)) stack.push(p + W);
    }
    c.putImageData(img, 0, 0);
  }

  setPen(k, v) {
    if (k === 'color') this.pen.color = color(v);
    else if (k === 'width') this.pen.width = Math.max(1, num(v));
    else if (k === 'style') this.pen.style = style(v, 'ps');
    else if (k === 'mode') this.pen.mode = style(v, 'pm');
  }

  setBrush(k, v) {
    if (k === 'color') this.brush.color = color(v);
    else if (k === 'style') this.brush.style = style(v, 'bs');
  }

  // size is points, height pixels (negative: the character height); a style
  // toggles: "bold" turns bold on, or off again
  setFont(k, v) {
    const f = this.font;
    if (k === 'name') f.name = String(v).trim() || 'MS Sans Serif';
    else if (k === 'size') { f.size = Math.abs(num(v)) || 8; f.height = -Math.round(f.size * 96 / 72); }
    else if (k === 'height') { f.height = num(v) || -11; f.size = Math.round(Math.abs(f.height) * 72 / 96); }
    else if (k === 'color') f.color = color(v);
    else if (k === 'style') {
      for (const s of String(v).toLowerCase().split(/[\s,\[\]]+/)) {
        const flag = s.replace(/^fs/, '');
        if (['bold', 'italic', 'underline', 'strikeout'].includes(flag)) f.style.has(flag) ? f.style.delete(flag) : f.style.add(flag);
      }
    }
  }

  // The device-pixel box, clipped to the canvas, of `rows` rows of `w` canvas
  // pixels from (x,y); null if none of it is on the canvas.
  deviceBox(x, y, w, rows) {
    const d = this.dpr;
    const x0 = Math.max(0, Math.round(x * d)), y0 = Math.max(0, Math.round(y * d));
    const x1 = Math.min(this.cv.width, Math.round((x + w) * d)), y1 = Math.min(this.cv.height, Math.round((y + rows) * d));
    return x1 > x0 && y1 > y0 ? { x0, y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // setcolors: pixels from (x,y), `width` to a row (0: to the right edge).
  // One putImageData for the lot, each pixel a d x d block of device pixels.
  setColors(x, y, width, colors) {
    const w = width > 0 ? width : this.width - x, d = this.dpr;
    if (w <= 0 || !colors.length) return;
    const box = this.deviceBox(x, y, w, Math.ceil(colors.length / w));
    if (!box) return;
    const rgb = colors.map((c) => {
      const n = parseInt(color(/^[0-9a-f]+$/i.test(c) ? '$' + c : c).slice(1), 16);
      return [n >> 16, (n >> 8) & 255, n & 255];
    });
    // read first: the last row may be short, and what's past it stays
    const img = this.ctx.getImageData(box.x0, box.y0, box.w, box.h), px = img.data;
    // the canvas pixel a device pixel is in, as fillRect rounds it: p is in
    // pixel k when round(k*d) <= p < round((k+1)*d)
    const cell = (p) => {
      let k = Math.floor(p / d);
      while (Math.round((k + 1) * d) <= p) k++;
      while (k > 0 && Math.round(k * d) > p) k--;
      return k;
    };
    for (let py = 0; py < box.h; py++) {
      const row = cell(box.y0 + py) - y;
      for (let pxx = 0; pxx < box.w; pxx++) {
        const col = cell(box.x0 + pxx) - x;
        const c = col >= 0 && col < w && row >= 0 ? rgb[row * w + col] : null;
        if (!c) continue;
        const o = (py * box.w + pxx) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
    this.ctx.putImageData(img, box.x0, box.y0);
  }

  // getcolors: the same pixels, back as TColor numbers. Reads only the rows
  // asked for, not the whole canvas.
  getColors(x, y, width, count) {
    const w = width > 0 ? width : this.width - x, d = this.dpr;
    const out = new Array(count).fill(0);
    const box = w > 0 && count > 0 && this.deviceBox(x, y, w, Math.ceil(count / w));
    if (!box) return out;
    const img = this.ctx.getImageData(box.x0, box.y0, box.w, box.h).data;
    for (let i = 0; i < count; i++) {
      const px = Math.round((x + (i % w)) * d) - box.x0, py = Math.round((y + Math.floor(i / w)) * d) - box.y0;
      if (px < 0 || py < 0 || px >= box.w || py >= box.h) continue;
      const o = (py * box.w + px) * 4;
      out[i] = img[o] | (img[o + 1] << 8) | (img[o + 2] << 16);
    }
    return out;
  }

  // a colour back to the MOO, as a TColor number
  static tcolor(c) {
    const n = parseInt(c.slice(1), 16);
    return ((n & 255) << 16) | (n & 0xff00) | (n >> 16);
  }

  // --- components --------------------------------------------------------

  component(name, type, x, y, w, h) {
    this.comps.get(name)?.el.remove();
    type = String(type).toLowerCase();
    const tag = { button: 'button', editbox: 'input', memo: 'textarea', selectlist: 'select', droplist: 'select' }[type] ?? 'div';
    const el = document.createElement(tag);
    el.className = 'comp ' + type;
    if (tag === 'button') el.type = 'button';
    if (type === 'selectlist') el.size = 2;
    if (tag === 'input' || tag === 'textarea') el.spellcheck = false;
    const comp = { type, el, clickops: null, dblclickops: null };
    this.comps.set(name, comp);
    this.place(name, x, y, w, h);
    el.addEventListener('click', () => {
      if (comp.clickops) this.run(comp.clickops);
      if (type === 'button' || type === 'label') this.send([['image', this.id], ['compclick', name]]);
    });
    el.addEventListener('dblclick', () => {
      if (comp.dblclickops) this.run(comp.dblclickops);
      this.send([['image', this.id], ['compdoubleclick', name]]);
    });
    this.layer.append(el);
  }

  place(name, x, y, w, h) {
    const el = this.comps.get(name)?.el;
    if (!el) return;
    if (x != null) { el.style.left = num(x) + 'px'; el.style.top = num(y) + 'px'; }
    if (w != null) { el.style.width = num(w) + 'px'; el.style.height = num(h) + 'px'; }
  }

  setText(name, lines) {
    const c = this.comps.get(name);
    if (!c) return;
    const el = c.el;
    if (el.tagName === 'SELECT') {
      el.replaceChildren(...lines.map((l) => new Option(l, l)));
      if (el.size > 1) el.size = Math.max(2, lines.length);
    } else if (el.tagName === 'INPUT') {
      el.value = lines.join(' ');
    } else if (el.tagName === 'TEXTAREA') {
      el.value = lines.join('\n');
    } else {
      el.textContent = lines.join('\n');
    }
  }

  text(name) {
    const el = this.comps.get(name)?.el;
    if (!el) return [];
    if (el.tagName === 'SELECT') return [...el.options].map((o) => o.text);
    // a <button>'s .value is its value attribute (""), not its caption
    return String(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.value : el.textContent).split('\n');
  }

  setProp(name, prop, value) {
    const c = this.comps.get(name);
    if (!c) return;
    const on = num(value) !== 0;
    switch (String(prop).toLowerCase()) {
      case 'visible': c.el.hidden = !on; break;
      case 'enabled': c.el.disabled = !on; break;
      case 'readonly': c.el.readOnly = on; break;
      case 'tag': c.tag = num(value); break;
    }
  }

  // --- the MOO's lines ---------------------------------------------------

  run(ops) {
    for (const [op, ...a] of ops) {
      const n = a.map(num);
      switch (op) {
        case 'pc': this.setPen('color', a[0]); break;
        case 'pw': this.setPen('width', a[0]); break;
        case 'pm': this.setPen('mode', a[0]); break;
        case 'ps': this.setPen('style', a[0]); break;
        case 'bc': this.setBrush('color', a[0]); break;
        case 'bs': this.setBrush('style', a[0]); break;
        case 'fn': this.setFont('name', a.join(',')); break;
        case 'fs': this.setFont('size', a[0]); break;
        case 'fh': this.setFont('height', a[0]); break;
        case 'fc': this.setFont('color', a[0]); break;
        case 'ft': this.setFont('style', a.join(',')); break;
        case 'rn': this.rename(a.join(',')); break;
        case 'rs': this.resize(Math.max(1, n[0]), Math.max(1, n[1])); this.onresize(this.width, this.height); break;
        case 'mv': this.moveTo(n[0], n[1]); break;
        case 'to': this.textOut(n[0], n[1], a[2] ?? ''); break;
        case 'ln': this.lineTo(n[0], n[1]); break;
        case 'ar': this.arc('arc', ...n); break;
        case 'ch': this.arc('chord', ...n); break;
        case 'pi': this.arc('pie', ...n); break;
        case 're': this.rectangle(...n); break;
        case 'rr': this.roundRect(...n); break;
        case 'el': this.ellipse(...n); break;
        case 'fr': this.fillRect(...n); break;
        case 'ff': this.floodFill(n[0], n[1], a[2], a[3]); break;
        case 'cc': this.component(a[0], a[1], a[2], a[3], a[4], a[5]); break;
        case 'cp': this.place(a[0], a[1], a[2]); break;
        case 'cs': case 'CS': this.place(a[0], null, null, a[1], a[2]); break;
        case 'ts': this.setText(a[0], a[1] ?? []); break;
        case 'tc': this.setText(a[1], this.text(a[0])); break;
        case 'ms': {
          const c = this.comps.get(a[0]);
          if (c) c[a[1] === 'doubleclick' ? 'dblclickops' : 'clickops'] = a[2];
          break;
        }
      }
    }
  }

  rename(name) {
    this.name = name;
    this.onrename(name);
  }

  // answer one of the MOO's queries (it waits for it)
  reply(pairs) { this.send(pairs); }

  handle(m) {
    const n = (k) => num(m[k]);
    switch (m.cmd) {
      case 'macro': this.run(m.ops); break;
      case 'canvasclickmacro': this.clickops = m.ops; break;
      case 'canvasdoubleclickmacro': this.dblclickops = m.ops; break;
      case 'pen': for (const k of ['color', 'width', 'style', 'mode']) if (m[k] != null) this.setPen(k, m[k]); break;
      case 'brush': for (const k of ['color', 'style']) if (m[k] != null) this.setBrush(k, m[k]); break;
      case 'font': for (const k of ['name', 'size', 'height', 'color', 'style']) if (m[k] != null) this.setFont(k, m[k]); break;
      case 'rename': this.rename(m.name ?? m.value ?? ''); break;
      case 'resize': this.resize(Math.max(1, n('xsize')), Math.max(1, n('ysize'))); this.onresize(this.width, this.height); break;
      case 'move': case 'moveto': this.moveTo(n('xpos'), n('ypos')); break;
      case 'lineto': this.lineTo(n('xpos'), n('ypos')); break;
      case 'textout': this.textOut(n('xpos'), n('ypos'), m.text ?? ''); break;
      case 'rectangle': this.rectangle(n('upperx'), n('uppery'), n('lowerx'), n('lowery')); break;
      case 'ellipse': this.ellipse(n('upperx'), n('uppery'), n('lowerx'), n('lowery')); break;
      case 'fillrect': this.fillRect(n('upperx'), n('uppery'), n('lowerx'), n('lowery')); break;
      case 'arc': case 'chord': case 'pie':
        this.arc(m.cmd, n('upperx'), n('uppery'), n('lowerx'), n('lowery'), n('startx'), n('starty'), n('endx'), n('endy'));
        break;
      case 'floodfill': this.floodFill(n('xpos'), n('ypos'), m.color, m.style); break;
      case 'roundrect': this.roundRect(n('upperx'), n('uppery'), n('lowerx'), n('lowery'), n('xdiam'), n('ydiam')); break;
      case 'copytext': this.setText(m.classB, this.text(m.classA)); break;
      case 'setcolors': this.setColors(n('xpos'), n('ypos'), n('width'), String(m.colors ?? '').split(',').filter(Boolean)); break;
      case 'getcolors':
        this.reply([['returncolors', this.id], ['id', m.task],
                    ['colors', this.getColors(n('xpos'), n('ypos'), n('width'), Math.min(n('count'), 100000)).join(',')]]);
        break;
      case 'getpen': {
        const p = this.pen;
        this.reply([['peninfo', this.id], ['id', m.task], ['color', SmudCanvas.tcolor(p.color)], ['width', p.width],
                    ['style', p.style], ['mode', p.mode]]);
        break;
      }
      case 'getbrush':
        this.reply([['brushinfo', this.id], ['id', m.task], ['color', SmudCanvas.tcolor(this.brush.color)], ['style', this.brush.style]]);
        break;
      case 'getfont': {
        const f = this.font;
        this.reply([['fontinfo', this.id], ['id', m.task], ['name', f.name], ['size', f.size], ['height', f.height],
                    ['color', SmudCanvas.tcolor(f.color)], ['style', [...f.style].join(',')]]);
        break;
      }
      case 'valid': this.reply([['id', m.task], ['valid', 1]]); break;
      case 'textdim': {
        const [w, h] = this.textSize(m.text ?? '');
        this.reply([['textdim', this.id], ['id', m.task], ['xdim', w], ['ydim', h]]);
        break;
      }
      case 'penpos': this.reply([['penpos', this.id], ['id', m.task], ['xpos', this.pos[0]], ['ypos', this.pos[1]]]); break;
      case 'canvasdim': this.reply([['canvasdim', this.id], ['id', m.task], ['xdim', this.width], ['ydim', this.height]]); break;
      case 'class': this.handleComp(m); break;
    }
  }

  handleComp(m) {
    const name = m.name, c = this.comps.get(name), el = c?.el;
    if (m.gettype != null) {
      this.reply([['comptype', name], ['id', m.task], ['type', c?.type ?? 'none']]);
    } else if (m.getdim != null) {
      this.reply([['compdim', name], ['id', m.task], ['width', el ? parseInt(el.style.width) || 0 : 0],
                  ['height', el ? parseInt(el.style.height) || 0 : 0]]);
    } else if (m.getpos != null) {
      this.reply([['comppos', name], ['id', m.task], ['xpos', el ? parseInt(el.style.left) || 0 : 0],
                  ['ypos', el ? parseInt(el.style.top) || 0 : 0]]);
    } else if (m.gettext != null) {
      this.reply([['comptext', name], ['id', m.task], ['text', literal(this.text(name))]]);
    } else if (m.getselection != null) {
      const sel = el?.tagName === 'SELECT' ? [...el.selectedOptions].map((o) => o.text)
        : el && 'selectionStart' in el ? [el.value.slice(el.selectionStart, el.selectionEnd)] : [];
      this.reply([['compselect', name], ['id', m.task], ['selection', literal(sel)]]);
    } else if (m.property != null && m.task != null) {
      const p = String(m.property).toLowerCase();
      const v = !el ? 0 : p === 'visible' ? !el.hidden : p === 'enabled' ? !el.disabled : p === 'readonly' ? !!el.readOnly
        : p === 'tag' ? c.tag ?? 0 : 0;
      this.reply([['compprop', m.property], ['id', m.task], ['value', Number(v)]]);
    } else if (m.type != null) {
      this.component(name, m.type, m.xpos, m.ypos, m.width, m.height);
    } else if (m.setpos != null) {
      this.place(name, m.xpos, m.ypos);
    } else if (m.setdim != null) {
      this.place(name, null, null, m.width, m.height);
    } else if (m.lines) {
      this.setText(name, m.lines);
    } else if (m.property != null) {
      this.setProp(name, m.property, m.value);
    } else if (m.clickops || m.dblclickops) {
      const c = this.comps.get(name);
      if (c && m.clickops) c.clickops = m.clickops;
      if (c && m.dblclickops) c.dblclickops = m.dblclickops;
    }
  }
}
