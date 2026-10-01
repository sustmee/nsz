/* ==========================================================================
   Plot digitizer — reading data files and comparing curves (no DOM)
   ========================================================================== */

/**
 * Parses a text data file (txt, dat, csv, tsv, LAMMPS output …).
 * Comment lines (#, %, //, ;, !) are skipped; the first non-numeric line
 * becomes the column names. Returns { columns: [names], rows: [[numbers]] }.
 */
export function parseTable(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  let header = null;
  let lastComment = null;
  const rows = [];
  const sample = lines.find((l) => l.trim() && !/^\s*(#|%|\/\/|;|!)/.test(l)) || "";
  const delim = sample.includes("\t") ? /\t/ : sample.includes(";") ? /;/ : /,/.test(sample) && !/\d,\d+\s*$/.test(sample.trim().split(/\s+/)[0]) ? /\s*,\s*/ : /\s+/;
  const dataLines = lines.filter((l) => /\d/.test(l) && !/^\s*(#|%|\/\/|!)/.test(l));
  const decimalComma = delim.source === ";" && dataLines.some((l) => /\d,\d/.test(l)) && !dataLines.some((l) => /\d\.\d/.test(l));
  const num = (s) => {
    const t = (decimalComma ? s.replace(",", ".") : s).trim();
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$/.test(t)) return NaN;
    return parseFloat(t.replace(/[dD]/, "e"));
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(#|%|\/\/|;|!)/.test(line)) {
      lastComment = line.replace(/^(#|%|\/\/|;|!)+\s*/, "");
      continue;
    }
    const parts = line.split(delim).map((p) => p.trim()).filter((p) => p !== "");
    const nums = parts.map(num);
    if (nums.length && nums.every((n) => isFinite(n))) rows.push(nums);
    else if (!rows.length && !header) header = parts;
  }
  const width = rows.length ? Math.max(...rows.map((r) => r.length)) : 0;
  let columns = header && header.length === width ? header : null;
  // LAMMPS-style "# strain stress(GPa)" comment just above the data
  if (!columns && lastComment) {
    const c = lastComment.split(/\s+|,\s*/).filter(Boolean);
    if (c.length === width) columns = c;
  }
  if (!columns) columns = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  return { columns, rows: rows.filter((r) => r.length === width) };
}

/** Linear interpolation on a polyline sorted by x (NaN outside its range). */
export function interpolate(points, x) {
  if (!points.length || x < points[0][0] || x > points[points.length - 1][0]) return NaN;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = points[lo];
  const [x1, y1] = points[hi];
  if (x1 === x0) return (y0 + y1) / 2;
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/** Sorts by x and averages duplicate x values (needed for interpolation). */
export function asFunction(points) {
  const sorted = points.filter((p) => isFinite(p[0]) && isFinite(p[1])).slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(p[0] - last[0]) <= 1e-12 * Math.max(1, Math.abs(p[0]))) {
      last[1] = (last[1] * last.n + p[1]) / (last.n + 1);
      last.n++;
    } else {
      const q = [p[0], p[1]];
      q.n = 1;
      out.push(q);
    }
  }
  return out;
}

function peak(points) {
  let best = null;
  for (const p of points) if (!best || p[1] > best[1]) best = p;
  return best;
}

/**
 * Compares "yours" against a reference (published) curve over their common x range.
 * Returns errors, R², peak values and a verdict.
 */
export function compareCurves(reference, yours, samples = 200) {
  const ref = asFunction(reference);
  const mine = asFunction(yours);
  if (ref.length < 2 || mine.length < 2) return null;
  const lo = Math.max(ref[0][0], mine[0][0]);
  const hi = Math.min(ref[ref.length - 1][0], mine[mine.length - 1][0]);
  const result = {
    overlap: hi > lo ? [lo, hi] : null,
    refPeak: peak(reference),
    minePeak: peak(yours),
    refEnd: ref[ref.length - 1],
    mineEnd: mine[mine.length - 1],
  };
  if (!(hi > lo)) return result;

  const grid = [];
  for (let i = 0; i < samples; i++) {
    const x = lo + ((hi - lo) * i) / (samples - 1);
    const r = interpolate(ref, x);
    const m = interpolate(mine, x);
    if (isFinite(r) && isFinite(m)) grid.push([x, r, m]);
  }
  const n = grid.length;
  if (!n) return result;
  const refVals = grid.map((g) => g[1]);
  const range = Math.max(...refVals) - Math.min(...refVals) || Math.max(...refVals.map(Math.abs)) || 1;
  const mean = refVals.reduce((s, v) => s + v, 0) / n;
  let se = 0;
  let ae = 0;
  let maxAbs = 0;
  let ssTot = 0;
  let rel = 0;
  let relN = 0;
  for (const [, r, m] of grid) {
    const d = m - r;
    se += d * d;
    ae += Math.abs(d);
    maxAbs = Math.max(maxAbs, Math.abs(d));
    ssTot += (r - mean) ** 2;
    if (Math.abs(r) > range * 0.05) {
      rel += Math.abs(d / r);
      relN++;
    }
  }
  result.grid = grid;
  result.rmse = Math.sqrt(se / n);
  result.mae = ae / n;
  result.maxAbs = maxAbs;
  result.nrmse = (result.rmse / range) * 100; // % of the published range
  result.meanRel = relN ? (rel / relN) * 100 : NaN;
  result.r2 = ssTot > 0 ? 1 - se / ssTot : NaN;
  result.coverage = ((hi - lo) / (ref[ref.length - 1][0] - ref[0][0])) * 100;
  const e = result.nrmse;
  result.verdict = e <= 3 ? "excellent" : e <= 7 ? "good" : e <= 15 ? "fair" : "poor";
  return result;
}

/** "Nice" axis ticks covering [min, max]. */
export function niceTicks(min, max, count = 6) {
  if (!isFinite(min) || !isFinite(max)) return { ticks: [0, 1], min: 0, max: 1, step: 1 };
  if (min === max) {
    const d = Math.abs(min) || 1;
    min -= d * 0.5;
    max += d * 0.5;
  }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toPrecision(12));
  return { ticks, min: lo, max: hi, step };
}

/** Compact number formatting for labels and tables. */
export function fmt(v, digits = 4) {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2).replace("e+", "e");
  return String(+v.toPrecision(digits));
}
