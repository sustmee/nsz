/* ==========================================================================
   Plot digitizer — image analysis (no DOM; runs in the browser and in Node)

   img = { width, height, data }   (RGBA bytes, like ImageData)

   detectAxes(img)                   → axes lines, plot box, tick marks
   findSeriesColors(img, box)        → the colours of the data series in the plot
   extractSeries(img, box, color, …) → pixel points of one series
   makeCalibration(cal)              → pixel ⇄ data conversion
   ========================================================================== */

/* ---------------------------------------------------------------------- */
/* Pixel helpers                                                            */
/* ---------------------------------------------------------------------- */

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** 1 where the pixel is dark and grey-ish (axis lines, ticks, black curves, text). */
function darkMask(img) {
  const { width: W, height: H, data } = img;
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2], a = data[p + 3];
    if (a < 128) continue;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum(r, g, b) < 140 && chroma < 70) m[i] = 1;
  }
  return m;
}

/** 1 for any non-background pixel (dark or coloured). */
function inkMask(img) {
  const { width: W, height: H, data } = img;
  const m = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (data[p + 3] >= 128 && (lum(r, g, b) < 170 || Math.max(r, g, b) - Math.min(r, g, b) > 80)) m[i] = 1;
  }
  return m;
}

function darkShare(get, run) {
  let n = 0;
  for (let i = run.start; i <= run.end; i++) n += get(i);
  return n / Math.max(1, run.len);
}

/* ---------------------------------------------------------------------- */
/* Axes and ticks                                                           */
/* ---------------------------------------------------------------------- */

/** Longest run of 1s in a line of the mask, allowing tiny gaps. */
function longestRun(get, n, maxGap = 2) {
  let best = { start: 0, end: -1, len: 0 };
  let start = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (get(i)) {
      if (start < 0 || i - last > maxGap + 1) start = i;
      last = i;
      const len = last - start + 1;
      if (len > best.len) best = { start, end: last, len };
    }
  }
  return best;
}

function groupLines(cands, key) {
  // Merge neighbouring rows/columns that belong to one thick line.
  cands.sort((a, b) => a[key] - b[key]);
  const out = [];
  for (const c of cands) {
    const g = out[out.length - 1];
    if (g && c[key] - g.last <= 1 && Math.min(g.end, c.end) - Math.max(g.start, c.start) > 0.5 * Math.min(g.len, c.len)) {
      g.last = c[key];
      g.start = Math.min(g.start, c.start);
      g.end = Math.max(g.end, c.end);
      g.len = g.end - g.start + 1;
      g.members++;
    } else {
      out.push({ first: c[key], last: c[key], start: c.start, end: c.end, len: c.len, members: 1 });
    }
  }
  return out.map((g) => ({ pos: (g.first + g.last) / 2, thickness: g.last - g.first + 1, start: g.start, end: g.end, len: g.len }));
}

/**
 * Finds the x and y axes as the longest dark horizontal / vertical lines that
 * meet near a corner (bottom-left preferred).
 */
