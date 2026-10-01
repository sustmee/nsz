/* Plot Digitizer & Compare — page controller */

import { Digitizer } from "./digitizer-ui.js";
import { parseTable, compareCurves, fmt } from "./compare.js";
import { renderChart, svgString, svgToPng } from "./chart.js";

const { toast, downloadBlob, ready } = window.NSZ;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MAX_SERIES = 8;

const pub = new Digitizer($("#dig-pub"), { role: "published", slotBase: 1, onChange: () => scheduleUpdate(), toast });
const mineDig = new Digitizer($("#dig-mine"), { role: "yours", slotBase: 2, onChange: () => scheduleUpdate(), toast });

let mineSource = "file";
let table = null; // { name, columns, rows }
let charts = {};

/* ---------------------------------------------------------------------- */
/* Step 2: your results                                                    */
/* ---------------------------------------------------------------------- */

$$("[data-mine]").forEach((tab) =>
  tab.addEventListener("click", () => {
    mineSource = tab.dataset.mine;
    $$("[data-mine]").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    });
    $$("[data-mine-panel]").forEach((p) => (p.hidden = p.dataset.minePanel !== mineSource));
    $("#table-setup").hidden = mineSource === "image" || !table;
    scheduleUpdate();
  })
);

function loadTable(text, name) {
  const t = parseTable(text);
  if (!t.rows.length || t.columns.length < 2) {
    toast("No columns of numbers were found. The file needs at least two columns (x and y).", "error");
    return;
  }
  table = { ...t, name };
  $("#table-name").textContent = name;
  $("#table-info").textContent = `${t.rows.length.toLocaleString()} rows · ${t.columns.length} columns`;
  const xs = $("#col-x");
  xs.textContent = "";
  t.columns.forEach((c, i) => xs.append(new Option(c, i)));
  const ys = $("#col-y");
  ys.textContent = "";
  t.columns.forEach((c, i) => {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = i;
    cb.checked = i === 1;
    cb.addEventListener("change", scheduleUpdate);
    const lab = document.createElement("label");
    lab.append(cb, " " + c);
    ys.append(lab);
  });
  $("#table-setup").hidden = false;
  scheduleUpdate();
}

$("#data-input").addEventListener("change", async () => {
  const f = $("#data-input").files[0];
  if (f) loadTable(await f.text(), f.name);
});
const dataDrop = $("#data-drop");
["dragenter", "dragover"].forEach((ev) => dataDrop.addEventListener(ev, (e) => {
  e.preventDefault();
  dataDrop.classList.add("dragging");
}));
["dragleave", "drop"].forEach((ev) => dataDrop.addEventListener(ev, (e) => {
  e.preventDefault();
  dataDrop.classList.remove("dragging");
}));
dataDrop.addEventListener("drop", async (e) => {
  const f = e.dataTransfer.files[0];
  if (f) loadTable(await f.text(), f.name);
});
$("#btn-paste").addEventListener("click", () => loadTable($("#paste-data").value, "Pasted numbers"));
["#col-x", "#scale-x", "#scale-y", "#mine-name"].forEach((s) => $(s).addEventListener("input", scheduleUpdate));

function factor(sel) {
  const v = Number(String($(sel).value).replace(",", ".").replace(/[×x]\s*10\^?/i, "e"));
  return isFinite(v) && v !== 0 ? v : 1;
}

function mineData() {
  if (mineSource === "image") {
    const d = mineDig.getData();
    return { ok: d.ok && d.series.length > 0, error: d.error, series: d.series.map((s) => ({ ...s, marks: s.marks === "points" ? "points" : "line" })), xLabel: d.xLabel, yLabel: d.yLabel };
  }
  if (!table) return { ok: false, series: [] };
  const xi = Number($("#col-x").value);
  const yis = $$("#col-y input:checked").map((c) => Number(c.value)).filter((i) => i !== xi);
  const fx = factor("#scale-x");
  const fy = factor("#scale-y");
  const base = $("#mine-name").value.trim() || "My results";
  const series = yis.map((yi) => ({
    name: yis.length > 1 ? `${base} – ${table.columns[yi]}` : base,
    marks: "line",
    points: table.rows.map((r) => [r[xi] * fx, r[yi] * fy]).filter((p) => isFinite(p[0]) && isFinite(p[1])),
  }));
  return { ok: series.length > 0, series, xLabel: table.columns[xi], yLabel: yis.length === 1 ? table.columns[yis[0]] : "" };
}

