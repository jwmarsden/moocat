// tjs run test/pixels.test.js  — setcolors/getcolors against the old pixel-at-a-time
// versions (kept here as the reference), at device pixel ratios 1, 1.25, 2 and 3
import { SmudCanvas } from '../src/frontend/canvas.js';
let failed = 0;
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) { failed++; console.log('FAIL', what, JSON.stringify(a).slice(0, 200), JSON.stringify(b).slice(0, 200)); } };
// a mock 2D context over a device-pixel buffer, with the dpr transform for fillRect
function make(w, h, d) {
  const W = Math.round(w * d), H = Math.round(h * d), buf = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 7919) % 251;
  let reads = 0, readPx = 0;
  const ctx = {
    fillStyle: '#000000',
    fillRect(x, y, fw, fh) {   // canvas coords, scaled by d, as setTransform(d,..) does
      const n = parseInt(this.fillStyle.slice(1), 16);
      for (let py = Math.round(y * d); py < Math.round((y + fh) * d); py++) for (let px = Math.round(x * d); px < Math.round((x + fw) * d); px++) {
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 4; buf[o] = n >> 16; buf[o + 1] = (n >> 8) & 255; buf[o + 2] = n & 255; buf[o + 3] = 255;
      }
    },
    getImageData(x, y, gw, gh) {
      reads++; readPx += gw * gh;
      const data = new Uint8ClampedArray(gw * gh * 4);
      for (let r = 0; r < gh; r++) data.set(buf.subarray(((y + r) * W + x) * 4, ((y + r) * W + x + gw) * 4), r * gw * 4);
      return { data, width: gw, height: gh };
    },
    putImageData(img, x, y) {
      for (let r = 0; r < img.height; r++) buf.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * W + x) * 4);
    },
  };
  const c = Object.create(SmudCanvas.prototype);
  Object.assign(c, { width: w, height: h, dpr: d, cv: { width: W, height: H }, ctx });
  return { c, buf, stats: () => ({ reads, readPx }) };
}
// the old versions, for comparison
function oldSet(c, x, y, width, colors) {
  const w = width > 0 ? width : c.width - x;
  const color = (s) => { const n = parseInt(s, 16); return '#' + [n & 255, (n >> 8) & 255, (n >> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join(''); };
  colors.forEach((col, i) => { c.ctx.fillStyle = color(col); c.ctx.fillRect(x + (i % w), y + Math.floor(i / w), 1, 1); });
}
function oldGet(c, x, y, width, count) {
  const w = width > 0 ? width : c.width - x, d = c.dpr;
  const img = c.ctx.getImageData(0, 0, c.cv.width, c.cv.height).data, out = [];
  for (let i = 0; i < count; i++) {
    const px = Math.round((x + (i % w)) * d), py = Math.round((y + Math.floor(i / w)) * d);
    if (px < 0 || py < 0 || px >= c.cv.width || py >= c.cv.height) { out.push(0); continue; }
    const o = (py * c.cv.width + px) * 4; out.push(img[o] | (img[o + 1] << 8) | (img[o + 2] << 16));
  }
  return out;
}
const hex = (n) => n.toString(16).toUpperCase();
for (const d of [1, 1.25, 2, 3]) {
  for (const [x, y, width, n] of [[10, 20, 7, 50], [0, 0, 0, 1000], [95, 70, 10, 40], [-3, -2, 5, 25], [30, 5, 1, 1]]) {
    const colors = Array.from({ length: n }, (_, i) => hex((i * 2654435761) % 16777216));
    const a = make(100, 80, d), b = make(100, 80, d);
    a.c.setColors(x, y, width, colors);
    oldSet(b.c, x, y, width, colors);
    eq([...a.buf], [...b.buf], `setColors same pixels as before d=${d} at ${x},${y} w${width} n${n}`);
    eq(a.c.getColors(x, y, width, n + 3), oldGet(b.c, x, y, width, n + 3), `getColors same as before d=${d} at ${x},${y}`);
  }
}
const big = make(800, 560, 2);
big.c.getColors(180, 140, 120, 120);
console.log('one 120-pixel row read', big.stats().readPx, 'device pixels; the old code read', 1600 * 1120);
console.log(failed ? `${failed} failed` : 'all passed');