export function detectAxes(img) {
  const { width: W, height: H } = img;
  const dark = darkMask(img);
  // Curves often run along an axis (e.g. zero stress after fracture) and paint over
  // it in colour, so follow any ink along the line but require it to be mostly dark.
  const ink = inkMask(img);
  const hc = [];
  for (let y = 0; y < H; y++) {
    const r = longestRun((x) => ink[y * W + x], W);
    if (r.len >= W * 0.3 && darkShare((x) => dark[y * W + x], r) >= 0.55) hc.push({ y, ...r });
  }
  const vc = [];
  for (let x = 0; x < W; x++) {
    const r = longestRun((y) => ink[y * W + x], H);
    if (r.len >= H * 0.3 && darkShare((y) => dark[y * W + x], r) >= 0.55) vc.push({ x, ...r });
  }
  const hLines = groupLines(hc, "y").filter((l) => l.thickness <= 8);
  const vLines = groupLines(vc, "x").filter((l) => l.thickness <= 8);

  // Best (vertical, horizontal) pair meeting at a corner — the axes.
  const tolX = Math.max(6, W * 0.025);
  const tolY = Math.max(6, H * 0.025);
  let best = null;
  for (const v of vLines) {
    for (const h of hLines) {
      const nearCornerX = Math.abs(h.start - v.pos) <= tolX || (h.start <= v.pos + tolX && h.end > v.pos);
      const nearCornerY = Math.abs(v.end - h.pos) <= tolY || (v.start < h.pos && v.end >= h.pos - tolY);
      if (!nearCornerX || !nearCornerY) continue;
      // Prefer long axes; prefer the lowest horizontal and leftmost vertical line.
      const score = (h.end - v.pos) + (h.pos - v.start) + h.pos * 0.05 - v.pos * 0.05;
      if (!best || score > best.score) best = { v, h, score };
    }
  }

  let xAxis;
  let yAxis;
  if (best) {
    xAxis = best.h;
    yAxis = best.v;
  } else {
    xAxis = hLines.sort((a, b) => b.len - a.len)[0] || null;
    yAxis = vLines.sort((a, b) => b.len - a.len)[0] || null;
  }

  const origin = {
    x: yAxis ? yAxis.pos : Math.round(W * 0.12),
    y: xAxis ? xAxis.pos : Math.round(H * 0.88),
  };
  const box = {
    x0: origin.x,
    y1: origin.y,
    x1: xAxis ? xAxis.end : Math.round(W * 0.95),
    y0: yAxis ? yAxis.start : Math.round(H * 0.05),
  };
  // A framed plot has a top and right border too; use them for the box if present.
  const top = hLines.find((l) => l !== xAxis && l.pos < origin.y - H * 0.2 && Math.abs(l.start - box.x0) <= tolX && Math.abs(l.end - box.x1) <= tolX);
  const right = vLines.find((l) => l !== yAxis && l.pos > origin.x + W * 0.2 && Math.abs(l.end - box.y1) <= tolY);
  if (top) box.y0 = Math.min(box.y0, top.pos);
  if (right) box.x1 = Math.max(box.x1, right.pos);

  const xTicks = xAxis ? findTicks(dark, W, H, xAxis, "x", box) : [];
  const yTicks = yAxis ? findTicks(dark, W, H, yAxis, "y", box) : [];
  // The tick at the origin hides inside the other axis line; add it back when
  // the spacing says there should be one there.
  const addEnd = (ticks, at, before) => {
    if (ticks.length < 2) return;
    const d = (ticks[ticks.length - 1] - ticks[0]) / (ticks.length - 1);
    const next = before ? ticks[0] - d : ticks[ticks.length - 1] + d;
    if (Math.abs(next - at) <= Math.max(2.5, d * 0.06)) before ? ticks.unshift(at) : ticks.push(at);
  };
  addEnd(xTicks, origin.x, true);
  addEnd(yTicks, origin.y, false);
  addEnd(xTicks, box.x1, false); // last tick hidden in a right frame line
  addEnd(yTicks, box.y0, true); // …or in a top frame line

  return {
    found: !!(xAxis && yAxis),
    origin,
    box,
    xAxis,
    yAxis,
    xTicks,
    yTicks,
    frame: { top: !!top, right: !!right },
  };
}

/** Tick marks along an axis: short dark strokes perpendicular to it, evenly spaced. */
function findTicks(dark, W, H, axis, which, box) {
  const t = Math.ceil(axis.thickness / 2);
  const cands = [];
  const maxLen = 14;
  const along = which === "x" ? [Math.ceil(box.x0) + t + 2, Math.floor(axis.end)] : [Math.ceil(axis.start), Math.floor(box.y1) - t - 2];
  const at = (a, b) => (which === "x" ? (b >= 0 && b < H ? dark[b * W + a] : 0) : b >= 0 && b < W ? dark[a * W + b] : 0);
  const base = Math.round(axis.pos);
  for (let a = along[0]; a <= along[1]; a++) {
    let out = 0;
    while (out < maxLen && at(a, which === "x" ? base + t + 1 + out : base - t - 1 - out)) out++;
    let inn = 0;
    while (inn < maxLen && at(a, which === "x" ? base - t - 1 - inn : base + t + 1 + inn)) inn++;
    const len = Math.max(out, inn);
    if (len >= 3) cands.push({ a, len, capped: len >= maxLen });
  }
  // merge neighbouring columns (a tick can be 1–3 px wide)
  const ticks = [];
  for (const c of cands) {
    const g = ticks[ticks.length - 1];
    if (g && c.a - g.last <= 1) {
      g.last = c.a;
      g.len = Math.max(g.len, c.len);
      g.capped = g.capped || c.capped;
    } else ticks.push({ first: c.a, last: c.a, len: c.len, capped: c.capped });
  }
  let list = ticks.filter((g) => g.last - g.first <= 4).map((g) => ({ pos: (g.first + g.last) / 2, len: g.len, capped: g.capped }));
  if (list.length < 3) return [];
  // Major ticks are the longest ones; keep the longest evenly spaced chain.
  const lens = list.filter((x) => !x.capped).map((x) => x.len);
  const major = lens.length ? Math.max(...lens) : maxLen;
  const majors = list.filter((x) => x.capped || x.len >= major * 0.75);
  const chain = evenChain(majors.map((x) => x.pos));
  return chain.length >= 3 ? chain : evenChain(list.map((x) => x.pos)).length >= 3 ? evenChain(list.map((x) => x.pos)) : [];
}