/* ---------------------------------------------------------------------- */
/* Step 3: comparison                                                      */
/* ---------------------------------------------------------------------- */

let timer = null;
function scheduleUpdate() {
  clearTimeout(timer);
  timer = setTimeout(update, 120);
}

function update() {
  const P = pub.getData();
  const M = mineData();
  const pubSeries = P.ok ? P.series : [];
  const mineSeries = M.ok ? M.series : [];
  const body = $("#compare-body");
  const help = $("#compare-help");

  if (!pubSeries.length && !mineSeries.length) {
    body.hidden = true;
    help.textContent = !pub.img
      ? "Add the published curve (step 1) and your results (step 2) to see them together."
      : P.error || "Extract a curve from the published figure (step 1 → Curves).";
    return;
  }
  body.hidden = false;
  const missing = !pubSeries.length ? (pub.img ? P.error || "Extract a curve in step 1." : "Add the published figure in step 1.") : !mineSeries.length ? "Add your results in step 2." : "";
  help.textContent = missing ? `Showing what's ready — ${missing}` : "Both curves on the same axes. Hover or tap the chart to read values.";

  // fixed colour order: published curves first, then yours
  const all = [
    ...pubSeries.map((s) => ({ ...s, role: "published", marks: s.marks || "both" })),
    ...mineSeries.map((s) => ({ ...s, role: "yours" })),
  ].slice(0, MAX_SERIES).map((s, i) => ({ ...s, slot: i + 1 }));
  if (pubSeries.length + mineSeries.length > MAX_SERIES) toast(`Only the first ${MAX_SERIES} curves are shown.`);

  const xLabel = P.xLabel || M.xLabel || "x";
  const yLabel = P.yLabel || M.yLabel || "y";
  const state = { all, pubSeries: all.filter((s) => s.role === "published"), mineSeries: all.filter((s) => s.role === "yours"), xLabel, yLabel, P };
  charts.state = state;

  renderLegend(all);
  charts.main = renderChart($("#chart"), { series: all, xLabel, yLabel, ariaLabel: `${yLabel} versus ${xLabel}: published and your results` });
  renderPairPicker(state);
  const cmp = renderMetrics(state);
  renderDiff(state, cmp);
  renderOverlay(state);
  renderTable(state, cmp);
  unitHint(state);
}

function renderLegend(all) {
  const lg = $("#legend");
  lg.textContent = "";
  for (const s of all) {
    const item = document.createElement("span");
    item.className = "viz-legend-item";
    const key = document.createElement("span");
    key.className = "viz-legend-key" + (s.marks === "both" || s.marks === "points" ? " dot" : "");
    key.style.setProperty("--key", `var(--series-${s.slot})`);
    const name = document.createElement("span");
    name.textContent = s.name;
    const role = document.createElement("small");
    role.textContent = s.role === "published" ? "digitized" : "yours";
    item.append(key, name, role);
    lg.append(item);
  }
}

function renderPairPicker(state) {
  const box = $("#pair-pick");
  const show = state.pubSeries.length > 1 || state.mineSeries.length > 1;
  box.hidden = !show || !state.pubSeries.length || !state.mineSeries.length;
  const fill = (sel, list) => {
    const prev = sel.value;
    sel.textContent = "";
    list.forEach((s, i) => sel.append(new Option(s.name, i)));
    if (prev && Number(prev) < list.length) sel.value = prev;
  };
  fill($("#pair-ref"), state.pubSeries);
  fill($("#pair-mine"), state.mineSeries);
}
$("#pair-ref").addEventListener("change", scheduleUpdate);
$("#pair-mine").addEventListener("change", scheduleUpdate);

