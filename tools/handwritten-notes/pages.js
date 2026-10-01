/* ==========================================================================
   Handwritten notes — page images: loading, scan clean-up, rotate, crop
   ========================================================================== */

const MAX_SIDE = 2400; // working resolution: plenty for handwriting, light on memory

let nextId = 1;

export function newCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function fitCanvas(source, sw, sh, maxSide = MAX_SIDE) {
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const c = newCanvas(sw * s, sh * s);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      reject(new Error(heic
        ? `“${file.name}” is a HEIC photo, which this browser can't open. On iPhone choose the photo through this page (it converts automatically), or set Camera → Formats → Most Compatible.`
        : `“${file.name}” isn't an image this browser can open.`));
    };
    img.src = url;
  });
}

function makePage(canvas, name) {
  return { id: nextId++, name, source: canvas, rotation: 0, crop: [0, 0, 1, 1], mode: "enhance", out: null, thumb: "" };
}

export const pageFromCanvas = (canvas, name) => makePage(fitCanvas(canvas, canvas.width, canvas.height), name);

export async function pagesFromImage(file) {
  const { img, url } = await loadImageElement(file);
  try {
    const canvas = fitCanvas(img, img.naturalWidth, img.naturalHeight);
    return [makePage(canvas, file.name)];
  } finally {
    URL.revokeObjectURL(url);
  }
}

let pdfjs = null;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import("../../assets/vendor/pdf.min.js");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../assets/vendor/pdf.worker.min.js", import.meta.url).href;
  }
  return pdfjs;
}

export async function pagesFromPdf(file, onProgress) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = lib.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const pages = [];
  try {
    const n = Math.min(doc.numPages, 60);
    for (let p = 1; p <= n; p++) {
      if (onProgress) onProgress(p, n);
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, 2200 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = newCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      page.cleanup();
      pages.push(makePage(canvas, `${file.name.replace(/\.pdf$/i, "")} – p${p}`));
    }
    if (doc.numPages > n) pages.truncated = doc.numPages;
  } finally {
    task.destroy();
  }
  return pages;
}

/** The source turned by page.rotation (no crop, no clean-up). */
export function rotated(page) {
  const r = ((page.rotation % 360) + 360) % 360;
  const s = page.source;
  if (!r) return s;
  const swap = r === 90 || r === 270;
  const c = newCanvas(swap ? s.height : s.width, swap ? s.width : s.height);
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(s, -s.width / 2, -s.height / 2);
  return c;
}

/* ---------- Scan clean-up ---------- */

/**
 * Flattens uneven lighting (divides by an estimate of the paper colour),
 * whitens the paper and darkens the ink, keeping coloured pens coloured.
 * mode: "enhance" (colour), "bw" (black & white), "original"
 */
