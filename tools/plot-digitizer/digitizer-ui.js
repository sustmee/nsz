/* ==========================================================================
   Plot digitizer — interactive component (one per figure)

   const d = new Digitizer(rootElement, { role: "published" | "yours", onChange });
   d.getData() → { ok, error, series: [{ name, points: [[x, y]] }], xLabel, yLabel }
   ========================================================================== */

import { detectAxes, innerBox, findSeriesColors, extractSeries, makeCalibration, defaultMarkers } from "./digitizer-core.js";

const MAX_SIDE = 1800;
const MARKER_COLORS = { x: "#c026d3", y: "#0891b2" };
const POINT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

let uid = 0;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

const ICON = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9M8 16l4-4 4 4"/></svg>',
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>',
  pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg>',
  points: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="16" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="18" cy="13" r="2"/><path d="M18 3v6M15 6h6"/></svg>',
  erase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7M5 11l9 9"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
};

function icon(name) {
  const s = document.createElement("span");
  s.className = "ic";
  s.innerHTML = ICON[name];
  return s;
}

export class Digitizer {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.id = ++uid;
    this.role = opts.role || "published";
    this.slotBase = opts.slotBase || 1;
    this.series = [];
    this.active = -1;
    this.mode = "move";
    this.exclude = [];
    this.build();
  }

  /* -------------------------------------------------------------------- */
  /* Layout                                                                */
  /* -------------------------------------------------------------------- */

  build() {
    const r = this.root;
    r.classList.add("digitizer");
    r.innerHTML = "";

    // Upload area
    this.input = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp", class: "dz-input", "aria-label": "Choose a figure image" });
    this.drop = h("label", { class: "dropzone dz-compact" },
      this.input,
      h("div", { class: "dz-icon pd-icon" }),
      h("p", { class: "dz-title", text: "Drop a figure image here, or tap to choose" }),
      h("p", { class: "dz-sub", text: "PNG or JPG — a screenshot works. You can also paste an image (Ctrl+V)." }),
    );
    this.drop.querySelector(".dz-icon").innerHTML = ICON.upload;
    this.input.addEventListener("change", () => this.loadFile(this.input.files[0]));
    ["dragenter", "dragover"].forEach((ev) => this.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      this.drop.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach((ev) => this.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      this.drop.classList.remove("dragging");
    }));
    this.drop.addEventListener("drop", (e) => {
      e.stopPropagation();
      if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
    });
    r.addEventListener("pointerdown", () => (Digitizer.focused = this));
    if (!Digitizer.pasteBound) {
      Digitizer.pasteBound = true;
      window.addEventListener("paste", (e) => {
        const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
        const target = Digitizer.focused || Digitizer.instances?.[0];
        if (item && target) {
          e.preventDefault();
          target.loadFile(item.getAsFile());
        }
      });
    }
    (Digitizer.instances ||= []).push(this);

    // Workspace
    this.canvas = h("canvas", { class: "pd-image" });
    this.overlay = h("canvas", { class: "pd-overlay", "aria-label": "Figure with calibration markers and extracted points" });
    this.stage = h("div", { class: "pd-stage" }, this.canvas, this.overlay);
    this.modeHint = h("p", { class: "pd-hint" });
    this.toolbar = h("div", { class: "pd-toolbar", role: "toolbar", "aria-label": "Digitizer tools" });
    const tools = [
      ["move", "Move markers", "move"],
      ["pick", "Click a curve", "pick"],
      ["points", "Add / delete points", "points"],
      ["erase", "Erase area", "erase"],
      ["crop", "Crop panel", "crop"],
    ];
    for (const [mode, label, ic] of tools) {
      const b = h("button", { type: "button", class: "pd-tool", "data-mode": mode, title: label }, icon(ic), h("span", { text: label }));
      b.addEventListener("click", () => this.setMode(mode));
      this.toolbar.append(b);
    }
    const replace = h("button", { type: "button", class: "pd-tool pd-tool-end", title: "Use another image" }, icon("redo"), h("span", { text: "New image" }));
    replace.addEventListener("click", () => this.reset());
    this.toolbar.append(replace);

    // Side panel: 1) calibration 2) curves
    this.calInputs = {};
    this.crops = {};
    const calRow = (key, label, axis) => {
      const crop = h("canvas", { class: "pd-crop", width: 120, height: 48, "aria-hidden": "true" });
      const inp = h("input", { type: "text", inputmode: "decimal", class: "pd-val", placeholder: "value", "aria-label": `${label} value`, autocomplete: "off" });
      inp.addEventListener("input", () => this.changed());
      this.calInputs[key] = inp;
      this.crops[key] = crop;
      return h("div", { class: `pd-cal pd-cal-${axis}` }, h("span", { class: "pd-cal-tag", text: label }), crop, inp);
    };
    this.logX = h("input", { type: "checkbox" });
    this.logY = h("input", { type: "checkbox" });
    this.logX.addEventListener("change", () => this.changed());
    this.logY.addEventListener("change", () => this.changed());
    this.xTitle = h("input", { type: "text", class: "pd-text", placeholder: "x-axis title, e.g. Strain" });
    this.yTitle = h("input", { type: "text", class: "pd-text", placeholder: "y-axis title, e.g. Stress (GPa)" });
    this.xTitle.addEventListener("input", () => this.changed());
    this.yTitle.addEventListener("input", () => this.changed());
    this.calStatus = h("p", { class: "pd-status" });
    const calPanel = h("section", { class: "pd-panel" },
      h("h4", {}, h("span", { class: "pd-num", text: "1" }), "Axis values"),
      h("p", { class: "pd-help", text: "Markers were placed on the axes automatically. Type the number printed at each marker (shown in the small preview), or drag a marker to a labelled tick." }),
      calRow("x1", "X1", "x"), calRow("x2", "X2", "x"), calRow("y1", "Y1", "y"), calRow("y2", "Y2", "y"),
      h("div", { class: "pd-checks" }, h("label", {}, this.logX, " Log x-axis"), h("label", {}, this.logY, " Log y-axis")),
      this.xTitle, this.yTitle,
      this.calStatus,
    );

    this.swatches = h("div", { class: "pd-swatches" });
    this.modeSel = h("select", { class: "pd-select", "aria-label": "Curve type" },
      h("option", { value: "line", text: "Line / curve" }), h("option", { value: "points", text: "Scatter markers" }));
    this.density = h("input", { type: "range", min: 10, max: 400, step: 10, value: 80, "aria-label": "Number of points" });
    this.densityOut = h("output", { text: "80" });
    this.tol = h("input", { type: "range", min: 0.6, max: 2, step: 0.1, value: 1, "aria-label": "Colour tolerance" });
    this.density.addEventListener("input", () => {
      this.densityOut.textContent = this.density.value;
    });
    this.density.addEventListener("change", () => this.reextract());
    this.tol.addEventListener("change", () => this.reextract());
    this.modeSel.addEventListener("change", () => this.reextract());
    this.seriesList = h("div", { class: "pd-series" });
    const curvesPanel = h("section", { class: "pd-panel" },
      h("h4", {}, h("span", { class: "pd-num", text: "2" }), "Curves"),
      h("p", { class: "pd-help", text: "Colours found in the plot. Tap one to extract that curve — or use “Click a curve” and tap the curve itself." }),
      this.swatches,
      h("div", { class: "pd-settings" },
        h("label", {}, "Type ", this.modeSel),
        h("label", {}, "Points ", this.density, this.densityOut),
        h("label", {}, "Colour tolerance ", this.tol),
      ),
      this.seriesList,
    );

    this.side = h("div", { class: "pd-side" }, calPanel, curvesPanel);
    this.work = h("div", { class: "pd-work", hidden: true },
      h("div", { class: "pd-main" }, this.toolbar, this.modeHint, this.stage),
      this.side,
    );
    r.append(this.drop, this.work);
    this.bindPointer();
    this.setMode("move");
  }

  reset() {
    this.series = [];
    this.active = -1;
    this.exclude = [];
    this.img = null;
    this.work.hidden = true;
    this.drop.hidden = false;
    this.input.value = "";
    Object.values(this.calInputs).forEach((i) => (i.value = ""));
    this.changed();
  }

  setMode(mode) {
    this.mode = mode;
    this.toolbar.querySelectorAll(".pd-tool[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    const hints = {
      move: "Drag the X1/X2 and Y1/Y2 markers onto ticks whose numbers you can read.",
      pick: "Tap directly on the curve you want — it is extracted with the colour under your finger.",
      points: "Tap empty space to add a point to the selected curve; tap a point to delete it.",
      erase: "Drag a box over a legend or label to remove those points (and ignore that area).",
      crop: "Drag a box around one panel of the figure to crop it; axes are detected again.",
    };
    this.modeHint.textContent = hints[mode];
    this.overlay.dataset.mode = mode;
  }

  /* -------------------------------------------------------------------- */
  /* Loading & detection                                                   */
  /* -------------------------------------------------------------------- */

  async loadFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || "")) {
      this.opts.toast?.("Please choose an image (PNG or JPG). For a PDF figure, take a screenshot of it first.", "error");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error("This image could not be opened."));
        i.src = url;
      });
      this.fileName = file.name || "pasted image";
      this.setImage(img);
    } catch (e) {
      this.opts.toast?.(e.message, "error");
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /** Accepts an HTMLImageElement, canvas or ImageBitmap. */
  setImage(source, keepState = false) {
    const sw = source.naturalWidth || source.width;
    const sh = source.naturalHeight || source.height;
    // Upscale small images (better ticks/lines), downscale huge ones (speed).
    const scale = Math.min(MAX_SIDE / Math.max(sw, sh), Math.max(1, 900 / Math.max(sw, sh)));
    const W = Math.max(1, Math.round(sw * scale));
    const H = Math.max(1, Math.round(sh * scale));
    this.canvas.width = this.overlay.width = W;
    this.canvas.height = this.overlay.height = H;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(source, 0, 0, W, H);
    this.img = ctx.getImageData(0, 0, W, H);
    this.drop.hidden = true;
    this.work.hidden = false;
    if (!keepState) {
      this.series = [];
      this.active = -1;
      this.exclude = [];
    }
    this.detect();
  }

  detect() {
    const axes = detectAxes(this.img);
    this.axes = axes;
    this.markers = defaultMarkers(axes);
    this.ib = innerBox(axes.box, axes, this.img);
    this.colors = findSeriesColors(this.img, this.ib);
    Object.values(this.calInputs).forEach((i) => (i.value = ""));
    this.renderSwatches();
    this.draw();
    this.updateCrops();
    const msg = axes.found
      ? `Axes found${this.markers.fromTicks.x && this.markers.fromTicks.y ? " and markers placed on the outer ticks" : ""}. Type the four values.`
      : "Couldn't find clear axis lines — drag the four markers onto labelled ticks.";
    this.calStatus.textContent = msg;
    this.calStatus.className = "pd-status " + (axes.found ? "ok" : "warn");
    setTimeout(() => this.calInputs.x1.focus({ preventScroll: true }), 50);
    this.changed();
  }

  renderSwatches() {
    this.swatches.textContent = "";
    if (!this.colors.length) {
      this.swatches.append(h("p", { class: "pd-help", text: "No curve colours found inside the axes. Use “Click a curve”, or add points by hand." }));
      return;
    }
    for (const c of this.colors) {
      const b = h("button", { type: "button", class: "pd-swatch", title: `Extract the ${c.name.toLowerCase()} curve` },
        h("span", { class: "pd-swatch-dot", style: `background: rgb(${c.color.join(",")})` }),
        h("span", { text: c.name }),
        h("small", { text: `${Math.round(c.coverage * 100)}% wide` }));
      b.addEventListener("click", () => this.addSeries(c));
      this.swatches.append(b);
    }
    if (this.colors.length > 1) {
      const all = h("button", { type: "button", class: "pd-swatch pd-swatch-all", text: "Extract all" });
      all.addEventListener("click", () => this.colors.forEach((c) => this.addSeries(c, true)));
      this.swatches.append(all);
    }
  }

  /* -------------------------------------------------------------------- */
  /* Series                                                                */
  /* -------------------------------------------------------------------- */

  extractFor(group, seed) {
    return extractSeries(this.img, this.ib, group, {
      mode: this.modeSel.value,
      points: Number(this.density.value),
      tolerance: Number(this.tol.value),
      exclude: this.exclude,
      seed,
    });
  }

  addSeries(group, quiet, seed) {
    if (!seed && this.series.some((s) => s.group.id === group.id && !s.seed)) {
      if (!quiet) this.opts.toast?.(`The ${group.name.toLowerCase()} curve is already extracted.`);
      return;
    }
    const pts = this.extractFor(group, seed);
    if (!pts.length) {
      if (!quiet) this.opts.toast?.("No points found for that colour. Try a higher colour tolerance.", "error");
      return;
    }
    const n = this.series.length;
    const base = this.role === "published" ? "Published" : "Mine";
    this.series.push({
      id: ++uid,
      name: this.series.length ? `${base} – ${group.name}` : base,
      group,
      seed,
      mode: this.modeSel.value,
      points: pts,
      slotColor: POINT_COLORS[(this.slotBase - 1 + n) % POINT_COLORS.length],
    });
    this.active = this.series.length - 1;
    this.renderSeriesList();
    this.draw();
    this.changed();
  }

  reextract() {
    if (!this.img) return;
    for (const s of this.series) {
      if (s.manualOnly) continue;
      s.mode = this.modeSel.value;
      s.points = this.extractFor(s.group, s.seed);
    }
    this.draw();
    this.renderSeriesList();
    this.changed();
  }

  renderSeriesList() {
    this.seriesList.textContent = "";
    if (!this.series.length) return;
    this.seriesList.append(h("p", { class: "pd-help", text: "Extracted curves (tap to select, rename for the chart legend):" }));
    this.series.forEach((s, i) => {
      const name = h("input", { type: "text", class: "pd-text pd-sname", value: s.name, "aria-label": "Curve name" });
      name.addEventListener("input", () => {
        s.name = name.value;
        this.changed();
      });
      const del = h("button", { type: "button", class: "icon-btn pd-del", title: "Remove this curve", "aria-label": "Remove this curve" }, icon("trash"));
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.series.splice(i, 1);
        this.active = Math.min(this.active, this.series.length - 1);
        this.renderSeriesList();
        this.draw();
        this.changed();
      });
      const row = h("div", { class: "pd-srow" + (i === this.active ? " active" : "") },
        h("span", { class: "pd-swatch-dot", style: `background:${s.slotColor}` }),
        name,
        h("small", { text: `${s.points.length} pts` }),
        del);
      row.addEventListener("click", () => {
        this.active = i;
        this.renderSeriesList();
        this.draw();
      });
      this.seriesList.append(row);
    });
  }

  /* -------------------------------------------------------------------- */
  /* Calibration & output                                                  */
  /* -------------------------------------------------------------------- */

  calibration() {
    if (!this.markers) return { ok: false, error: "Load an image first." };
    const num = (k) => {
      const v = this.calInputs[k].value.trim().replace(",", ".").replace(/[×x]\s*10\^?/i, "e");
      return v === "" ? "" : Number(v);
    };
    return makeCalibration({
      x1: { px: this.markers.x1.x, value: num("x1") },
      x2: { px: this.markers.x2.x, value: num("x2") },
      y1: { py: this.markers.y1.y, value: num("y1") },
      y2: { py: this.markers.y2.y, value: num("y2") },
      logX: this.logX.checked,
      logY: this.logY.checked,
    });
  }

  getData() {
    const cal = this.calibration();
    const base = { xLabel: this.xTitle.value.trim(), yLabel: this.yTitle.value.trim(), fileName: this.fileName };
    if (!this.img) return { ok: false, error: "No image yet.", series: [], ...base };
    if (!cal.ok) return { ok: false, error: cal.error, series: [], ...base };
    const series = this.series.filter((s) => s.points.length).map((s) => ({
      name: s.name || "Curve",
      marks: s.mode === "points" ? "points" : "both",
      points: s.points.map((p) => cal.toData(p.x, p.y)),
    }));
    return { ok: true, series, ...base, calibration: cal };
  }

  changed() {
    const cal = this.markers ? this.calibration() : null;
    if (cal && this.img) {
      Object.entries(this.calInputs).forEach(([k, inp]) => inp.classList.toggle("need", inp.value.trim() === ""));
      if (!cal.ok) {
        this.calStatus.textContent = cal.error;
        this.calStatus.className = "pd-status warn";
      } else {
        this.calStatus.textContent = "Calibrated ✓";
        this.calStatus.className = "pd-status ok";
      }
    }
    this.opts.onChange?.(this);
  }

  /** Crops of the image around each marker, where its tick label usually is. */
  updateCrops() {
    if (!this.img) return;
    for (const [k, c] of Object.entries(this.crops)) {
      const m = this.markers[k];
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      const isX = k[0] === "x";
      const span = Math.max(30, Math.round(Math.max(this.canvas.width, this.canvas.height) * 0.09));
      // keep the preview's 5:2 shape; x labels sit below the axis, y labels to its left
      const sh = isX ? span * 0.8 : span * 0.62;
      const sw = sh * (c.width / c.height);
      const sx = isX ? m.x - sw / 2 : m.x - sw * 0.88;
      const sy = isX ? m.y - sh * 0.12 : m.y - sh / 2;
      ctx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
      ctx.strokeStyle = MARKER_COLORS[k[0]];
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (isX) {
        const px = ((m.x - sx) / sw) * c.width;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, c.height);
      } else {
        const py = ((m.y - sy) / sh) * c.height;
        ctx.moveTo(0, py);
        ctx.lineTo(c.width, py);
      }
      ctx.stroke();
    }
  }

  /* -------------------------------------------------------------------- */
  /* Drawing                                                               */
  /* -------------------------------------------------------------------- */

  draw(loupe) {
    const c = this.overlay;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (!this.markers) return;
    const u = Math.max(1, c.width / (c.getBoundingClientRect().width || c.width)); // canvas px per CSS px

    // plot box
    const b = this.axes.box;
    ctx.setLineDash([6 * u, 5 * u]);
    ctx.strokeStyle = "rgba(91,91,246,.55)";
    ctx.lineWidth = 1.2 * u;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.setLineDash([]);

    // excluded areas
    for (const r of this.exclude) {
      ctx.fillStyle = "rgba(239,68,68,.12)";
      ctx.strokeStyle = "rgba(239,68,68,.7)";
      ctx.lineWidth = 1 * u;
      ctx.fillRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
    }

    // extracted points
    this.series.forEach((s, i) => {
      const act = i === this.active;
      ctx.fillStyle = s.slotColor;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5 * u;
      const r = (act ? 4.5 : 3.2) * u;
      for (const p of s.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });

    // calibration markers
    for (const k of ["x1", "x2", "y1", "y2"]) {
      const m = this.markers[k];
      const isX = k[0] === "x";
      const col = MARKER_COLORS[k[0]];
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      if (isX) {
        ctx.moveTo(m.x, m.y - 14 * u);
        ctx.lineTo(m.x, m.y + 14 * u);
      } else {
        ctx.moveTo(m.x - 14 * u, m.y);
        ctx.lineTo(m.x + 14 * u, m.y);
      }
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.font = `700 ${12 * u}px system-ui, sans-serif`;
      const label = k.toUpperCase();
      const tx = isX ? m.x + 8 * u : m.x - 30 * u;
      const ty = isX ? m.y - 14 * u : m.y - 9 * u;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = "#fff";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = col;
      ctx.fillText(label, tx, ty);
    }

    if (this.dragRect) {
      const r = this.dragRect;
      ctx.setLineDash([5 * u, 4 * u]);
      ctx.strokeStyle = this.mode === "crop" ? "#5b5bf6" : "#ef4444";
      ctx.lineWidth = 2 * u;
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.setLineDash([]);
    }

    // magnifier while dragging a marker (helps on phones where the finger hides the spot)
    if (loupe) {
      const R = 70 * u;
      const zoom = 3;
      const cx = loupe.x < c.width / 2 ? c.width - R - 12 * u : R + 12 * u;
      const cy = R + 12 * u;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#fff";
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      const src = (2 * R) / zoom;
      ctx.drawImage(this.canvas, loupe.x - src / 2, loupe.y - src / 2, src, src, cx - R, cy - R, 2 * R, 2 * R);
      ctx.strokeStyle = "rgba(239,68,68,.9)";
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy);
      ctx.lineTo(cx + R, cy);
      ctx.moveTo(cx, cy - R);
      ctx.lineTo(cx, cy + R);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* -------------------------------------------------------------------- */
  /* Pointer interaction                                                   */
  /* -------------------------------------------------------------------- */

  bindPointer() {
    const c = this.overlay;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, u: c.width / r.width };
    };
    let drag = null;

    c.addEventListener("pointerdown", (e) => {
      if (!this.img) return;
      const p = pos(e);
      if (this.mode === "move") {
        let best = null;
        for (const k of ["x1", "x2", "y1", "y2"]) {
          const m = this.markers[k];
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d < 26 * p.u && (!best || d < best.d)) best = { k, d };
        }
        if (best) {
          drag = { type: "marker", k: best.k, dx: this.markers[best.k].x - p.x, dy: this.markers[best.k].y - p.y };
          c.setPointerCapture(e.pointerId);
          e.preventDefault();
        }
      } else if (this.mode === "erase" || this.mode === "crop") {
        this.dragRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        drag = { type: "rect" };
        c.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else if (this.mode === "points") {
        this.togglePoint(p);
      } else if (this.mode === "pick") {
        this.pickAt(p);
      }
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const p = pos(e);
      if (drag.type === "marker") {
        const m = this.markers[drag.k];
        m.x = Math.max(0, Math.min(c.width, p.x + drag.dx));
        m.y = Math.max(0, Math.min(c.height, p.y + drag.dy));
        this.draw({ x: m.x, y: m.y });
      } else {
        this.dragRect.x1 = p.x;
        this.dragRect.y1 = p.y;
        this.draw();
      }
      e.preventDefault();
    });
    const end = () => {
      if (!drag) return;
      if (drag.type === "marker") {
        this.updateCrops();
        this.changed();
      } else if (this.dragRect) {
        const r = this.dragRect;
        this.dragRect = null;
        if (Math.abs(r.x1 - r.x0) > 6 && Math.abs(r.y1 - r.y0) > 6) {
          if (this.mode === "crop") this.cropTo(r);
          else this.eraseArea(r);
        }
      }
      drag = null;
      this.draw();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    window.addEventListener("resize", () => this.img && this.draw());
  }

  togglePoint(p) {
    if (this.active < 0) {
      // no curve yet: start a hand-made one
      this.series.push({ id: ++uid, name: this.role === "published" ? "Published" : "Mine", group: { id: "manual" + uid, kind: "manual" }, manualOnly: true, mode: "points", points: [], slotColor: POINT_COLORS[(this.slotBase - 1 + this.series.length) % POINT_COLORS.length] });
      this.active = this.series.length - 1;
    }
    const s = this.series[this.active];
    const u = p.u;
    const hit = s.points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 12 * u);
    if (hit >= 0) s.points.splice(hit, 1);
    else {
      let i = s.points.findIndex((q) => q.x > p.x);
      if (i < 0) i = s.points.length;
      s.points.splice(i, 0, { x: p.x, y: p.y });
    }
    s.manualOnly = true; // keep hand edits when settings change
    this.renderSeriesList();
    this.draw();
    this.changed();
  }

  eraseArea(r) {
    const inside = (q) => q.x >= Math.min(r.x0, r.x1) && q.x <= Math.max(r.x0, r.x1) && q.y >= Math.min(r.y0, r.y1) && q.y <= Math.max(r.y0, r.y1);
    this.exclude.push({ ...r });
    for (const s of this.series) {
      if (s.manualOnly) s.points = s.points.filter((q) => !inside(q));
      else s.points = this.extractFor(s.group, s.seed);
    }
    this.renderSeriesList();
    this.draw();
    this.changed();
  }

  pickAt(p) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const W = this.img.width;
    // look for a non-background pixel near the tap
    let best = null;
    const R = Math.round(8 * p.u);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const X = x + dx;
      const Y = y + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= this.img.height) continue;
      const i = (Y * W + X) * 4;
      const d = this.img.data;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const chroma = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      const score = (255 - lum) + chroma * 2 - Math.hypot(dx, dy) * 3;
      if (lum < 225 && (!best || score > best.score)) best = { X, Y, rgb: [d[i], d[i + 1], d[i + 2]], chroma, lum, score };
    }
    if (!best) {
      this.opts.toast?.("Tap exactly on a curve line.", "error");
      return;
    }
    const known = this.colors.find((c) => {
      if (c.kind === "dark") return best.chroma < 50 && best.lum < 130;
      const [hh] = rgbToHue(best.rgb);
      const to = c.hueTo < c.hueFrom ? c.hueTo + 360 : c.hueTo;
      return best.chroma >= 50 && [hh, hh + 360].some((v) => v >= c.hueFrom - 6 && v <= to + 6);
    });
    const group = known || { id: "rgb" + best.rgb.join("-"), kind: "rgb", name: "Picked", color: best.rgb };
    this.addSeries(group, false, { x: best.X, y: best.Y });
    this.setMode("move");
  }

  cropTo(r) {
    const x0 = Math.max(0, Math.round(Math.min(r.x0, r.x1)));
    const y0 = Math.max(0, Math.round(Math.min(r.y0, r.y1)));
    const w = Math.min(this.canvas.width - x0, Math.round(Math.abs(r.x1 - r.x0)));
    const hgt = Math.min(this.canvas.height - y0, Math.round(Math.abs(r.y1 - r.y0)));
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = hgt;
    tmp.getContext("2d").drawImage(this.canvas, x0, y0, w, hgt, 0, 0, w, hgt);
    this.setImage(tmp);
    this.setMode("move");
  }

  /** Draws data-space points of other curves on top of this figure (overlay comparison). */
  overlayImage(extraSeries) {
    const cal = this.calibration();
    if (!this.img || !cal.ok) return null;
    const c = document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(this.canvas, 0, 0);
    const u = Math.max(1, c.width / 900);
    for (const s of extraSeries) {
      const pts = s.points.map(([x, y]) => cal.toPixel(x, y)).filter(([px, py]) => isFinite(px) && isFinite(py));
      if (!pts.length) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 3 * u;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
    return c;
  }
}

function rgbToHue([r, g, b]) {
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
  return [h];
}