function pctDiff(mine, ref) {
  if (!isFinite(mine) || !isFinite(ref) || ref === 0) return "";
  const d = ((mine - ref) / Math.abs(ref)) * 100;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}%`;
}

function renderMetrics(state) {
  const verdict = $("#verdict");
  const metrics = $("#metrics");
  verdict.textContent = "";
  metrics.textContent = "";
  const ref = state.pubSeries[Number($("#pair-ref").value) || 0];
  const mine = state.mineSeries[Number($("#pair-mine").value) || 0];
  if (!ref || !mine) return null;
  const c = compareCurves(ref.points, mine.points);
  if (!c) return null;

  if (!c.overlap) {
    verdict.append(banner("warn", "The curves don't overlap in x", "Check the units of your x column (e.g. strain vs % strain) and the axis values typed in step 1."));
  } else {
    const label = { excellent: "Excellent agreement", good: "Good agreement", fair: "Fair agreement", poor: "Poor agreement" }[c.verdict];
    const kind = c.verdict === "excellent" || c.verdict === "good" ? "good" : c.verdict === "fair" ? "warn" : "bad";
    verdict.append(banner(kind, label, `Typical difference ${fmt(c.nrmse, 3)}% of the published range (RMSE), compared over ${fmt(c.coverage, 3)}% of the published x-range.`));
  }

  const card = (title, main, sub, note) => {
    const d = document.createElement("div");
    d.className = "pd-metric";
    const t = document.createElement("small");
    t.textContent = title;
    const v = document.createElement("strong");
    v.textContent = main;
    d.append(t, v);
    if (sub) {
      const s = document.createElement("span");
      s.textContent = sub;
      d.append(s);
    }
    if (note) {
      const n = document.createElement("em");
      n.textContent = note;
      d.append(n);
    }
    return d;
  };
  const yl = state.yLabel;
  const xl = state.xLabel;
  if (c.overlap) {
    metrics.append(
      card("RMSE", fmt(c.rmse, 3), `${fmt(c.nrmse, 3)}% of range`, yl),
      card("R² (vs. published)", fmt(c.r2, 3), c.r2 >= 0.9 ? "shapes match well" : c.r2 >= 0.6 ? "shapes partly match" : "shapes differ"),
      card("Mean relative error", isFinite(c.meanRel) ? `${fmt(c.meanRel, 3)}%` : "—", `max |difference| ${fmt(c.maxAbs, 3)}`),
    );
  }
  metrics.append(
    card(`Peak ${yl}`, `${fmt(c.minePeak[1])} vs ${fmt(c.refPeak[1])}`, pctDiff(c.minePeak[1], c.refPeak[1]), "yours vs published"),
    card(`${xl} at peak`, `${fmt(c.minePeak[0])} vs ${fmt(c.refPeak[0])}`, pctDiff(c.minePeak[0], c.refPeak[0]), "yours vs published"),
    card(`Last ${xl}`, `${fmt(c.mineEnd[0])} vs ${fmt(c.refEnd[0])}`, pctDiff(c.mineEnd[0], c.refEnd[0]), "e.g. fracture strain"),
  );
  return c;
}

function banner(kind, title, text) {
  const d = document.createElement("div");
  d.className = `pd-verdict ${kind}`;
  const ic = document.createElement("span");
  ic.className = "pd-verdict-ic";
  ic.textContent = kind === "good" ? "✓" : kind === "warn" ? "!" : "✕";
  const body = document.createElement("div");
  const t = document.createElement("strong");
  t.textContent = title;
  const p = document.createElement("span");
  p.textContent = text;
  body.append(t, p);
  d.append(ic, body);
  return d;
}

function renderDiff(state, cmp) {
  const box = $("#diff-chart");
  if (!cmp || !cmp.grid) {
    box.textContent = "Needs a published curve and your curve that overlap in x.";
    charts.diff = null;
    return;
  }
  const mine = state.mineSeries[Number($("#pair-mine").value) || 0];
  charts.diff = renderChart(box, {
    series: [{ name: "Yours − published", slot: mine.slot, marks: "line", points: cmp.grid.map(([x, r, m]) => [x, m - r]) }],
    xLabel: state.xLabel,
    yLabel: `Difference in ${state.yLabel}`,
    zeroLine: true,
    height: 300,
    ariaLabel: "Difference between your curve and the published curve",
  });
}

function renderOverlay(state) {
  const box = $("#overlay");
  box.textContent = "";
  if (!state.mineSeries.length || !pub.img) {
    box.textContent = "Needs the published figure (calibrated) and your results.";
    return;
  }
  const colors = getComputedStyle($("#chart"));
  const c = pub.overlayImage(state.mineSeries.map((s) => ({ points: s.points, color: colors.getPropertyValue(`--series-${s.slot}`).trim() || "#eb6834" })));
  if (!c) {
    box.textContent = "Type the four axis values in step 1 first.";
    return;
  }
  c.className = "pd-overlay-canvas";
  box.append(c);
}

function renderTable(state, cmp) {
  const wrap = $("#data-table");
  wrap.textContent = "";
  const tableEl = document.createElement("table");
  const head = tableEl.createTHead().insertRow();
  let rows = [];
  if (cmp && cmp.grid) {
    [state.xLabel, "Published", "Yours", "Difference"].forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      head.append(th);
    });
    rows = cmp.grid.filter((_, i) => i % 2 === 0).map(([x, r, m]) => [x, r, m, m - r]);
  } else {
    const s = state.all[0];
    [state.xLabel, s.name].forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      head.append(th);
    });
    rows = s.points;
  }
  const tb = tableEl.createTBody();
  for (const r of rows) {
    const tr = tb.insertRow();
    r.forEach((v) => (tr.insertCell().textContent = fmt(v, 5)));
  }
  wrap.append(tableEl);
}

function unitHint(state) {
  const box = $("#unit-hint");
  box.textContent = "";
  if (mineSource === "image" || !state.pubSeries.length || !state.mineSeries.length) return;
  const range = (pts, k) => {
    const v = pts.map((p) => Math.abs(p[k])).filter(isFinite);
    return Math.max(...v) || 0;
  };
  const ref = state.pubSeries[0].points;
  const mine = state.mineSeries[0].points;
  for (const [k, sel, axis] of [[0, "#scale-x", "X"], [1, "#scale-y", "Y"]]) {
    const a = range(ref, k);
    const b = range(mine, k);
    if (!a || !b) continue;
    const ratio = a / b;
    if (ratio > 20 || ratio < 0.05) {
      const f = Math.pow(10, Math.round(Math.log10(ratio)));
      const current = factor(sel);
      const p = document.createElement("div");
      p.className = "notice";
      const msg = document.createElement("span");
      msg.textContent = `Your ${axis} values are about ${fmt(1 / ratio)}× the paper's. Different units? `;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm";
      btn.textContent = `Multiply ${axis} by ${fmt(f * current)}`;
      btn.addEventListener("click", () => {
        $(sel).value = fmt(f * current);
        scheduleUpdate();
      });
      msg.append(btn);
      p.append(msg);
      box.append(p);
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Tabs, downloads, theme                                                  */
/* ---------------------------------------------------------------------- */

