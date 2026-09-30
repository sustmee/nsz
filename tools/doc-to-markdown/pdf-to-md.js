/* ==========================================================================
   PDF → Markdown converter (runs fully in the browser with pdf.js)

   Pipeline, per page:
     1. Walk the operator list to find raster images and vector drawings
        (with their position on the page).
     2. Read the text layer, detect a two-column layout, group text into lines.
     3. Find simple tables, vector figures (drawings next to a "Figure N"
        caption) and repeating headers/footers.
   Then, for the whole document:
     4. Put lines and figures in reading order, join lines into paragraphs,
        detect headings and lists, and write Markdown.
   ========================================================================== */

import * as pdfjsLib from "../../assets/vendor/pdf.min.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../assets/vendor/pdf.worker.min.js", import.meta.url).href;

const { OPS, ImageKind } = pdfjsLib;

const DEFAULTS = {
  figurePrefix: "fig",
  minFigureSize: 40, // points (1/72 inch); smaller images are treated as icons
  removeHeadersFooters: true,
  detectTables: true,
  vectorFigures: true,
  pageMarkers: false,
  pageSnapshots: false,
  extractFigures: true, // false = text only (faster; used by other tools)
};

const CAPTION_RE = /^(fig(?:ure)?\.?|table)\s*~?(\d+|[ivxlc]+)\s*[.:|—–-]/i;
const FIGURE_CAPTION_RE = /^fig(?:ure)?\.?\s*~?(\d+|[ivxlc]+)\s*[.:|—–-]/i;
const BULLET_RE = /^(?:[•●▪◦■□➢►▸‣⁃∙·]\s*|[–—*-]\s+)(.*)$/;
const ORDERED_RE = /^(\(?(\d{1,3}|[a-z])[.)])\s+(.*)$/;
const TERMINAL_RE = /[.!?:]["'”’)\]]*$/;

/* ---------------------------------------------------------------------- */
/* Small geometry helpers                                                  */
/* ---------------------------------------------------------------------- */

function mul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyToRect(m, x0, y0, x1, y1) {
  const pts = [
    [x0, y0], [x1, y0], [x0, y1], [x1, y1],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const rw = (r) => r.x1 - r.x0;
const rh = (r) => r.y1 - r.y0;
const area = (r) => Math.max(0, rw(r)) * Math.max(0, rh(r));

function intersectArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function union(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function expand(r, dx, dy = dx) {
  return { x0: r.x0 - dx, y0: r.y0 - dy, x1: r.x1 + dx, y1: r.y1 + dy };
}

function hOverlap(a, b) {
  return Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/* ---------------------------------------------------------------------- */
/* Markdown text helpers                                                   */
/* ---------------------------------------------------------------------- */

function escapeMd(s) {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/([*`])/g, "\\$1")
    .replace(/(^|[^\p{L}\p{N}])_/gu, "$1\\_")
    .replace(/_(?=[^\p{L}\p{N}]|$)/gu, "\\_")
    .replace(/<(?=[A-Za-z/!?])/g, "\\<");
}

function escapeLineStart(s) {
  // Stop plain paragraphs from being read as headings, quotes or lists.
  return s.replace(/^(#{1,6}\s|>|[-+]\s|\d+[.)]\s)/, (m) => "\\" + m);
}

function wrapStyle(text, bold, italic) {
  if (!bold && !italic) return text;
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m[2]) return text;
  const mark = bold && italic ? "***" : bold ? "**" : "*";
  return m[1] + mark + m[2] + mark + m[3];
}

function joinText(a, b) {
  if (!a) return b;
  if (!b) return a;
  // Re-join words hyphenated across a line break ("exam-" + "ple").
  if (/[\p{Ll}]-$/u.test(a) && /^[\p{Ll}]/u.test(b)) return a.slice(0, -1) + b;
  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;
  return a + " " + b;
}

function normalizeText(s) {
  return s
    .replace(/\u00ad/g, "") // soft hyphen
    .replace(/[\u00a0\u2000-\u200a\u202f]/g, " ")
    .replace(/\ufb01/g, "fi").replace(/\ufb02/g, "fl").replace(/\ufb00/g, "ff")
    .replace(/\ufb03/g, "ffi").replace(/\ufb04/g, "ffl");
}

/* ---------------------------------------------------------------------- */
/* Canvas / image helpers                                                  */
/* ---------------------------------------------------------------------- */

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))), "image/png")
  );
}

function getPdfObject(page, id) {
  const store = id.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(null), 5000);
    try {
      store.get(id, (obj) => {
        clearTimeout(timer);
        finish(obj);
      });
    } catch (e) {
      clearTimeout(timer);
      finish(null);
    }
  });
}

function imageDataToCanvas(img, flipX, flipY) {
  if (!img || !img.width || !img.height) return null;
  const { width: w, height: h } = img;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  let source = null;
  if (img.bitmap) {
    source = img.bitmap;
  } else if (img.data) {
    const out = ctx.createImageData(w, h);
    const dst = out.data;
    const src = img.data;
    if (img.kind === ImageKind.RGBA_32BPP) {
      dst.set(src.subarray(0, dst.length));
    } else if (img.kind === ImageKind.RGB_24BPP) {
      for (let i = 0, j = 0; j < dst.length; i += 3, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i + 1];
        dst[j + 2] = src[i + 2];
        dst[j + 3] = 255;
      }
    } else if (img.kind === ImageKind.GRAYSCALE_1BPP) {
      const rowBytes = (w + 7) >> 3;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          const v = bit ? 255 : 0;
          const j = (y * w + x) * 4;
          dst[j] = dst[j + 1] = dst[j + 2] = v;
          dst[j + 3] = 255;
        }
      }
    } else {
      return null;
    }
    if (!flipX && !flipY) {
      ctx.putImageData(out, 0, 0);
      return canvas;
    }
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    tmp.getContext("2d").putImageData(out, 0, 0);
    source = tmp;
  } else {
    return null;
  }

  ctx.save();
  ctx.translate(flipX ? w : 0, flipY ? h : 0);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  return canvas;
}

/** Cheap fingerprint of a canvas, used to spot logos repeated on every page. */
function fingerprint(canvas) {
  const s = 12;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  let key = canvas.width + "x" + canvas.height + ":";
  for (let i = 0; i < d.length; i += 4) key += ((d[i] >> 5) << 6 | (d[i + 1] >> 5) << 3 | (d[i + 2] >> 5)).toString(36);
  return key;
}

/* ---------------------------------------------------------------------- */
/* Step 1 — operator list: images and vector paths                          */
/* ---------------------------------------------------------------------- */

function intersect(a, b) {
  return { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
}

function scanOperators(opList, view) {
  const images = [];
  const paths = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  // Visible area: drawings are often clipped (e.g. an embedded PDF figure),
  // and only the visible part matters for locating figures.
  let clip = { x0: view[0], y0: view[1], x1: view[2], y1: view[3] };
  let pendingClip = false;
  const stack = [];
  const { fnArray, argsArray } = opList;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push([ctm, clip]);
        break;
      case OPS.restore:
        if (stack.length) [ctm, clip] = stack.pop();
        break;
      case OPS.transform:
        ctm = mul(ctm, args);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push([ctm, clip]);
        if (args && args[0] && args[0].length === 6) ctm = mul(ctm, Array.from(args[0]));
        if (args && args[1] && args[1].length === 4) {
          const bb = args[1];
          clip = intersect(clip, applyToRect(ctm, bb[0], bb[1], bb[2], bb[3]));
        }
        break;
      case OPS.paintFormXObjectEnd:
        if (stack.length) [ctm, clip] = stack.pop();
        break;
      case OPS.clip:
      case OPS.eoClip:
        pendingClip = true;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        const box = intersect(applyToRect(ctm, 0, 0, 1, 1), clip);
        if (rw(box) <= 0 || rh(box) <= 0) break;
        const img = { bbox: box, flipX: ctm[0] < 0, flipY: ctm[3] < 0 };
        if (fn === OPS.paintImageXObject) img.id = args[0];
        else img.inline = args[0];
        images.push(img);
        break;
      }
      case OPS.constructPath: {
        const paintOp = args[0];
        const mm = args[2];
        if (!mm || !isFinite(mm[0]) || !isFinite(mm[2])) {
          pendingClip = false;
          break;
        }
        const box = applyToRect(ctm, mm[0], mm[1], mm[2], mm[3]);
        if (pendingClip) {
          clip = intersect(clip, box);
          pendingClip = false;
        }
        if (paintOp === OPS.endPath) break; // clipping-only path: nothing is drawn
        const visible = intersect(box, clip);
        if (rw(visible) >= 0 && rh(visible) >= 0 && (rw(visible) > 0 || rh(visible) > 0)) paths.push(visible);
        break;
      }
      default:
        break;
    }
  }
  return { images, paths };
}

/* ---------------------------------------------------------------------- */
/* Step 2 — text items, columns and lines                                   */
/* ---------------------------------------------------------------------- */

async function resolveFonts(page, textContent) {
  const fonts = {};
  const names = new Set(textContent.items.map((i) => i.fontName).filter(Boolean));
  await Promise.all(
    [...names].map(async (name) => {
      let bold = false;
      let italic = false;
      let fontName = (textContent.styles[name] && textContent.styles[name].fontFamily) || "";
      const font = await getPdfObject(page, name);
      if (font && typeof font === "object") {
        try {
          fontName = font.name || fontName;
          bold = !!font.bold || !!font.black;
          italic = !!font.italic;
        } catch (e) { /* font data not available */ }
      }
      const n = String(fontName).replace(/^[A-Z]{6}\+/, "");
      if (/bold|black|heavy|semibold|demi|[-,]medi|\bcmbx|\bcmb\d|sfbx|[-,]bd?\b|extrab/i.test(n)) bold = true;
      if (/italic|oblique|\bcmti|sfti|[-,]it\b|[-,]ital/i.test(n)) italic = true;
      if (/cmmi|math/i.test(n)) italic = false; // math-italic variables are not emphasis
      fonts[name] = { bold, italic, name: n };
    })
  );
  return fonts;
}

function collectItems(textContent, fonts) {
  const items = [];
  const rotated = [];
  for (const it of textContent.items) {
    if (typeof it.str !== "string") continue;
    const str = normalizeText(it.str);
    if (!str.trim()) continue;
    const tr = it.transform;
    const size = Math.hypot(tr[2], tr[3]) || it.height || 10;
    const horizontal = tr[0] > 0 && Math.abs(tr[1]) < 0.05 * Math.abs(tr[0]) && Math.abs(tr[2]) < 0.05 * Math.abs(tr[3]);
    if (!horizontal) {
      // Rotated text (e.g. side stamps, rotated axis labels) is skipped from the text
      // but remembered so vector figures can include their labels.
      const w = it.width || size * str.length * 0.5;
      rotated.push({ x0: tr[4] - size, y0: tr[5] - w, x1: tr[4] + size, y1: tr[5] + w });
      continue;
    }
    const f = fonts[it.fontName] || {};
    const width = it.width > 0 ? it.width : size * str.length * 0.5;
    items.push({
      str,
      x: tr[4],
      y: tr[5],
      w: width,
      size,
      bold: !!f.bold,
      italic: !!f.italic,
    });
  }
  return { items, rotated };
}

/** Returns an x-coordinate for the gap between two text columns, or null. */
function detectGutter(items, view) {
  const W = view[2] - view[0];
  const lo = view[0] + W * 0.3;
  const hi = view[0] + W * 0.7;

  // Merge items on the same baseline into segments; normal word gaps are
  // bridged, a column gutter is not.
  const rows = new Map();
  for (const it of items) {
    const key = Math.round(it.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(it);
  }
  const segments = [];
  for (const [y, row] of rows) {
    row.sort((a, b) => a.x - b.x);
    let seg = null;
    for (const it of row) {
      const bridge = Math.max(7, it.size * 0.7);
      if (seg && it.x - seg.x1 < bridge) {
        seg.x1 = Math.max(seg.x1, it.x + it.w);
        seg.chars += it.str.length;
      } else {
        seg = { y, x0: it.x, x1: it.x + it.w, chars: it.str.length };
        segments.push(seg);
      }
    }
  }

  const total = segments.reduce((s, g) => s + g.chars, 0);
  if (total < 200) return null;
  const bins = Math.ceil(hi - lo);
  const cover = new Float64Array(bins);
  for (const g of segments) {
    const a = Math.max(0, Math.floor(g.x0 - lo));
    const b = Math.min(bins - 1, Math.ceil(g.x1 - lo));
    for (let i = a; i <= b; i++) cover[i] += g.chars;
  }

  // Pick the least-crossed x; prefer the one closest to the page centre.
  let best = -1;
  let bestVal = Infinity;
  const mid = bins / 2;
  for (let i = 0; i < bins; i++) {
    const v = cover[i] + Math.abs(i - mid) * 0.01;
    if (v < bestVal) {
      bestVal = v;
      best = i;
    }
  }
  const gx = lo + best;
  let left = 0;
  let right = 0;
  let span = 0;
  const leftRows = new Map(); // y → [x0, x1] extent of the row's text on that side
  const rightRows = new Map();
  let minX = Infinity;
  let maxX = -Infinity;
  const extend = (map, g) => {
    const e = map.get(g.y);
    map.set(g.y, e ? [Math.min(e[0], g.x0), Math.max(e[1], g.x1)] : [g.x0, g.x1]);
  };
  for (const g of segments) {
    minX = Math.min(minX, g.x0);
    maxX = Math.max(maxX, g.x1);
    if (g.x1 <= gx + 1) {
      left += g.chars;
      extend(leftRows, g);
    } else if (g.x0 >= gx - 1) {
      right += g.chars;
      extend(rightRows, g);
    } else span += g.chars;
  }
  // Real columns: rows of text sit side by side on both sides of the gap
  // (not necessarily on the same baseline), and each side's lines fill most
  // of their column — table cells don't.
  const rys = [...rightRows.keys()];
  const paired = [...leftRows.keys()].filter((y) => rys.some((ry) => Math.abs(ry - y) <= 5)).length;
  const widths = (map) => [...map.values()].map((e) => e[1] - e[0]);
  const mlw = median(widths(leftRows));
  const mrw = median(widths(rightRows));
  const fullLeft = mlw >= (gx - minX) * 0.55;
  const fullRight = mrw >= (maxX - gx) * 0.55;
  if (
    left > total * 0.08 &&
    right > total * 0.08 &&
    span < total * 0.35 &&
    leftRows.size >= 4 &&
    rightRows.size >= 4 &&
    paired >= Math.min(3, rightRows.size - 1) &&
    (fullLeft || fullRight) // one side may hold code, a figure or a short list
  ) {
    return gx;
  }
  return null;
}

function regionOf(x0, x1, gutter) {
  if (gutter == null) return "S";
  if (x1 <= gutter + 2) return "L";
  if (x0 >= gutter - 2) return "R";
  return "S";
}

function buildLines(items, gutter, pageNum) {
  const byRegion = { L: [], R: [], S: [] };
  for (const it of items) byRegion[regionOf(it.x, it.x + it.w, gutter)].push(it);

  const lines = [];
  for (const region of ["S", "L", "R"]) {
    const list = byRegion[region].sort((a, b) => b.y - a.y || a.x - b.x);
    const open = [];
    for (const it of list) {
      let target = null;
      for (let k = open.length - 1; k >= Math.max(0, open.length - 6); k--) {
        const ln = open[k];
        const tol = 0.45 * Math.max(ln.maxSize, it.size);
        if (Math.abs(ln.y - it.y) <= tol) {
          target = ln;
          break;
        }
      }
      if (!target) {
        target = { items: [], y: it.y, maxSize: it.size, region, page: pageNum };
        open.push(target);
      }
      target.items.push(it);
      if (it.size > target.maxSize) {
        target.maxSize = it.size;
        target.y = it.y;
      }
    }
    lines.push(...mergeScripts(open));
  }

  for (const ln of lines) finishLine(ln);
  return lines;
}

/** Superscripts/subscripts (smaller text slightly above/below a line) belong to that line. */
function mergeScripts(lines) {
  const bounds = (ln) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const it of ln.items) {
      x0 = Math.min(x0, it.x);
      x1 = Math.max(x1, it.x + it.w);
    }
    return [x0, x1];
  };
  const out = [];
  const sorted = [...lines].sort((a, b) => b.maxSize - a.maxSize);
  const merged = new Set();
  for (const small of [...lines].sort((a, b) => a.maxSize - b.maxSize)) {
    if (merged.has(small)) continue;
    const [sx0, sx1] = bounds(small);
    const host = sorted.find((big) => {
      if (big === small || merged.has(big) || small.maxSize >= big.maxSize * 0.85) return false;
      const dy = small.y - big.y;
      if (dy > big.maxSize * 0.75 || dy < -big.maxSize * 0.45) return false;
      const [bx0, bx1] = bounds(big);
      return sx0 >= bx0 - big.maxSize * 1.5 && sx1 <= bx1 + big.maxSize * 1.5;
    });
    if (host) {
      host.items.push(...small.items);
      merged.add(small);
    }
  }
  for (const ln of lines) if (!merged.has(ln)) out.push(ln);
  return out;
}

function finishLine(ln) {
  const items = ln.items.sort((a, b) => a.x - b.x);
  // Dominant font size = size carrying the most characters.
  const sizeCount = new Map();
  let boldChars = 0;
  let italicChars = 0;
  let chars = 0;
  for (const it of items) {
    const n = it.str.replace(/\s/g, "").length;
    const key = Math.round(it.size * 2) / 2;
    sizeCount.set(key, (sizeCount.get(key) || 0) + n);
    chars += n;
    if (it.bold) boldChars += n;
    if (it.italic) italicChars += n;
  }
  let size = 0;
  let best = -1;
  for (const [s, c] of sizeCount) if (c > best) { best = c; size = s; }

  // Build plain text, Markdown (with bold/italic) and table cells.
  let text = "";
  let md = "";
  const cells = [];
  let cell = null;
  let prev = null;
  let run = null;
  const flushRun = () => {
    if (!run) return;
    const styled = run.bold || run.italic ? wrapStyle(run.text, run.bold, run.italic && run.text.trim().length > 2) : run.text;
    md += styled;
    run = null;
  };
  for (const it of items) {
    let piece = it.str;
    // Raised, smaller text is a superscript: 10^9, s^-1, m^2
    const isSup = it.size < size * 0.85 && it.y > ln.y + size * 0.2 && /^[\s\d+\-\u2212*†‡§,a-z]{1,8}$/i.test(piece.trim());
    if (isSup) {
      const continues = prev && prev.sup && it.x - (prev.x + prev.w) < size * 0.3;
      piece = (continues ? "" : "^") + piece.trim().replace(/\u2212/g, "-");
    }
    it.sup = isSup;
    let sep = "";
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const needSpace = gap > 0.15 * size && !/\s$/.test(prev.str) && !/^\s/.test(piece) && !piece.startsWith("^");
      if (needSpace) sep = " ";
      if (gap > Math.max(1.1 * size, 8)) {
        cells.push(cell);
        cell = null;
      }
    }
    text += sep + piece;
    const b = it.bold && boldChars < chars * 0.8 ? true : false; // whole-line bold is handled as a block
    const i = it.italic && italicChars < chars * 0.8 ? true : false;
    if (run && (run.bold !== b || run.italic !== i)) flushRun();
    if (!run) {
      run = { bold: b, italic: i, text: "" };
      if (sep) {
        md += sep;
        sep = "";
      }
    }
    run.text += sep + escapeMd(piece);
    if (!cell) cell = { x0: it.x, x1: it.x + it.w, text: piece.trim() };
    else {
      cell.text = joinText(cell.text, piece.trim());
      cell.x1 = it.x + it.w;
    }
    prev = it;
  }
  flushRun();
  if (cell) cells.push(cell);

  ln.text = text.replace(/\s+/g, " ").trim();
  ln.md = md.replace(/\s+/g, " ").trim();
  ln.size = size || ln.maxSize;
  ln.bold = chars > 0 && boldChars >= chars * 0.8;
  ln.italic = chars > 0 && italicChars >= chars * 0.8;
  ln.x0 = items[0].x;
  ln.x1 = Math.max(...items.map((i) => i.x + i.w));
  ln.top = ln.y + ln.size * 0.8;
  ln.bottom = ln.y - ln.size * 0.25;
  ln.cells = cells;
  ln.chars = chars;
  delete ln.items;
}

/* ---------------------------------------------------------------------- */
/* Step 3 — tables and vector figures                                       */
/* ---------------------------------------------------------------------- */

function detectTables(lines) {
  // lines: one region of one page, top-to-bottom.
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].cells.length < 2) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].cells.length >= 2 && lines[j].y - lines[j + 1].y < lines[j].size * 3.2) j++;
    const run = lines.slice(i, j + 1);
    if (run.length >= 3) {
      const table = buildTable(run);
      if (table) tables.push({ lines: run, rows: table });
    }
    i = j + 1;
  }
  return tables;
}

function buildTable(run) {
  const starts = run.flatMap((l) => l.cells.map((c) => c.x0)).sort((a, b) => a - b);
  const anchors = [];
  for (const x of starts) {
    const last = anchors[anchors.length - 1];
    if (last && x - last.x < 14) {
      last.n++;
    } else anchors.push({ x, n: 1 });
  }
  const cols = anchors.filter((a) => a.n >= Math.max(2, run.length * 0.4)).map((a) => a.x);
  if (cols.length < 2) return null;
  const rows = run.map((l) => {
    const row = new Array(cols.length).fill("");
    for (const c of l.cells) {
      let k = 0;
      for (let q = 0; q < cols.length; q++) if (c.x0 >= cols[q] - 14) k = q;
      row[k] = row[k] ? row[k] + " " + c.text : c.text;
    }
    return row;
  });
  const aligned = run.filter((l) => l.cells.length >= 2).length;
  if (aligned < run.length * 0.6) return null;
  // Rows of long sentences are prose (e.g. undetected columns), not a table.
  const lens = rows.flat().filter(Boolean).map((c) => c.length);
  if (median(lens) > 35) return null;
  return rows;
}

function tableToMarkdown(rows) {
  const esc = (s) => escapeMd(s).replace(/\|/g, "\\|");
  const n = Math.max(...rows.map((r) => r.length));
  const line = (r) => "| " + Array.from({ length: n }, (_, i) => esc(r[i] || "")).join(" | ") + " |";
  return [line(rows[0]), "| " + new Array(n).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
}

function detectVectorFigures(ctx) {
  const { paths, lines, rotated, rasterBoxes, view, minSize } = ctx;
  const W = view[2] - view[0];
  const H = view[3] - view[1];
  const cell = 5;
  const gw = Math.ceil(W / cell) + 1;
  const gh = Math.ceil(H / cell) + 1;

  const usable = paths.filter((p) => {
    const w = rw(p);
    const h = rh(p);
    if (w > W * 0.9 && h > H * 0.9) return false; // page background
    if (w < 0.3 && h < 0.3) return false;
    return true;
  });
  if (usable.length < 3) return [];

  // Union-find over paths sharing (dilated) grid cells.
  const parent = usable.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Int32Array(gw * gh).fill(-1);
  usable.forEach((p, idx) => {
    const cx0 = Math.max(0, Math.floor((p.x0 - view[0]) / cell) - 1);
    const cx1 = Math.min(gw - 1, Math.floor((p.x1 - view[0]) / cell) + 1);
    const cy0 = Math.max(0, Math.floor((p.y0 - view[1]) / cell) - 1);
    const cy1 = Math.min(gh - 1, Math.floor((p.y1 - view[1]) / cell) + 1);
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const c = y * gw + x;
        if (owner[c] === -1) owner[c] = idx;
        else {
          const a = find(owner[c]);
          const b = find(idx);
          if (a !== b) parent[a] = b;
        }
      }
    }
  });

  const groups = new Map();
  usable.forEach((p, idx) => {
    const r = find(idx);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = { bbox: { ...p }, count: 0, solid: 0 }));
    g.bbox = union(g.bbox, p);
    g.count++;
    if (rw(p) > 3 && rh(p) > 3) g.solid++;
  });

  const captions = lines.filter((l) => FIGURE_CAPTION_RE.test(l.text));
  const candidates = [];
  for (const g of groups.values()) {
    const b = g.bbox;
    if (rw(b) < minSize || rh(b) < minSize * 0.6) continue;
    if (g.count < 3) continue;
    if (rasterBoxes.some((r) => intersectArea(r, b) > area(b) * 0.5)) continue;

    // Nearest "Figure N" caption just below (or just above) the drawing.
    let caption = null;
    let bestDist = Infinity;
    for (const c of captions) {
      const cb = { x0: c.x0, x1: c.x1, y0: c.bottom, y1: c.top };
      if (hOverlap(cb, b) < Math.min(rw(cb), rw(b)) * 0.3) continue;
      const below = b.y0 - cb.y1;
      const above = cb.y0 - b.y1;
      const d = below >= -4 && below < 50 ? below : above >= -4 && above < 30 ? above + 20 : Infinity;
      if (d < bestDist) {
        bestDist = d;
        caption = c;
      }
    }
    if (!caption) {
      // No "Figure N" caption: only accept large, drawing-like groups that are
      // not tables or text boxes (those contain a lot of text).
      const bigDrawing = g.solid >= 3 && g.count >= 8 && area(b) > W * H * 0.06;
      if (!bigDrawing) continue;
      const textInside = lines
        .filter((l) => intersectArea({ x0: l.x0, x1: l.x1, y0: l.bottom, y1: l.top }, b) > 0)
        .reduce((s, l) => s + l.chars, 0);
      if (textInside > 250) continue;
      const nearTable = lines.some((l) => /^table\s*\S+/i.test(l.text) && hOverlap({ x0: l.x0, x1: l.x1 }, b) > 0 &&
        (Math.abs(l.bottom - b.y1) < 30 || Math.abs(b.y0 - l.top) < 30));
      if (nearTable) continue;
    }
    candidates.push({ bbox: b, caption });
  }

  // Merge sub-figures that share a caption.
  const merged = [];
  for (const c of candidates) {
    const same = c.caption && merged.find((m) => m.caption === c.caption);
    if (same) same.bbox = union(same.bbox, c.bbox);
    else merged.push({ ...c });
  }

  // Grow each figure to include nearby labels (axis ticks, legends, titles).
  const figures = [];
  for (const f of merged) {
    let box = f.bbox;
    const consumed = new Set();
    for (let pass = 0; pass < 3; pass++) {
      const zone = expand(box, 14, 12);
      for (const l of lines) {
        if (consumed.has(l) || l === f.caption || CAPTION_RE.test(l.text)) continue;
        const lb = { x0: l.x0, x1: l.x1, y0: l.bottom, y1: l.top };
        const inside = intersectArea(lb, zone) > area(lb) * 0.5;
        if (inside && (l.text.length < 60 || intersectArea(lb, box) > area(lb) * 0.9)) {
          consumed.add(l);
          box = union(box, lb);
        }
      }
      for (const r of rotated) if (intersectArea(r, expand(box, 20)) > 0) box = union(box, r);
    }
    box = expand(box, 4);
    box = { x0: Math.max(view[0], box.x0), y0: Math.max(view[1], box.y0), x1: Math.min(view[2], box.x1), y1: Math.min(view[3], box.y1) };
    figures.push({ bbox: box, caption: f.caption, consumed });
  }
  return figures;
}

/* ---------------------------------------------------------------------- */
/* Main entry                                                               */
/* ---------------------------------------------------------------------- */

/**
 * @param {ArrayBuffer} data
 * @param {object} options  see DEFAULTS
 * @param {(fraction:number, message:string)=>void} onProgress
 * @returns {Promise<{markdown:string, figures:Array, pages:Array, stats:object, warnings:string[]}>}
 */
export async function convertPdf(data, options = {}, onProgress = () => {}) {
  const opts = { ...DEFAULTS, ...options };
  const warnings = [];
  const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error("This PDF is password-protected. Please remove the password and try again.");
    throw new Error("This file could not be read as a PDF. It may be damaged.");
  }

  const numPages = doc.numPages;
  const pages = [];
  const snapshots = [];
  const figureStore = []; // {canvas|blob, key, pages:Set}
  let totalChars = 0;

  for (let p = 1; p <= numPages; p++) {
    onProgress((p - 1) / numPages, `Reading page ${p} of ${numPages}…`);
    const page = await doc.getPage(p);
    const view = page.view;
    const W = view[2] - view[0];
    const H = view[3] - view[1];

    const opList = await page.getOperatorList();
    const { images, paths } = scanOperators(opList, view);
    const textContent = await page.getTextContent();
    const fonts = await resolveFonts(page, textContent);
    const { items, rotated } = collectItems(textContent, fonts);
    const gutter = detectGutter(items, view);
    const lines = buildLines(items, gutter, p);
    totalChars += lines.reduce((s, l) => s + l.chars, 0);

    // --- Raster images ---
    const pageFigures = [];
    const rasterBoxes = [];
    for (const im of opts.extractFigures ? images : []) {
      const b = im.bbox;
      if (rw(b) < opts.minFigureSize || rh(b) < opts.minFigureSize) continue;
      if (area(b) > W * H * 0.85 && lines.length > 5) continue; // scanned page behind an OCR text layer
      const obj = im.inline || (await getPdfObject(page, im.id));
      const canvas = imageDataToCanvas(obj, im.flipX, im.flipY);
      if (!canvas || canvas.width < 16 || canvas.height < 16) continue;
      const key = fingerprint(canvas);
      let entry = figureStore.find((f) => f.key === key);
      if (!entry) {
        entry = { key, canvas, pages: new Set(), width: canvas.width, height: canvas.height };
        figureStore.push(entry);
      }
      entry.pages.add(p);
      rasterBoxes.push(b);
      pageFigures.push({ type: "figure", entry, bbox: b, page: p });
    }

    // --- Vector drawings ---
    const consumedLines = new Set();
    let vectorFigs = [];
    if (opts.vectorFigures && opts.extractFigures) {
      vectorFigs = detectVectorFigures({ paths, lines, rotated, rasterBoxes, view, minSize: opts.minFigureSize });
    }
    let pageCanvas = null;
    let viewport = null;
    if (vectorFigs.length || opts.pageSnapshots) {
      const scale = Math.min(2.5, 3000 / Math.max(W, H));
      viewport = page.getViewport({ scale });
      pageCanvas = document.createElement("canvas");
      pageCanvas.width = Math.ceil(viewport.width);
      pageCanvas.height = Math.ceil(viewport.height);
      const ctx = pageCanvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      await page.render({ canvasContext: ctx, canvas: pageCanvas, viewport, annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
    }
    for (const vf of vectorFigs) {
      const r = applyToRect(viewport.transform, vf.bbox.x0, vf.bbox.y0, vf.bbox.x1, vf.bbox.y1);
      const sx = Math.max(0, Math.floor(r.x0));
      const sy = Math.max(0, Math.floor(r.y0));
      const sw = Math.min(pageCanvas.width - sx, Math.ceil(r.x1 - sx));
      const sh = Math.min(pageCanvas.height - sy, Math.ceil(r.y1 - sy));
      if (sw < 8 || sh < 8) continue;
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      c.getContext("2d").drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
      const entry = { key: "vec-" + p + "-" + sx + "-" + sy, canvas: c, pages: new Set([p]), width: sw, height: sh, vector: true };
      figureStore.push(entry);
      vf.consumed.forEach((l) => consumedLines.add(l));
      pageFigures.push({ type: "figure", entry, bbox: vf.bbox, page: p });
    }
    if (opts.pageSnapshots && pageCanvas) {
      snapshots.push({ name: `page-${p}.png`, blob: await canvasToBlob(pageCanvas), width: pageCanvas.width, height: pageCanvas.height });
    }

    pages.push({
      num: p,
      view,
      gutter,
      lines: lines.filter((l) => !consumedLines.has(l)),
      figures: pageFigures,
    });
    page.cleanup();
  }

  onProgress(0.96, "Building Markdown…");

  if (totalChars < 20 * numPages) {
    warnings.push(
      totalChars === 0
        ? "This PDF has no text layer (it looks like a scanned document). Page images were saved as figures, but text can't be extracted without OCR."
        : "This PDF has very little text. If it is a scanned document, the text may be missing."
    );
  }

  // Logos / decorations repeated on many pages are not real figures.
  if (numPages >= 3) {
    for (const f of figureStore) {
      if (!f.vector && f.pages.size >= 3 && f.pages.size >= numPages * 0.5) f.decoration = true;
    }
    for (const pg of pages) pg.figures = pg.figures.filter((fig) => !fig.entry.decoration);
  }
  // Show each distinct image only once (first occurrence).
  const seen = new Set();
  for (const pg of pages) {
    pg.figures = pg.figures.filter((fig) => {
      if (seen.has(fig.entry)) return false;
      seen.add(fig.entry);
      return true;
    });
  }

  if (opts.removeHeadersFooters) removeHeadersFooters(pages);

  const blocks = assembleBlocks(pages, opts);
  const { markdown, figureOrder } = renderMarkdown(blocks, opts);

  // Name and encode figures in reading order: fig1.png, fig2.png, …
  const figures = [];
  for (let i = 0; i < figureOrder.length; i++) {
    const { entry, name, caption } = figureOrder[i];
    onProgress(0.97 + (0.03 * i) / Math.max(1, figureOrder.length), `Saving ${name}…`);
    figures.push({ name, blob: await canvasToBlob(entry.canvas), width: entry.width, height: entry.height, caption, vector: !!entry.vector });
    entry.canvas.width = entry.canvas.height = 0; // free memory
  }

  const words = markdown.replace(/!\[[^\]]*\]\([^)]*\)|<!--[\s\S]*?-->/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  await loadingTask.destroy();
  onProgress(1, "Done");
  return { markdown, figures, pages: snapshots, stats: { pages: numPages, words, figures: figures.length }, warnings };
}

/* ---------------------------------------------------------------------- */
/* Headers / footers                                                        */
/* ---------------------------------------------------------------------- */

function removeHeadersFooters(pages) {
  const n = pages.length;
  const zoneOf = (pg, l) => {
    const H = pg.view[3] - pg.view[1];
    if (l.y > pg.view[3] - H * 0.09) return "top";
    if (l.y < pg.view[1] + H * 0.09) return "bottom";
    return null;
  };
  const keyOf = (l) => l.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const counts = new Map();
  if (n >= 2) {
    for (const pg of pages) {
      const keys = new Set();
      for (const l of pg.lines) {
        const z = zoneOf(pg, l);
        if (z) keys.add(z + "|" + keyOf(l));
      }
      keys.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    }
  }
  const pageNumRe = /^(page\s*)?(\d{1,4}|[ivxlc]{1,6})(\s*(of|\/)\s*\d{1,4})?$/i;
  for (const pg of pages) {
    pg.lines = pg.lines.filter((l) => {
      const z = zoneOf(pg, l);
      if (!z) return true;
      if (n >= 2 && pageNumRe.test(l.text.trim())) return false;
      const c = counts.get(z + "|" + keyOf(l)) || 0;
      return !(n >= 2 && c >= Math.max(2, Math.ceil(n * 0.4)) && (n >= 3 || c === n));
    });
  }
}

/* ---------------------------------------------------------------------- */
/* Step 4 — reading order, paragraphs, headings                             */
/* ---------------------------------------------------------------------- */

function orderPage(pg, opts) {
  // Group table lines into one entry each.
  const entries = [];
  for (const region of ["S", "L", "R"]) {
    const lines = pg.lines.filter((l) => l.region === region).sort((a, b) => b.y - a.y);
    const tables = opts.detectTables ? detectTables(lines) : [];
    const inTable = new Set(tables.flatMap((t) => t.lines));
    for (const l of lines) if (!inTable.has(l)) entries.push({ type: "line", line: l, region, top: l.top });
    for (const t of tables) entries.push({ type: "table", rows: t.rows, region, top: t.lines[0].top, bottom: t.lines[t.lines.length - 1].bottom });
  }
  for (const f of pg.figures) {
    entries.push({ ...f, region: regionOf(f.bbox.x0, f.bbox.x1, pg.gutter), top: f.bbox.y1 });
  }
  entries.sort((a, b) => b.top - a.top);

  // Full-width entries split the page into bands; inside a band read the
  // left column first, then the right column.
  const out = [];
  let left = [];
  let right = [];
  const flush = () => {
    out.push(...left, ...right);
    left = [];
    right = [];
  };
  for (const e of entries) {
    if (e.region === "L") left.push(e);
    else if (e.region === "R") right.push(e);
    else {
      flush();
      out.push(e);
    }
  }
  flush();
  return out;
}

function columnMetrics(lines) {
  const m = {};
  for (const region of ["S", "L", "R"]) {
    const ls = lines.filter((l) => l.region === region);
    if (!ls.length) continue;
    m[region] = { left: percentile(ls.map((l) => l.x0), 0.1), right: percentile(ls.map((l) => l.x1), 0.9) };
  }
  return m;
}

function assembleBlocks(pages, opts) {
  // Typical line spacing (as a multiple of font size) to spot paragraph gaps.
  const ratios = [];
  for (const pg of pages) {
    for (const region of ["S", "L", "R"]) {
      const ls = pg.lines.filter((l) => l.region === region).sort((a, b) => b.y - a.y);
      for (let i = 1; i < ls.length; i++) {
        const gap = ls[i - 1].y - ls[i].y;
        if (gap > 0 && gap < ls[i].size * 3 && Math.abs(ls[i].size - ls[i - 1].size) < 0.6) ratios.push(gap / ls[i].size);
      }
    }
  }
  const spacing = median(ratios) || 1.2;
  const body = bodySize(pages.flatMap((pg) => pg.lines));

  const blocks = [];
  let cur = null;
  let deferred = [];

  const isOpen = () => cur && cur.lines.length && !TERMINAL_RE.test(cur.lines[cur.lines.length - 1].text);
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
    if (deferred.length) {
      blocks.push(...deferred);
      deferred = [];
    }
  };

  let prevPage = 0;
  for (const pg of pages) {
    const ordered = orderPage(pg, opts);
    const metrics = columnMetrics(pg.lines);
    if (opts.pageMarkers) {
      flush();
      blocks.push({ type: "page", num: pg.num });
    }
    for (const e of ordered) {
      if (e.type === "figure") {
        if (isOpen()) deferred.push(e);
        else {
          flush();
          blocks.push(e);
        }
        continue;
      }
      if (e.type === "table") {
        flush();
        blocks.push(e);
        continue;
      }
      const line = e.line;
      if (!cur || shouldBreak(cur, line, metrics, spacing, prevPage !== pg.num, body)) {
        flush();
        cur = { type: "para", lines: [line], metrics };
      } else {
        cur.lines.push(line);
      }
      prevPage = pg.num;
    }
  }
  flush();
  return blocks;
}

function bodySize(lines) {
  const sizeChars = new Map();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    sizeChars.set(k, (sizeChars.get(k) || 0) + l.chars);
  }
  let body = 10;
  let best = -1;
  for (const [s, c] of sizeChars) if (c > best) { best = c; body = s; }
  return body;
}

function lineKind(line) {
  if (CAPTION_RE.test(line.text)) return "caption";
  if (BULLET_RE.test(line.text) && line.text.length > 2) return "bullet";
  if (ORDERED_RE.test(line.text)) return "ordered";
  return "text";
}

function shouldBreak(cur, line, metrics, spacing, newPage, body) {
  const prev = cur.lines[cur.lines.length - 1];
  const first = cur.lines[0];
  const kind = lineKind(line);
  if (kind !== "text") return true;
  if (Math.abs(line.size - prev.size) > Math.max(0.6, prev.size * 0.08)) return true;
  const firstKind = lineKind(first);
  // Captions often start with a bold label line; keep the whole caption together.
  if (line.bold !== prev.bold && firstKind !== "caption") return true;

  const col = metrics[line.region] || { left: line.x0, right: line.x1 };
  const prevCol = cur.metrics[prev.region] || col;
  const prevEndsSentence = TERMINAL_RE.test(prev.text);
  const indented = line.x0 - col.left > Math.max(6, line.size * 0.8);

  const sameFlow = !newPage && prev.region === line.region && prev.page === line.page && prev.y > line.y;
  if (sameFlow) {
    const gap = (prev.y - line.y) / line.size;
    if (gap > spacing * 1.45) return true;
    if (firstKind === "bullet" || firstKind === "ordered") {
      // Continuation of a list item is indented past the bullet.
      return line.x0 < first.x0 + line.size * 0.5;
    }
    // Multi-line titles / large headings stay together.
    if (line.size >= body * 1.15 && Math.abs(line.size - prev.size) < 0.3) {
      const sameAlign = Math.abs(line.x0 - prev.x0) < 3 || Math.abs((line.x0 + line.x1) / 2 - (prev.x0 + prev.x1) / 2) < 6;
      return gap > 1.4 || !sameAlign;
    }
    if (indented && prev.x0 - col.left < Math.max(4, line.size * 0.5)) return true;
    const prevWidth = prevCol.right - prevCol.left;
    if (prev.x1 < prevCol.right - prevWidth * 0.25) return true;
    if (prevEndsSentence && prev.x1 < prevCol.right - line.size * 3) return true;
    return false;
  }
  // Jumped to the next column or page: continue only if the sentence did.
  if (prevEndsSentence || indented) return true;
  if (firstKind === "bullet" || firstKind === "ordered") return true;
  return false;
}

/* ---------------------------------------------------------------------- */
/* Markdown rendering                                                       */
/* ---------------------------------------------------------------------- */

function renderMarkdown(blocks, opts) {
  const body = bodySize(blocks.filter((b) => b.type === "para").flatMap((b) => b.lines));

  // Heading candidates by size.
  const headingSizes = new Set();
  for (const b of blocks) {
    if (b.type !== "para") continue;
    const text = b.lines.map((l) => l.text).join(" ");
    const size = b.lines[0].size;
    const commas = (text.match(/,/g) || []).length;
    if (size >= body * 1.15 && text.length <= 200 && b.lines.length <= 3 && /\p{L}/u.test(text) && commas < 2 && !/^[\p{P}\p{S}]/u.test(text)) {
      b.headingBySize = true;
      headingSizes.add(Math.round(size * 2) / 2);
    }
  }
  const sizeRank = [...headingSizes].sort((a, b) => b - a);
  const boldLevel = Math.min(4, Math.max(2, Math.min(sizeRank.length, 3) + 1));

  const out = [];
  const figureOrder = [];
  let figN = 0;

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.type === "page") {
      out.push(`<!-- Page ${b.num} -->`);
      continue;
    }
    if (b.type === "table") {
      out.push(tableToMarkdown(b.rows));
      continue;
    }
    if (b.type === "figure") {
      figN++;
      const name = `${opts.figurePrefix}${figN}.png`;
      // Use a nearby "Figure N: …" caption as alt text.
      let caption = "";
      const isCaption = (nb) => nb && nb.type === "para" && FIGURE_CAPTION_RE.test(nb.lines[0].text);
      const captionText = (nb) => nb.lines.map((l) => l.text).reduce(joinText, "");
      for (let k = bi + 1; k <= bi + 3 && k < blocks.length; k++) {
        const nb = blocks[k];
        if (isCaption(nb)) {
          caption = captionText(nb);
          break;
        }
        // Only skip over short leftovers (e.g. stray axis labels).
        if (nb.type !== "para" || nb.lines.length > 2) break;
      }
      if (!caption && isCaption(blocks[bi - 1])) caption = captionText(blocks[bi - 1]);
      let alt = (caption || `Figure ${figN}`).replace(/[[\]]/g, "");
      if (alt.length > 120) alt = alt.slice(0, 120).replace(/\s+\S*$/, "") + "…";
      figureOrder.push({ entry: b.entry, name, caption });
      out.push(`![${alt}](figures/${name})`);
      continue;
    }

    // Paragraph-like blocks.
    const text = b.lines.map((l) => l.text).reduce(joinText, "");
    const md = b.lines.map((l) => l.md).reduce(joinText, "");
    const first = b.lines[0];
    const kind = lineKind(first);

    if (b.headingBySize && kind !== "caption") {
      const rank = sizeRank.indexOf(Math.round(first.size * 2) / 2);
      const level = Math.min(4, rank + 1 + numberingDepth(text));
      out.push("#".repeat(level) + " " + escapeMd(text));
      continue;
    }
    if (isBoldHeading(b, text, first, body) && kind !== "caption") {
      const level = Math.min(6, boldLevel + numberingDepth(text));
      out.push("#".repeat(level) + " " + escapeMd(text));
      continue;
    }
    if (kind === "bullet") {
      const m = md.match(/^(?:\\\*|[•●▪◦■□➢►▸‣⁃∙·–—-])\s*([\s\S]*)$/);
      out.push("- " + (m ? m[1] : escapeMd(text.match(BULLET_RE)[1])));
      continue;
    }
    if (kind === "ordered") {
      const m = text.match(ORDERED_RE);
      const marker = m[1].replace(/[()]/g, "");
      const rest = md.startsWith(m[1]) ? md.slice(m[1].length).trim() : escapeMd(m[3]);
      if (/^\d+[.)]$/.test(marker)) out.push(marker.replace(")", ".") + " " + rest);
      else out.push("- " + m[1] + " " + rest); // (a), b) … keep the label
      continue;
    }
    let para = escapeLineStart(md);
    if (first.bold && !b.headingBySize) para = wrapStyle(para, true, false);
    else if (first.italic && kind !== "caption") para = wrapStyle(para, false, true);
    if (kind === "caption") para = para.replace(/^((?:\*\*)?(?:fig(?:ure)?\.?|table)\s*~?(?:\d+|[ivxlc]+)\s*[.:|—–-])/i, (m) => (m.startsWith("**") ? m : "**" + m + "**"));
    out.push(para);
  }

  // Keep list items together (single newline between consecutive items).
  let markdown = "";
  for (let i = 0; i < out.length; i++) {
    const isItem = /^(- |\d+\. )/.test(out[i]);
    const prevItem = i > 0 && /^(- |\d+\. )/.test(out[i - 1]);
    markdown += i === 0 ? out[i] : (isItem && prevItem ? "\n" : "\n\n") + out[i];
  }
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { markdown, figureOrder };
}

function numberingDepth(text) {
  const m = text.match(/^(\d+(?:\.\d+)+)\.?\s/);
  return m ? m[1].split(".").length - 1 : 0;
}

function isBoldHeading(b, text, first, body) {
  if (b.lines.length > 2 || text.length > 110 || !/\p{L}/u.test(text)) return false;
  if (/[,;]$/.test(text) || (text.match(/,/g) || []).length >= 2) return false;
  const numbered = /^((\d+(\.\d+)*|[IVX]+)\.?)\s+\p{Lu}/u.test(text);
  const allCaps = text.length <= 70 && text === text.toUpperCase() && /\p{Lu}{3,}/u.test(text);
  if (first.bold && (!/[.]$/.test(text) || numbered) && first.size >= body * 0.95) return true;
  if (allCaps && (numbered || first.bold || text.split(/\s+/).length <= 6) && !/[.]$/.test(text)) return true;
  return false;
}