/** Longest subsequence with (nearly) constant spacing. */
function evenChain(pos) {
  if (pos.length < 3) return [];
  let best = [];
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const d = pos[j] - pos[i];
      if (d < 6) continue;
      const chain = [pos[i], pos[j]];
      let last = pos[j];
      for (let k = j + 1; k < pos.length; k++) {
        const gap = pos[k] - last;
        if (Math.abs(gap - d) <= Math.max(2, d * 0.06)) {
          chain.push(pos[k]);
          last = pos[k];
        } else if (gap > d * 1.1) break;
      }
      // extend backwards
      let first = pos[i];
      for (let k = i - 1; k >= 0; k--) {
        const gap = first - pos[k];
        if (Math.abs(gap - d) <= Math.max(2, d * 0.06)) {
          chain.unshift(pos[k]);
          first = pos[k];
        } else if (gap > d * 1.1) break;
      }
      if (chain.length > best.length || (chain.length === best.length && d > best.d)) {
        best = chain;
        best.d = d;
      }
    }
  }
  return best.length >= 3 ? [...best] : [];
}

/* ---------------------------------------------------------------------- */
/* Series colours                                                           */
/* ---------------------------------------------------------------------- */

const HUE_NAMES = [
  [15, "Red"], [40, "Orange"], [68, "Yellow"], [155, "Green"], [195, "Teal"], [255, "Blue"], [290, "Purple"], [340, "Pink"], [361, "Red"],
];

function hueName(h) {
  return HUE_NAMES.find(([lim]) => h < lim)[1];
}

/** Inner plot area, kept clear of the axis lines and ticks. */
export function innerBox(box, axes, img) {
  const tx = axes && axes.xAxis ? axes.xAxis.thickness : 1;
  const ty = axes && axes.yAxis ? axes.yAxis.thickness : 1;
  const m = 3;
  return {
    x0: Math.max(0, Math.round(Math.min(box.x0, box.x1) + ty / 2 + m)),
    x1: Math.min(img.width - 1, Math.round(Math.max(box.x0, box.x1) - m)),
    y0: Math.max(0, Math.round(Math.min(box.y0, box.y1) + m)),
    y1: Math.min(img.height - 1, Math.round(Math.max(box.y0, box.y1) - tx / 2 - m)),
  };
}

/**
 * Groups the coloured pixels inside the plot by hue. Returns candidate series
 * colours, most common first. Dark/black pixels form their own group.
 */