$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => {
      x.classList.toggle("active", x === t);
      x.setAttribute("aria-selected", String(x === t));
    });
    $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === t.dataset.tab));
    if (t.dataset.tab === "diff" || t.dataset.tab === "chart") update(); // size charts to the now-visible panel
  })
);

$("#dl-png").addEventListener("click", async () => {
  if (!charts.main) return;
  try {
    downloadBlob(await svgToPng(charts.main.svg, 2), "comparison.png");
  } catch (e) {
    toast("Could not create the PNG — try the SVG download.", "error");
  }
});
$("#dl-svg").addEventListener("click", () => charts.main && downloadBlob(new Blob([svgString(charts.main.svg)], { type: "image/svg+xml" }), "comparison.svg"));

function csvCell(v) {
  const s = typeof v === "number" ? String(v) : String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function seriesCsv(list, xLabel) {
  const header = list.flatMap((s) => [`${s.name} – ${xLabel}`, `${s.name} – y`]);
  const n = Math.max(...list.map((s) => s.points.length));
  const lines = [header.map(csvCell).join(",")];
  for (let i = 0; i < n; i++) lines.push(list.flatMap((s) => (s.points[i] ? s.points[i] : ["", ""])).map(csvCell).join(","));
  return lines.join("\r\n");
}

$("#dl-csv").addEventListener("click", () => {
  const st = charts.state;
  if (!st) return;
  let csv = seriesCsv(st.all, st.xLabel);
  const ref = st.pubSeries[Number($("#pair-ref").value) || 0];
  const mine = st.mineSeries[Number($("#pair-mine").value) || 0];
  const cmp = ref && mine ? compareCurves(ref.points, mine.points) : null;
  if (cmp && cmp.grid) {
    csv += `\r\n\r\nComparison on a common grid\r\n${[st.xLabel, ref.name, mine.name, "difference"].map(csvCell).join(",")}\r\n`;
    csv += cmp.grid.map(([x, r, m]) => [x, r, m, m - r].join(",")).join("\r\n");
  }
  downloadBlob(new Blob([csv], { type: "text/csv" }), "comparison_data.csv");
});
$("#dl-pub").addEventListener("click", () => {
  const st = charts.state;
  if (!st || !st.pubSeries.length) return toast("Extract a published curve first.", "error");
  downloadBlob(new Blob([seriesCsv(st.pubSeries, st.xLabel)], { type: "text/csv" }), "digitized_published.csv");
});

new MutationObserver(() => charts.state && update()).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
let resizeT = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => charts.state && update(), 200);
});