export function cleanUp(canvas, mode) {
  if (mode === "original") return canvas;
  const W = canvas.width;
  const H = canvas.height;
  const out = newCanvas(W, H);
  const octx = out.getContext("2d");
  octx.drawImage(canvas, 0, 0);
  const img = octx.getImageData(0, 0, W, H);
  const d = img.data;

  // 1. Paper brightness per cell: a high percentile of each cell's luminance
  const cell = Math.max(12, Math.round(Math.max(W, H) / 48));
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const BINS = 64;
  const hist = new Uint32Array(gw * gh * BINS);
  for (let y = 0; y < H; y += 2) {
    const gy = (y / cell) | 0;
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      hist[(gy * gw + ((x / cell) | 0)) * BINS + (l >> 2)]++;
    }
  }
  let grid = new Float32Array(gw * gh);
  for (let g = 0; g < gw * gh; g++) {
    let total = 0;
    for (let b = 0; b < BINS; b++) total += hist[g * BINS + b];
    const target = total * 0.9;
    let acc = 0;
    let b = 0;
    for (; b < BINS; b++) { acc += hist[g * BINS + b]; if (acc >= target) break; }
    grid[g] = Math.max(24, (b + 0.5) * 4);
  }
  // Cells full of ink (thick strokes, shaded boxes) borrow from brighter neighbours
  const pass = (fn) => {
    const next = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const vals = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = gy + dy, xx = gx + dx;
            if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) vals.push(grid[yy * gw + xx]);
          }
        next[gy * gw + gx] = fn(vals, grid[gy * gw + gx]);
      }
    grid = next;
  };
  pass((v) => Math.max(...v));
  pass((v) => v.reduce((a, b) => a + b, 0) / v.length);
  pass((v) => v.reduce((a, b) => a + b, 0) / v.length);

  // 2. Divide every pixel by the (bilinear) paper estimate, then stretch
  const bw = mode === "bw";
  const lo = bw ? 0.5 : 0.18;
  const hi = bw ? 0.82 : 0.86;
  const span = hi - lo;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5));
    const y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5));
      const x0 = fx | 0, x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const bg =
        (grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx) * (1 - ty) +
        (grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx) * ty;
      const i = (y * W + x) * 4;
      if (bw) {
        const l = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / bg;
        let v = (l - lo) / span;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        const g = Math.round(255 * v * v * (3 - 2 * v));
        d[i] = d[i + 1] = d[i + 2] = g;
      } else {
        let r = (d[i] / bg - lo) / span;
        let g = (d[i + 1] / bg - lo) / span;
        let b = (d[i + 2] / bg - lo) / span;
        // ink a little darker, colours a little stronger
        const m = (r + g + b) / 3;
        r = m + (r - m) * 1.35;
        g = m + (g - m) * 1.35;
        b = m + (b - m) * 1.35;
        d[i] = 255 * Math.pow(r < 0 ? 0 : r > 1 ? 1 : r, 1.3);
        d[i + 1] = 255 * Math.pow(g < 0 ? 0 : g > 1 ? 1 : g, 1.3);
        d[i + 2] = 255 * Math.pow(b < 0 ? 0 : b > 1 ? 1 : b, 1.3);
      }
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Applies rotation, crop and clean-up; updates page.out and page.thumb. */
export function renderPage(page) {
  const r = rotated(page);
  const [x0, y0, x1, y1] = page.crop;
  const sx = Math.round(x0 * r.width), sy = Math.round(y0 * r.height);
  const sw = Math.max(8, Math.round((x1 - x0) * r.width)), sh = Math.max(8, Math.round((y1 - y0) * r.height));
  let c = r;
  if (sx || sy || sw !== r.width || sh !== r.height) {
    c = newCanvas(sw, sh);
    c.getContext("2d").drawImage(r, sx, sy, sw, sh, 0, 0, sw, sh);
  }
  page.out = cleanUp(c, page.mode);
  const t = fitCanvas(page.out, page.out.width, page.out.height, 420);
  page.thumb = t.toDataURL("image/jpeg", 0.8);
  page.version = (page.version || 0) + 1;
  return page;
}

export function canvasToBlob(canvas, type = "image/jpeg", quality = 0.88) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), type, quality);
    else fetch(canvas.toDataURL(type, quality)).then((r) => r.blob()).then(resolve, reject);
  });
}

/** JPEG for the AI reader: long side ≤ maxSide. */
export async function pageJpeg(page, maxSide = 2000, quality = 0.86) {
  const c = fitCanvas(page.out, page.out.width, page.out.height, maxSide);
  const blob = await canvasToBlob(c, "image/jpeg", quality);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { blob, bytes, w: c.width, h: c.height };
}

export function bytesToBase64(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/** Crop a figure (fractions of the cleaned page) → canvas, with a little white padding. */
export function cropFigure(page, box) {
  const src = page.out;
  const [x0, y0, x1, y1] = box;
  const sx = Math.round(x0 * src.width), sy = Math.round(y0 * src.height);
  const sw = Math.max(4, Math.round((x1 - x0) * src.width)), sh = Math.max(4, Math.round((y1 - y0) * src.height));
  const pad = Math.round(Math.max(sw, sh) * 0.02);
  const c = newCanvas(sw + 2 * pad, sh + 2 * pad);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, sx, sy, sw, sh, pad, pad, sw, sh);
  return c;
}