export function findSeriesColors(img, ib) {
  const { width: W, data } = img;
  const bins = new Float64Array(72); // 5° hue bins
  const binRgb = Array.from({ length: 72 }, () => [0, 0, 0, 0]);
  const colsWith = Array.from({ length: 72 }, () => new Set());
  let darkCount = 0;
  const darkCols = new Set();
  let area = 0;
  for (let y = ib.y0; y <= ib.y1; y++) {
    for (let x = ib.x0; x <= ib.x1; x++) {
      area++;
      const p = (y * W + x) * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      const [h, s, v] = rgbToHsv(r, g, b);
      if (s < 0.22) {
        if (lum(r, g, b) < 110) {
          darkCount++;
          darkCols.add(x);
        }
        continue;
      }
      if (v < 0.15) continue;
      const k = Math.floor(h / 5) % 72;
      bins[k]++;
      colsWith[k].add(x);
      if (s >= 0.45) {
        const w = s; // weight saturated pixels so anti-aliased edges don't wash out the swatch
        binRgb[k][0] += r * w;
        binRgb[k][1] += g * w;
        binRgb[k][2] += b * w;
        binRgb[k][3] += w;
      }
    }
  }
  const width = ib.x1 - ib.x0 + 1;
  const minCount = Math.max(25, area * 0.0004);

  // Split the circular histogram into hue clusters separated by quiet bins.
  const max = Math.max(...bins);
  const quiet = (k) => bins[(k + 72) % 72] <= Math.max(1, max * 0.004);
  let startK = 0;
  while (startK < 72 && !quiet(startK)) startK++;
  const clusters = [];
  let cur = null;
  for (let i = 0; i < 72; i++) {
    const k = (startK + i) % 72;
    if (quiet(k)) {
      if (cur) clusters.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { bins: [] };
    cur.bins.push(k);
  }
  if (cur) clusters.push(cur);

  const out = [];
  for (const c of clusters) {
    const count = c.bins.reduce((s, k) => s + bins[k], 0);
    if (count < minCount) continue;
    const cols = new Set();
    c.bins.forEach((k) => colsWith[k].forEach((x) => cols.add(x)));
    const coverage = cols.size / width;
    if (coverage < 0.04) continue;
    let rgb = [0, 0, 0, 0];
    c.bins.forEach((k) => {
      for (let j = 0; j < 4; j++) rgb[j] += binRgb[k][j];
    });
    const peak = c.bins.reduce((a, k) => (bins[k] > bins[a] ? k : a), c.bins[0]);
    const color = rgb[3] ? rgb.slice(0, 3).map((v) => Math.round(v / rgb[3])) : [128, 128, 128];
    out.push({
      id: "h" + c.bins[0],
      kind: "hue",
      hueFrom: c.bins[0] * 5,
      hueTo: c.bins[c.bins.length - 1] * 5 + 5,
      hue: peak * 5 + 2.5,
      name: hueName(peak * 5 + 2.5),
      color,
      count,
      coverage,
    });
  }
  if (darkCount >= minCount && darkCols.size / width >= 0.04) {
    out.push({ id: "dark", kind: "dark", name: "Black / grey", color: [40, 40, 40], count: darkCount, coverage: darkCols.size / width });
  }
  out.sort((a, b) => b.count - a.count);
  // Make names unique ("Blue", "Blue 2")
  const seen = {};
  for (const c of out) {
    seen[c.name] = (seen[c.name] || 0) + 1;
    if (seen[c.name] > 1) c.name += " " + seen[c.name];
  }
  return out;
}

/** Returns a function telling whether pixel (x, y) belongs to the colour group. */
export function colorMatcher(img, group, tolerance = 1) {
  const { width: W, data } = img;
  if (group.kind === "dark") {
    const limit = 110 + 40 * (tolerance - 1);
    return (x, y) => {
      const p = (y * W + x) * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      return Math.max(r, g, b) - Math.min(r, g, b) < 60 && lum(r, g, b) < limit;
    };
  }
  if (group.kind === "rgb") {
    const [tr, tg, tb] = group.color;
    const lim = 60 * tolerance;
    return (x, y) => {
      const p = (y * W + x) * 4;
      const dr = data[p] - tr, dg = data[p + 1] - tg, db = data[p + 2] - tb;
      return dr * dr + dg * dg + db * db <= lim * lim;
    };
  }
  const pad = 6 * tolerance;
  const from = group.hueFrom - pad;
  const to = (group.hueTo < group.hueFrom ? group.hueTo + 360 : group.hueTo) + pad; // red wraps past 360°
  const inHue = (h) => {
    for (const hh of [h, h + 360, h - 360]) if (hh >= from && hh <= to) return true;
    return false;
  };
  const minS = Math.max(0.12, 0.22 / tolerance);
  return (x, y) => {
    const p = (y * W + x) * 4;
    const [h, s, v] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
    return s >= minS && v >= 0.15 && inHue(h);
  };
}

/* ---------------------------------------------------------------------- */
/* Series extraction                                                        */
/* ---------------------------------------------------------------------- */

function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = comps.length;
    const c = { id, area: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, sx: 0, sy: 0 };
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const x = j % w;
      const y = (j - x) / w;
      c.area++;
      c.sx += x;
      c.sy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = yy * w + xx;
          if (mask[k] && label[k] < 0) {
            label[k] = id;
            stack.push(k);
          }
        }
      }
    }
    comps.push(c);
  }
  return { label, comps };
}