/* ---------------------------------------------------------------------- */
/* Sample                                                                  */
/* ---------------------------------------------------------------------- */

function sampleFigure() {
  const W = 900;
  const H = 640;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, W, H);
  const L = 110, R = 860, T = 40, B = 550;
  const X = (x) => L + (x / 0.25) * (R - L);
  const Y = (y) => B - (y / 140) * (B - T);
  g.strokeStyle = "#000";
  g.lineWidth = 2;
  g.strokeRect(L, T, R - L, B - T);
  g.font = "22px Arial, sans-serif";
  g.fillStyle = "#000";
  g.textAlign = "center";
  for (let i = 0; i <= 5; i++) {
    const x = X(i * 0.05);
    g.beginPath();
    g.moveTo(x, B);
    g.lineTo(x, B + 10);
    g.stroke();
    g.fillText(String(+(i * 0.05).toFixed(2)), x, B + 36);
  }
  g.textAlign = "right";
  for (let v = 0; v <= 140; v += 20) {
    const y = Y(v);
    g.beginPath();
    g.moveTo(L - 10, y);
    g.lineTo(L, y);
    g.stroke();
    g.fillText(String(v), L - 16, y + 8);
  }
  g.textAlign = "center";
  g.font = "24px Arial, sans-serif";
  g.fillText("Strain", (L + R) / 2, H - 20);
  g.save();
  g.translate(30, (T + B) / 2);
  g.rotate(-Math.PI / 2);
  g.fillText("Stress (GPa)", 0, 0);
  g.restore();
  const curve = (peak, smax, color) => {
    g.strokeStyle = color;
    g.lineWidth = 3.5;
    g.beginPath();
    for (let i = 0; i <= 300; i++) {
      const e = (i / 300) * 0.25;
      let s = e <= peak ? smax * (1 - Math.pow(1 - e / peak, 2.2)) : Math.max(0, smax - (e - peak) * 6000);
      if (e > peak && s === 0 && i % 2) continue;
      i ? g.lineTo(X(e), Y(s)) : g.moveTo(X(e), Y(s));
    }
    g.stroke();
  };
  curve(0.18, 120, "#1f77b4");
  curve(0.15, 95, "#d62728");
  // legend
  g.fillStyle = "#fff";
  g.strokeStyle = "#ccc";
  g.lineWidth = 1;
  g.fillRect(650, 60, 180, 84);
  g.strokeRect(650, 60, 180, 84);
  g.font = "20px Arial, sans-serif";
  g.textAlign = "left";
  [["#1f77b4", "MD, 300 K"], ["#d62728", "MD, 600 K"]].forEach(([col, lab], i) => {
    g.strokeStyle = col;
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(665, 88 + i * 34);
    g.lineTo(705, 88 + i * 34);
    g.stroke();
    g.fillStyle = "#000";
    g.fillText(lab, 715, 95 + i * 34);
  });
  return c;
}

function sampleData() {
  const lines = ["# strain stress(GPa)   — sample: your own simulation at 300 K"];
  for (let i = 0; i <= 120; i++) {
    const e = (i / 120) * 0.21;
    const peak = 0.177;
    const s = e <= peak ? 116 * (1 - Math.pow(1 - e / peak, 2.15)) + Math.sin(i) * 0.8 : Math.max(0, 116 - (e - peak) * 6500);
    lines.push(`${e.toFixed(5)} ${s.toFixed(3)}`);
  }
  return lines.join("\n");
}

$("#btn-sample").addEventListener("click", () => {
  pub.setImage(sampleFigure());
  pub.fileName = "sample_figure.png";
  const vals = { x1: "0", x2: "0.25", y1: "0", y2: "140" };
  for (const [k, v] of Object.entries(vals)) pub.calInputs[k].value = v;
  pub.xTitle.value = "Strain";
  pub.yTitle.value = "Stress (GPa)";
  const blue = pub.colors.find((c) => c.name.startsWith("Blue"));
  if (blue) pub.addSeries(blue);
  if (pub.series[0]) pub.series[0].name = "Published, 300 K";
  pub.renderSeriesList();
  pub.changed();
  $$("[data-mine]")[0].click();
  loadTable(sampleData(), "sample_my_results.txt");
  $("#mine-name").value = "My MD, 300 K";
  scheduleUpdate();
  toast("Sample loaded — scroll down to the comparison.");
});

ready();
