/* ==========================================================================
   Plot digitizer — comparison chart (plain SVG, no library)

   renderChart(container, { series, xLabel, yLabel, height, zeroLine, tooltip })
     series: [{ name, points: [[x, y]], slot: 1-8, marks: "line" | "points" | "both" }]
   Colours come from CSS custom properties (--series-1 … --series-8, --viz-*),
   resolved at render time so downloads look exactly like the screen.
   ========================================================================== */

import { niceTicks, fmt, interpolate, asFunction } from "./compare.js";

const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function tokens(container) {
  const cs = getComputedStyle(container);
  const get = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
  return {
    surface: get("--viz-surface", "#fcfcfb"),
    text: get("--viz-text", "#0b0b0b"),
    text2: get("--viz-text-2", "#52514e"),
    grid: get("--viz-grid", "#e4e3df"),
    axis: get("--viz-axis", "#a3a29d"),
    series: (slot) => get(`--series-${slot}`, "#2a78d6"),
    font: cs.fontFamily || "system-ui, sans-serif",
  };
}

/**
 * Draws the chart into `container` (replacing its content).
 * Returns { svg } for export.
 */
export function renderChart(container, opts) {
  const series = (opts.series || []).filter((s) => s.points && s.points.length);
  container.innerHTML = "";
  const t = tokens(container);
  const W = Math.max(300, Math.round(container.clientWidth || 700));
  const H = opts.height || (W < 520 ? 300 : 420);
  const narrow = W < 520;
  const m = { top: 16, right: narrow ? 16 : 150, bottom: 50, left: narrow ? 52 : 66 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  const allX = series.flatMap((s) => s.points.map((p) => p[0])).filter(isFinite);
  const allY = series.flatMap((s) => s.points.map((p) => p[1])).filter(isFinite);
  if (opts.zeroLine) allY.push(0);
  const xt = niceTicks(Math.min(...allX), Math.max(...allX), narrow ? 5 : 7);
  const yt = niceTicks(Math.min(...allY), Math.max(...allY), narrow ? 5 : 6);
  const sx = (x) => m.left + ((x - xt.min) / (xt.max - xt.min || 1)) * pw;
  const sy = (y) => m.top + ph - ((y - yt.min) / (yt.max - yt.min || 1)) * ph;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "font-family": t.font, "font-size": 12 });
  svg.style.display = "block";
  svg.style.overflow = "visible";
  const title = el("title", {}, svg);
  title.textContent = opts.ariaLabel || "Comparison chart";
  el("rect", { x: 0, y: 0, width: W, height: H, fill: t.surface }, svg);

  // Grid + ticks (hairline, solid, recessive)
  const grid = el("g", {}, svg);
  for (const v of yt.ticks) {
    el("line", { x1: m.left, x2: m.left + pw, y1: sy(v), y2: sy(v), stroke: t.grid, "stroke-width": 1, "shape-rendering": "crispEdges" }, grid);
    const lab = el("text", { x: m.left - 8, y: sy(v) + 4, "text-anchor": "end", fill: t.text2 }, grid);
    lab.textContent = fmt(v);
  }
  for (const v of xt.ticks) {
    el("line", { x1: sx(v), x2: sx(v), y1: m.top, y2: m.top + ph, stroke: t.grid, "stroke-width": 1, "shape-rendering": "crispEdges" }, grid);
    const lab = el("text", { x: sx(v), y: m.top + ph + 18, "text-anchor": "middle", fill: t.text2 }, grid);
    lab.textContent = fmt(v);
  }
  el("line", { x1: m.left, x2: m.left + pw, y1: m.top + ph, y2: m.top + ph, stroke: t.axis, "stroke-width": 1, "shape-rendering": "crispEdges" }, grid);
  el("line", { x1: m.left, x2: m.left, y1: m.top, y2: m.top + ph, stroke: t.axis, "stroke-width": 1, "shape-rendering": "crispEdges" }, grid);
  if (opts.zeroLine && yt.min < 0 && yt.max > 0) {
    el("line", { x1: m.left, x2: m.left + pw, y1: sy(0), y2: sy(0), stroke: t.axis, "stroke-width": 1.5 }, grid);
  }

  // Axis titles
  if (opts.xLabel) {
    const xl = el("text", { x: m.left + pw / 2, y: H - 8, "text-anchor": "middle", fill: t.text, "font-weight": 600 }, svg);
    xl.textContent = opts.xLabel;
  }
  if (opts.yLabel) {
    const yl = el("text", { x: 0, y: 0, transform: `translate(14 ${m.top + ph / 2}) rotate(-90)`, "text-anchor": "middle", fill: t.text, "font-weight": 600 }, svg);
    yl.textContent = opts.yLabel;
  }

  // Series
  const clipId = "clip" + Math.random().toString(36).slice(2, 8);
  const defs = el("defs", {}, svg);
  const cp = el("clipPath", { id: clipId }, defs);
  el("rect", { x: m.left - 6, y: m.top - 6, width: pw + 12, height: ph + 12 }, cp);
  const plot = el("g", { "clip-path": `url(#${clipId})` }, svg);
  const ends = [];
  for (const s of series) {
    const color = t.series(s.slot || 1);
    const pts = s.points.filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (s.marks !== "points") {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(2)},${sy(p[1]).toFixed(2)}`).join("");
      el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, plot);
    }
    if (s.marks === "points" || s.marks === "both") {
      for (const p of pts) el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 4, fill: color, stroke: t.surface, "stroke-width": 2 }, plot);
    }
    const last = pts[pts.length - 1];
    if (last) ends.push({ name: s.name, color, x: sx(last[0]), y: sy(last[1]) });
  }

  // Direct labels at the line ends (wide charts, up to 4 series), nudged apart
  if (!narrow && ends.length <= 4) {
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    // keep labels above the x-axis numbers
    const over = ends.length ? ends[ends.length - 1].y - (m.top + ph - 8) : 0;
    if (over > 0) ends.forEach((e) => (e.y -= over));
    for (const e of ends) {
      const lx = Math.min(e.x + 8, m.left + pw + 8);
      el("line", { x1: lx, x2: lx + 10, y1: e.y, y2: e.y, stroke: e.color, "stroke-width": 2, "stroke-linecap": "round" }, svg);
      const tx = el("text", { x: lx + 14, y: e.y + 4, fill: t.text }, svg);
      tx.textContent = e.name.length > 19 ? e.name.slice(0, 18) + "…" : e.name;
    }
  }

  container.appendChild(svg);
  if (opts.tooltip !== false) addCrosshair(container, svg, series, { sx, sy, m, pw, ph, xt, t, xLabel: opts.xLabel });
  return { svg, width: W, height: H };
}

/* ---------------------------------------------------------------------- */
/* Crosshair + tooltip: one readout listing every series at the hovered x   */
/* ---------------------------------------------------------------------- */

function addCrosshair(container, svg, series, g) {
  const { sx, m, pw, ph, xt, t } = g;
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p[0])))].filter(isFinite).sort((a, b) => a - b);
  if (!xs.length) return;
  const funcs = series.map((s) => asFunction(s.points));
  const hair = el("line", { y1: m.top, y2: m.top + ph, stroke: t.text2, "stroke-width": 1, visibility: "hidden" }, svg);
  const dots = series.map((s) => el("circle", { r: 5, fill: t.series(s.slot || 1), stroke: t.surface, "stroke-width": 2, visibility: "hidden" }, svg));
  const hit = el("rect", { x: m.left, y: m.top, width: pw, height: ph, fill: "transparent", tabindex: 0, "aria-label": "Chart: use arrow keys to read values" }, svg);
  hit.style.cursor = "crosshair";
  hit.style.outline = "none";

  const tip = document.createElement("div");
  tip.className = "viz-tip";
  tip.hidden = true;
  container.style.position = "relative";
  container.appendChild(tip);

  let idx = 0;
  const show = (i) => {
    idx = Math.max(0, Math.min(xs.length - 1, i));
    const x = xs[idx];
    const X = sx(x);
    hair.setAttribute("x1", X);
    hair.setAttribute("x2", X);
    hair.setAttribute("visibility", "visible");
    tip.textContent = "";
    const head = document.createElement("div");
    head.className = "viz-tip-x";
    head.textContent = `${g.xLabel ? g.xLabel + " = " : "x = "}${fmt(x)}`;
    tip.appendChild(head);
    series.forEach((s, k) => {
      const y = interpolate(funcs[k], x);
      const dot = dots[k];
      if (!isFinite(y)) {
        dot.setAttribute("visibility", "hidden");
        return;
      }
      dot.setAttribute("cx", X);
      dot.setAttribute("cy", g.sy(y));
      dot.setAttribute("visibility", "visible");
      const row = document.createElement("div");
      row.className = "viz-tip-row";
      const key = document.createElement("span");
      key.className = "viz-tip-key";
      key.style.background = t.series(s.slot || 1);
      const val = document.createElement("strong");
      const exact = s.points.some((p) => p[0] === x);
      val.textContent = (exact ? "" : "≈ ") + fmt(y);
      const name = document.createElement("span");
      name.className = "viz-tip-name";
      name.textContent = s.name;
      row.append(key, val, name);
      tip.appendChild(row);
    });
    tip.hidden = false;
    const scale = container.clientWidth / svg.viewBox.baseVal.width;
    const left = X * scale;
    const tw = tip.offsetWidth;
    tip.style.left = `${left + 14 + tw > container.clientWidth ? left - tw - 14 : left + 14}px`;
    tip.style.top = `${(m.top + 8) * scale}px`;
  };
  const hide = () => {
    tip.hidden = true;
    hair.setAttribute("visibility", "hidden");
    dots.forEach((d) => d.setAttribute("visibility", "hidden"));
  };
  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const X = ((evt.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
    const x = xt.min + ((X - m.left) / pw) * (xt.max - xt.min);
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    return best;
  };
  hit.addEventListener("pointermove", (e) => show(nearest(e)));
  hit.addEventListener("pointerdown", (e) => show(nearest(e)));
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", () => show(idx));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(idx + 1);
    else if (e.key === "ArrowLeft") show(idx - 1);
    else return;
    e.preventDefault();
  });
}

/* ---------------------------------------------------------------------- */
/* Export                                                                  */
/* ---------------------------------------------------------------------- */

export function svgString(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", NS);
  clone.setAttribute("width", svg.viewBox.baseVal.width);
  clone.setAttribute("height", svg.viewBox.baseVal.height);
  clone.querySelectorAll('[visibility="hidden"], rect[fill="transparent"]').forEach((n) => n.remove());
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export function svgToPng(svg, scale = 2) {
  return new Promise((resolve, reject) => {
    const str = svgString(svg);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = svg.viewBox.baseVal.width * scale;
      c.height = svg.viewBox.baseVal.height * scale;
      const ctx = c.getContext("2d");
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("PNG export failed"));
    img.src = url;
  });
}