function chainComponents(label, comps, w, h, seed) {
  const pixels = new Map(comps.map((c) => [c.id, []]));
  for (let i = 0; i < label.length; i++) if (label[i] >= 0 && pixels.has(label[i])) pixels.get(label[i]).push(i);
  let start;
  if (seed) {
    // the component closest to where the user clicked
    let best = Infinity;
    for (const c of comps) {
      for (const i of pixels.get(c.id)) {
        const x = i % w;
        const y = (i - x) / w;
        const d = (x - seed.x) ** 2 + (y - seed.y) ** 2;
        if (d < best) {
          best = d;
          start = c;
        }
      }
    }
  } else start = comps.reduce((a, c) => (c.area > a.area ? c : a), comps[0]);
  const chain = new Set([start.id]);
  const R = Math.max(6, Math.round(w * 0.04));
  for (let iter = 0; iter < 60; iter++) {
    // integral image of chain pixels → "is there a chain pixel within R?"
    const ii = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += chain.has(label[y * w + x]) ? 1 : 0;
        ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
      }
    }
    const near = (x, y) => {
      const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
      return ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0] > 0;
    };
    let added = false;
    for (const c of comps) {
      if (chain.has(c.id)) continue;
      if (pixels.get(c.id).some((i) => near(i % w, Math.floor(i / w)))) {
        chain.add(c.id);
        added = true;
      }
    }
    if (!added) break;
  }
  return chain;
}

/**
 * Extracts the pixel coordinates of one series.
 * opts.mode: "line" (continuous curve) or "points" (scatter markers)
 * opts.points: target number of points for a line
 * opts.exclude: [{x0,y0,x1,y1}] areas to ignore (legends, labels)
 * Returns [{x, y}] in image pixels, ordered along the curve.
 */
export function extractSeries(img, ib, group, opts = {}) {
  const mode = opts.mode || "line";
  const match = colorMatcher(img, group, opts.tolerance || 1);
  const w = ib.x1 - ib.x0 + 1;
  const h = ib.y1 - ib.y0 + 1;
  if (w < 5 || h < 5) return [];
  const mask = new Uint8Array(w * h);
  const excluded = (x, y) => (opts.exclude || []).some((r) => x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x + ib.x0;
    const Y = y + ib.y0;
    if (match(X, Y) && !excluded(X, Y)) mask[y * w + x] = 1;
  }

  // Black curves share their colour with gridlines: drop full-width rows / full-height columns.
  if (group.kind === "dark") {
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = 0; x < w; x++) n += mask[y * w + x];
      if (n > w * 0.55) for (let x = 0; x < w; x++) mask[y * w + x] = 0;
    }
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let y = 0; y < h; y++) n += mask[y * w + x];
      if (n > h * 0.55) for (let y = 0; y < h; y++) mask[y * w + x] = 0;
    }
  }

  const { label, comps } = components(mask, w, h);
  const real = comps.filter((c) => c.area >= 4);
  if (!real.length) return [];

  if (mode === "points") {
    // Scatter markers: blobs of similar size → their centres.
    const areas = real.map((c) => c.area).sort((a, b) => a - b);
    const med = areas[Math.floor(areas.length / 2)];
    return real
      .filter((c) => c.area >= med * 0.3 && c.area <= med * 4)
      .map((c) => ({ x: c.sx / c.area + ib.x0, y: c.sy / c.area + ib.y0 }))
      .sort((a, b) => a.x - b.x);
  }

  // Line: start from the main piece (or the piece the user clicked) and attach
  // only pieces close to it — dashes join, a legend sample far away does not.
  const keep = chainComponents(label, real, w, h, opts.seed ? { x: opts.seed.x - ib.x0, y: opts.seed.y - ib.y0 } : null);

  // Column runs
  const runsByCol = [];
  const runLens = [];
  for (let x = 0; x < w; x++) {
    const runs = [];
    let s = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && mask[y * w + x] && keep.has(label[y * w + x]);
      if (on && s < 0) s = y;
      if (!on && s >= 0) {
        runs.push([s, y - 1]);
        runLens.push(y - s);
        s = -1;
      }
    }
    runsByCol.push(runs);
  }
  if (!runLens.length) return [];
  runLens.sort((a, b) => a - b);
  const thick = Math.max(1, runLens[Math.floor(runLens.length / 2)]);

  // Follow the curve from left to right, choosing the run closest to the last point.
  const raw = [];
  let prev = null;
  for (let x = 0; x < w; x++) {
    const runs = runsByCol[x];
    if (!runs.length) continue;
    let run;
    if (prev == null) run = runs.reduce((a, r) => (r[1] - r[0] > a[1] - a[0] ? r : a), runs[0]);
    else run = runs.reduce((a, r) => (Math.abs((r[0] + r[1]) / 2 - prev) < Math.abs((a[0] + a[1]) / 2 - prev) ? r : a), runs[0]);
    const len = run[1] - run[0] + 1;
    if (len > Math.max(thick * 4 + 2, h * 0.06)) {
      // a steep / vertical part (e.g. a sudden drop): keep both ends, in travel order
      const top = run[0] + thick / 2;
      const bot = run[1] - thick / 2;
      const goingDown = prev == null ? false : Math.abs(prev - top) < Math.abs(prev - bot);
      const [a, b] = goingDown ? [top, bot] : [bot, top];
      raw.push({ x, y: a, keep: true }, { x, y: b, keep: true });
      prev = b;
    } else {
      const c = (run[0] + run[1]) / 2;
      raw.push({ x, y: c });
      prev = c;
    }
  }

  // Down-sample to about opts.points points (steep ends are always kept).
  const target = Math.max(5, opts.points || 100);
  const step = Math.max(1, w / target);
  const out = [];
  let bucket = [];
  let bucketStart = 0;
  const flush = () => {
    if (!bucket.length) return;
    const n = bucket.length;
    out.push({ x: bucket.reduce((s, p) => s + p.x, 0) / n, y: bucket.reduce((s, p) => s + p.y, 0) / n });
    bucket = [];
  };
  for (const p of raw) {
    if (p.keep) {
      flush();
      out.push({ x: p.x, y: p.y });
      bucketStart = p.x + 1;
      continue;
    }
    if (p.x - bucketStart >= step) {
      flush();
      bucketStart = p.x;
    }
    bucket.push(p);
  }
  flush();
  return out.map((p) => ({ x: p.x + ib.x0, y: p.y + ib.y0 }));
}