/* ---------- Box editor (crop a page / pick a figure) ---------- */

/**
 * Opens a full-screen editor showing `canvas` with a draggable box.
 * Resolves to [x0,y0,x1,y1] (fractions) or null when cancelled.
 */
export function editBox({ canvas, box = [0.05, 0.05, 0.95, 0.95], title, hint, okLabel = "Apply", extra = "" }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "hn-modal";
    wrap.innerHTML = `
      <div class="hn-modal-card" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="hn-modal-head">
          <div><h3>${title}</h3><p>${hint || ""}</p></div>
          <button class="icon-btn hn-close" type="button" aria-label="Close">✕</button>
        </div>
        <div class="hn-stage"><div class="hn-stage-inner"><div class="hn-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
        <div class="hn-modal-foot">${extra}<span class="spacer"></span><button class="btn hn-cancel" type="button">Cancel</button><button class="btn btn-primary hn-ok" type="button">${okLabel}</button></div>
      </div>`;
    document.body.appendChild(wrap);
    document.body.classList.add("hn-noscroll");
    const inner = wrap.querySelector(".hn-stage-inner");
    const view = fitCanvas(canvas, canvas.width, canvas.height, 1600);
    view.className = "hn-stage-img";
    inner.prepend(view);
    const boxEl = wrap.querySelector(".hn-box");
    let b = box.slice();
    const draw = () => {
      boxEl.style.left = b[0] * 100 + "%";
      boxEl.style.top = b[1] * 100 + "%";
      boxEl.style.width = (b[2] - b[0]) * 100 + "%";
      boxEl.style.height = (b[3] - b[1]) * 100 + "%";
    };
    draw();

    let drag = null;
    const pt = (e) => {
      const r = view.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    inner.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const p = pt(e);
      const h = e.target.dataset && e.target.dataset.h;
      if (h) drag = { kind: h };
      else if (e.target === boxEl) drag = { kind: "move", start: p, orig: b.slice() };
      else { drag = { kind: "se" }; b = [p[0], p[1], p[0], p[1]]; }
      inner.setPointerCapture(e.pointerId);
    });
    inner.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const [x, y] = pt(e);
      if (drag.kind === "move") {
        const dx = x - drag.start[0], dy = y - drag.start[1];
        const w = drag.orig[2] - drag.orig[0], h = drag.orig[3] - drag.orig[1];
        const nx = Math.min(1 - w, Math.max(0, drag.orig[0] + dx)), ny = Math.min(1 - h, Math.max(0, drag.orig[1] + dy));
        b = [nx, ny, nx + w, ny + h];
      } else {
        if (drag.kind.includes("n")) b[1] = y;
        if (drag.kind.includes("s")) b[3] = y;
        if (drag.kind.includes("w")) b[0] = x;
        if (drag.kind.includes("e")) b[2] = x;
      }
      draw();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      b = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
      if (b[2] - b[0] < 0.02 || b[3] - b[1] < 0.02) b = box.slice();
      draw();
    };
    inner.addEventListener("pointerup", end);
    inner.addEventListener("pointercancel", end);

    const close = (val) => {
      wrap.remove();
      document.body.classList.remove("hn-noscroll");
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    document.addEventListener("keydown", onKey);
    wrap.querySelector(".hn-close").onclick = () => close(null);
    wrap.querySelector(".hn-cancel").onclick = () => close(null);
    wrap.querySelector(".hn-ok").onclick = () => close(b.map((v) => Math.round(v * 1000) / 1000));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(null); });
    wrap.querySelectorAll("[data-box]").forEach((btn) =>
      btn.addEventListener("click", () => { b = btn.dataset.box.split(",").map(Number); draw(); })
    );
    wrap.querySelector(".hn-ok").focus();
  });
}