/* ---------------------------------------------------------------------- */
/* Calibration                                                              */
/* ---------------------------------------------------------------------- */

/**
 * cal = { x1:{px, value}, x2:{px, value}, y1:{py, value}, y2:{py, value}, logX, logY }
 * Returns { toData(px, py) → [x, y], toPixel(x, y) → [px, py], ok, error }
 */
export function makeCalibration(cal) {
  const fx = (v) => (cal.logX ? Math.log10(v) : v);
  const fy = (v) => (cal.logY ? Math.log10(v) : v);
  const ix = (v) => (cal.logX ? Math.pow(10, v) : v);
  const iy = (v) => (cal.logY ? Math.pow(10, v) : v);
  const vals = [cal.x1.value, cal.x2.value, cal.y1.value, cal.y2.value];
  let error = "";
  if (vals.some((v) => v === "" || v == null || !isFinite(v))) error = "Type the axis values for all four markers.";
  else if (cal.x1.value === cal.x2.value) error = "The two X values must be different.";
  else if (cal.y1.value === cal.y2.value) error = "The two Y values must be different.";
  else if (Math.abs(cal.x2.px - cal.x1.px) < 5) error = "Move the two X markers further apart.";
  else if (Math.abs(cal.y2.py - cal.y1.py) < 5) error = "Move the two Y markers further apart.";
  else if ((cal.logX && (cal.x1.value <= 0 || cal.x2.value <= 0)) || (cal.logY && (cal.y1.value <= 0 || cal.y2.value <= 0))) error = "Log axes need positive values.";
  const ax = (fx(cal.x2.value) - fx(cal.x1.value)) / (cal.x2.px - cal.x1.px);
  const ay = (fy(cal.y2.value) - fy(cal.y1.value)) / (cal.y2.py - cal.y1.py);
  return {
    ok: !error,
    error,
    toData: (px, py) => [ix(fx(cal.x1.value) + (px - cal.x1.px) * ax), iy(fy(cal.y1.value) + (py - cal.y1.py) * ay)],
    toPixel: (x, y) => [cal.x1.px + (fx(x) - fx(cal.x1.value)) / ax, cal.y1.py + (fy(y) - fy(cal.y1.value)) / ay],
  };
}

/** Default marker positions from detected axes/ticks: first & last tick, or the axis ends. */
export function defaultMarkers(axes) {
  const { origin, box, xTicks, yTicks } = axes;
  const xs = xTicks.length >= 2 ? [xTicks[0], xTicks[xTicks.length - 1]] : [origin.x, box.x1];
  const ys = yTicks.length >= 2 ? [yTicks[yTicks.length - 1], yTicks[0]] : [origin.y, box.y0];
  return {
    x1: { x: xs[0], y: origin.y },
    x2: { x: xs[1], y: origin.y },
    y1: { x: origin.x, y: ys[0] },
    y2: { x: origin.x, y: ys[1] },
    fromTicks: { x: xTicks.length >= 2, y: yTicks.length >= 2 },
  };
}
