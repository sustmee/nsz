/* ==========================================================================
   Handwritten Notes → Text — page logic
   ========================================================================== */

import { parse, renderBlocksHTML, figureNumbers, parsePageRef, walkBlocks, withoutTitleHeading } from "./md.js";
import { pagesFromImage, pagesFromPdf, pageFromCanvas, renderPage, rotated, pageJpeg, bytesToBase64, cropFigure, canvasToBlob, editBox, newCanvas } from "./pages.js";
import { readPage, chatPrompt, tidy } from "./ai.js";
import { buildDocx } from "./docx.js";
import { buildLatex } from "./latex.js";
import { imagesToPdf } from "./scanpdf.js";
import { samplePage, SAMPLE_TEXT } from "./sample.js";

const { toast, downloadBlob, friendlyError } = window.NSZ;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const narrow = () => window.matchMedia("(max-width: 900px)").matches;

const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) { /* private mode */ } },
  del(k, session) { try { (session ? sessionStorage : localStorage).removeItem(k); } catch (e) { /* ignore */ } },
};

/* ---------- State ---------- */

const pages = [];
let writingStyle = "exact";
let reading = null; // { controller, indices, pos }
const pageStatus = new Map(); // page.id → "reading" | "done" | "failed"
const pageText = new Map(); // page.id → last text read
const usage = { input: 0, output: 0, pages: 0 };

const editor = $("editor");
const preview = $("preview");

/* ---------- Pages ---------- */

async function addFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  let added = 0;
  for (const file of files) {
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      let got;
      if (isPdf) {
        toast(`Opening ${file.name}…`);
        got = await pagesFromPdf(file);
        if (got.truncated) toast(`Only the first 60 of ${got.truncated} PDF pages were added.`, "error");
      } else {
        got = await pagesFromImage(file);
      }
      for (const p of got) {
        renderPage(p);
        pages.push(p);
        added++;
        refreshPages();
        await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
      }
    } catch (err) {
      toast(friendlyError(err, `Couldn't open ${file.name}.`), "error");
    }
  }
  if (added) {
    toast(`${added} page${added > 1 ? "s" : ""} added.`);
    refreshPages();
    renderPreview();
  }
}

const ICON = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  crop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
};

function refreshPages() {
  const grid = $("page-grid");
  $("pages-wrap").hidden = !pages.length;
  $("pages-count").textContent = `${pages.length} page${pages.length === 1 ? "" : "s"}`;
  const busy = !!reading;
  const canRead = !!apiKey() && !busy;
  grid.innerHTML = pages
    .map((p, i) => {
      const st = pageStatus.get(p.id) || "";
      const label = st === "reading" ? "Reading…" : st === "done" ? "Read ✓" : st === "failed" ? "Not read" : "";
      return `<div class="hn-page ${st}" data-id="${p.id}">
        <div class="hn-page-img" data-act="view" title="View larger"><img src="${p.thumb}" alt="Page ${i + 1}"><span class="hn-page-no">${i + 1}</span>${label ? `<span class="hn-page-state">${label}</span>` : ""}</div>
        <div class="hn-page-tools">
          <button type="button" data-act="left" title="Move earlier" aria-label="Move page ${i + 1} earlier" ${i === 0 || busy ? "disabled" : ""}>${ICON.left}</button>
          <button type="button" data-act="rotate" title="Rotate" aria-label="Rotate page ${i + 1}" ${busy ? "disabled" : ""}>${ICON.rotate}</button>
          <button type="button" data-act="crop" title="Crop" aria-label="Crop page ${i + 1}" ${busy ? "disabled" : ""}>${ICON.crop}</button>
          <select data-act="mode" aria-label="Clean-up for page ${i + 1}" ${busy ? "disabled" : ""}>
            <option value="enhance"${p.mode === "enhance" ? " selected" : ""}>Clean</option>
            <option value="bw"${p.mode === "bw" ? " selected" : ""}>B&amp;W</option>
            <option value="original"${p.mode === "original" ? " selected" : ""}>Original</option>
          </select>
          ${canRead ? `<button type="button" data-act="read" title="Read this page (again)" aria-label="Read page ${i + 1}">${ICON.read}</button>` : ""}
          <button type="button" data-act="right" title="Move later" aria-label="Move page ${i + 1} later" ${i === pages.length - 1 || busy ? "disabled" : ""}>${ICON.right}</button>
          <button type="button" data-act="delete" title="Remove" aria-label="Remove page ${i + 1}" ${busy ? "disabled" : ""}>${ICON.trash}</button>
        </div>
      </div>`;
    })
    .join("");
  updateButtons();
}

function updateButtons() {
  const n = pages.length;
  const btn = $("btn-read");
  btn.disabled = !n || !apiKey() || !!reading;
  const pending = pages.filter((p) => pageStatus.get(p.id) !== "done").length;
  const label = btn.querySelector("span");
  if (!n) label.textContent = "Read the pages";
  else if (pending && pending < n) label.textContent = `Read the remaining ${pending} page${pending > 1 ? "s" : ""}`;
  else label.textContent = `Read ${n} page${n > 1 ? "s" : ""}`;
  btn.title = !n ? "Add pages first (step 1)" : !apiKey() ? "Enter your API key first" : "";
  $("btn-pages-zip").disabled = !n;
  $("btn-scan-pdf").disabled = !n;
}

$("page-grid").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.tagName === "SELECT") return;
  const card = btn.closest(".hn-page");
  const i = pages.findIndex((p) => String(p.id) === card.dataset.id);
  if (i < 0) return;
  const p = pages[i];
  const act = btn.dataset.act;
  if (act === "left" || act === "right") {
    const j = act === "left" ? i - 1 : i + 1;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    refreshPages();
    renderPreview();
  } else if (act === "rotate") {
    p.rotation = (p.rotation + 90) % 360;
    const [x0, y0, x1, y1] = p.crop;
    p.crop = [1 - y1, x0, 1 - y0, x1];
    renderPage(p);
    refreshPages();
    renderPreview();
  } else if (act === "crop") {
    const box = await editBox({
      canvas: rotated(p),
      box: p.crop,
      title: `Crop page ${i + 1}`,
      hint: "Drag the corners to the edges of the paper. Everything outside is removed.",
      extra: '<button class="btn btn-sm" type="button" data-box="0,0,1,1">Whole image</button>',
    });
    if (box) {
      p.crop = box;
      renderPage(p);
      refreshPages();
      renderPreview();
    }
  } else if (act === "delete") {
    pages.splice(i, 1);
    pageStatus.delete(p.id);
    refreshPages();
    renderPreview();
  } else if (act === "view") {
    viewPage(p, i);
  } else if (act === "read") {
    runReading([i]);
  }
});

$("page-grid").addEventListener("change", (e) => {
  if (e.target.dataset.act !== "mode") return;
  const card = e.target.closest(".hn-page");
  const p = pages.find((x) => String(x.id) === card.dataset.id);
  if (!p) return;
  p.mode = e.target.value;
  renderPage(p);
  refreshPages();
  renderPreview();
});

document.querySelectorAll("[data-all-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-all-mode]").forEach((x) => x.classList.toggle("active", x === b));
    for (const p of pages) { p.mode = b.dataset.allMode; renderPage(p); }
    refreshPages();
    renderPreview();
  })
);

$("btn-clear-pages").addEventListener("click", () => {
  if (!pages.length || !confirm("Remove all pages? Your text in the editor stays.")) return;
  pages.length = 0;
  pageStatus.clear();
  refreshPages();
  renderPreview();
});

function viewPage(p, i) {
  const wrap = document.createElement("div");
  wrap.className = "hn-modal";
  const before = (() => {
    const r = rotated(p);
    const [x0, y0, x1, y1] = p.crop;
    const c = newCanvas((x1 - x0) * r.width, (y1 - y0) * r.height);
    c.getContext("2d").drawImage(r, x0 * r.width, y0 * r.height, c.width, c.height, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  })();
  const after = p.out.toDataURL("image/jpeg", 0.85);
  wrap.innerHTML = `<div class="hn-modal-card" role="dialog" aria-modal="true" aria-label="Page ${i + 1}">
    <div class="hn-modal-head"><div><h3>Page ${i + 1}</h3><p>${esc(p.name)}</p></div><button class="icon-btn hn-close" type="button" aria-label="Close">✕</button></div>
    <div class="hn-stage"><img class="hn-viewer-img" src="${after}" alt="Page ${i + 1}"></div>
    <div class="hn-modal-foot"><div class="hn-seg"><button type="button" data-v="before">Before</button><button type="button" data-v="after" class="active">After clean-up</button></div><span class="spacer"></span><button class="btn hn-close2" type="button">Close</button></div>
  </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("hn-noscroll");
  const img = wrap.querySelector("img");
  const close = () => { wrap.remove(); document.body.classList.remove("hn-noscroll"); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || e.target.closest(".hn-close, .hn-close2")) close();
    const v = e.target.closest("[data-v]");
    if (v) {
      img.src = v.dataset.v === "before" ? before : after;
      wrap.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("active", x === v));
    }
  });
}

$("file-input").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
$("camera-input").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
const drop = $("drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, () => drop.classList.add("dragging")));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("dragging")));
document.addEventListener("paste", (e) => {
  if (e.target.closest && e.target.closest("textarea, input")) return;
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); addFiles(files); }
});

/* ---------- Clean scan PDF & pages ZIP ---------- */

function baseName() {
  const t = $("doc-title").value.trim();
  const safe = t.replace(/[\u2010-\u2015]/g, "-").replace(/[^A-Za-z0-9\s._-]+/g, "").trim().replace(/\s+/g, "_").replace(/_?-_?/g, "-");
  return safe.replace(/^[-_.]+|[-_.]+$/g, "").slice(0, 60) || "notes"; // ASCII only: some browsers drop non-Latin file names
}

$("btn-scan-pdf").addEventListener("click", async () => {
  if (!pages.length) return;
  try {
    const list = [];
    for (const p of pages) {
      const j = await pageJpeg(p, 2200, 0.85);
      list.push({ jpeg: j.bytes, w: j.w, h: j.h });
    }
    downloadBlob(imagesToPdf(list, $("doc-paper").value, $("doc-title").value || "Notes"), `${baseName()}_scan.pdf`);
  } catch (err) {
    toast(friendlyError(err, "Couldn't make the PDF."), "error");
  }
});

$("btn-pages-zip").addEventListener("click", async () => {
  if (!pages.length || !window.JSZip) return;
  const zip = new window.JSZip();
  for (let i = 0; i < pages.length; i++) {
    const j = await pageJpeg(pages[i], 2000, 0.86);
    zip.file(`page-${String(i + 1).padStart(2, "0")}.jpg`, j.bytes);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${baseName()}_pages.zip`);
});

/* ---------- Reading options ---------- */

document.querySelectorAll("[data-style]").forEach((b) =>
  b.addEventListener("click", () => {
    writingStyle = b.dataset.style;
    document.querySelectorAll("[data-style]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-checked", String(x === b));
    });
  })
);
const readOpts = () => ({ style: writingStyle, flagErrors: $("opt-check").checked, careful: $("opt-careful").checked });

/* ---------- API key ---------- */

const KEY = "nsz-claude-key";
const apiKey = () => $("api-key").value.trim();
(function initKey() {
  const saved = store.get(KEY);
  const session = store.get(KEY, true);
  if (saved) { $("api-key").value = saved; $("remember-key").checked = true; }
  else if (session) $("api-key").value = session;
})();
function saveKey() {
  const k = apiKey();
  if (k) store.set(KEY, k, true); else store.del(KEY, true);
  if ($("remember-key").checked && k) store.set(KEY, k); else store.del(KEY);
}
$("api-key").addEventListener("input", () => { saveKey(); refreshPages(); });
$("remember-key").addEventListener("change", saveKey);
$("key-eye").addEventListener("click", () => {
  const inp = $("api-key");
  inp.type = inp.type === "password" ? "text" : "password";
});

/* ---------- Reading with Claude ---------- */

const PAGE_RE = /<!--\s*page\s+(\d+)\s*-->/gi;

/** Replaces (or inserts in order) the section of the editor that belongs to page n. */
function upsertSection(n, text) {
  const src = editor.value;
  const marks = [];
  let m;
  PAGE_RE.lastIndex = 0;
  while ((m = PAGE_RE.exec(src))) marks.push({ n: +m[1], at: m.index });
  const block = `<!-- page ${n} -->\n\n${text.trim()}\n`;
  const idx = marks.findIndex((k) => k.n === n);
  let next;
  if (idx >= 0) {
    const end = idx + 1 < marks.length ? marks[idx + 1].at : src.length;
    next = src.slice(0, marks[idx].at) + block + (idx + 1 < marks.length ? "\n" : "") + src.slice(end);
  } else {
    const after = marks.find((k) => k.n > n);
    if (after) next = src.slice(0, after.at) + block + "\n" + src.slice(after.at);
    else next = (src.trim() ? src.replace(/\s*$/, "\n\n") : "") + block;
  }
  editor.value = next;
  editorChanged(true);
}

function setReadUi(on) {
  $("btn-stop").hidden = !on;
  $("read-status").hidden = false;
  refreshPages();
}

async function runReading(indices) {
  if (reading) return;
  const key = apiKey();
  if (!key) { toast("Enter your Claude API key first.", "error"); $("api-key").focus(); return; }
  if (!indices.length) return;
  const fresh = indices.length === pages.length && !pages.some((p) => pageStatus.get(p.id) === "done");
  if (fresh && editor.value.trim()) {
    if (confirm("Replace the text in the editor with the pages you're about to read?\n\nOK = replace · Cancel = keep it (pages are added or updated by their page number)")) editor.value = "";
  }
  const controller = new AbortController();
  reading = { controller };
  setReadUi(true);
  const bar = $("read-bar");
  const msg = $("read-msg");
  const live = $("read-live");
  let done = 0;
  let failedAt = -1;
  const t0 = Date.now();
  for (const i of indices) {
    const p = pages[i];
    if (!p) continue;
    pageStatus.set(p.id, "reading");
    refreshPages();
    msg.textContent = `Reading page ${i + 1} of ${pages.length}…`;
    bar.style.width = `${Math.max(4, (done / indices.length) * 100)}%`;
    live.textContent = "";
    try {
      const jpg = await pageJpeg(p);
      const prev = i > 0 ? pageText.get(pages[i - 1].id) : "";
      const res = await readPage({
        apiKey: key,
        jpegBase64: bytesToBase64(jpg.bytes),
        pageNo: i + 1,
        pageCount: pages.length,
        prevTail: prev ? prev.slice(-600) : "",
        opts: readOpts(),
        signal: controller.signal,
        onText: (t) => {
          live.textContent = t.length > 1800 ? "…" + t.slice(-1800) : t;
          live.scrollTop = live.scrollHeight;
        },
      });
      pageText.set(p.id, res.text);
      pageStatus.set(p.id, "done");
      if (res.usage) {
        usage.input += res.usage.input_tokens || 0;
        usage.output += res.usage.output_tokens || 0;
        usage.pages++;
      }
      upsertSection(i + 1, res.text + (res.stopReason === "max_tokens" ? "\n\n[?the rest of this page was cut off — read it again?]" : ""));
      done++;
    } catch (err) {
      pageStatus.set(p.id, "failed");
      if (err.aborted) { msg.textContent = `Stopped. ${done} page${done === 1 ? "" : "s"} read.`; failedAt = i; break; }
      if (err.partial) upsertSection(i + 1, err.partial + "\n\n[?reading stopped here?]");
      msg.textContent = `Page ${i + 1}: ${err.message}`;
      toast(err.message, "error");
      failedAt = i;
      break;
    }
  }
  reading = null;
  $("btn-stop").hidden = true;
  bar.style.width = failedAt >= 0 ? bar.style.width : "100%";
  if (failedAt < 0) {
    const cost = (usage.input * 4 + usage.output * 20) / 1e6;
    msg.textContent = `Done — ${done} page${done === 1 ? "" : "s"} read in ${Math.round((Date.now() - t0) / 1000)} s. Check the highlighted words below.${usage.pages ? ` (Usage so far ≈ US$${cost.toFixed(cost < 0.1 ? 3 : 2)}.)` : ""}`;
    live.textContent = "";
    setView(narrow() ? "preview" : "split");
    $("sec-edit").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  refreshPages();
}

$("btn-read").addEventListener("click", () => {
  const pending = pages.map((p, i) => (pageStatus.get(p.id) === "done" ? -1 : i)).filter((i) => i >= 0);
  runReading(pending.length ? pending : pages.map((_, i) => i));
});
$("btn-stop").addEventListener("click", () => { if (reading) reading.controller.abort(); });

/* ---------- Free route ---------- */

$("btn-copy-prompt").addEventListener("click", async () => {
  const text = chatPrompt(readOpts(), Math.max(1, pages.length));
  try {
    await navigator.clipboard.writeText(text);
    toast("Instructions copied — paste them into the chat with your pages.");
  } catch (e) {
    showTextModal("Copy these instructions", text);
  }
});

function showTextModal(title, text) {
  const wrap = document.createElement("div");
  wrap.className = "hn-modal";
  wrap.innerHTML = `<div class="hn-modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="hn-modal-head"><div><h3>${esc(title)}</h3><p>Select all and copy.</p></div><button class="icon-btn hn-close" type="button" aria-label="Close">✕</button></div><div class="hn-stage" style="place-items:stretch"><textarea class="hn-editor" style="height:50vh;min-height:0" readonly></textarea></div><div class="hn-modal-foot"><span class="spacer"></span><button class="btn hn-close" type="button">Close</button></div></div>`;
  wrap.querySelector("textarea").value = text;
  document.body.appendChild(wrap);
  wrap.querySelector("textarea").select();
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest(".hn-close")) wrap.remove(); });
}

function insertReply(raw) {
  let text = tidy(raw);
  if (!text) return;
  if (!/<!--\s*page\s+\d+\s*-->/i.test(text) && pages.length <= 1) text = `<!-- page 1 -->\n\n${text}`;
  if (editor.value.trim()) {
    if (confirm("Replace the text in the editor with this reply?\n\nOK = replace · Cancel = add it at the end")) editor.value = text + "\n";
    else editor.value = editor.value.replace(/\s*$/, "\n\n") + text + "\n";
  } else editor.value = text + "\n";
  editorChanged(true);
  setView(narrow() ? "preview" : "split");
  $("sec-edit").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Reply added — check the highlighted words.");
}

$("btn-paste-reply").addEventListener("click", async () => {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error("no clipboard");
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error("empty");
    insertReply(text);
  } catch (e) {
    setView("edit");
    editor.focus();
    $("sec-edit").scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Paste the reply into the editor (Ctrl+V, or long-press → Paste).");
  }
});

/* ---------- Figures (crops of the pages) ---------- */

const figCache = new Map();
function figureCanvas(src) {
  const ref = parsePageRef(src);
  if (!ref) return null;
  const p = pages[ref.page - 1];
  if (!p || !p.out) return null;
  return cropFigure(p, ref.box);
}
function imageUrl(src) {
  if (!/^page:/i.test(src)) return /^(https?:|data:image\/)/i.test(src) ? src : null;
  const ref = parsePageRef(src);
  const p = ref && pages[ref.page - 1];
  if (!p) return null;
  const key = `${src}|${p.id}|${p.version}`;
  if (!figCache.has(key)) {
    const c = figureCanvas(src);
    figCache.set(key, c ? c.toDataURL("image/jpeg", 0.9) : null);
  }
  return figCache.get(key);
}
async function imageBytes(src) {
  const c = figureCanvas(src);
  if (!c) return null;
  const blob = await canvasToBlob(c, "image/png");
  return { data: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, ext: "png" };
}

async function pickFigure({ pageIndex, box, replaceSrc } = {}) {
  if (!pages.length) { toast("Add the page photos first (step 1) — diagrams are cut out of them.", "error"); return; }
  let i = pageIndex;
  if (i == null) i = pages.length === 1 ? 0 : await choosePage();
  if (i == null || !pages[i]) return;
  const b = await editBox({
    canvas: pages[i].out,
    box: box || [0.15, 0.25, 0.85, 0.6],
    title: replaceSrc ? `Adjust the diagram (page ${i + 1})` : `Cut out a diagram (page ${i + 1})`,
    hint: "Drag a box around the diagram, including its labels.",
    okLabel: replaceSrc ? "Update" : "Insert",
  });
  if (!b) return;
  const src = `page:${i + 1}#${b.map((v) => v.toFixed(2)).join(",")}`;
  if (replaceSrc) {
    editor.value = editor.value.split(`(${replaceSrc})`).join(`(${src})`);
    editorChanged(true);
  } else {
    insertAtCursor(`\n![Figure: describe the diagram](${src})\n`, "describe the diagram");
  }
}

function choosePage() {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "hn-modal";
    wrap.innerHTML = `<div class="hn-modal-card" role="dialog" aria-modal="true" aria-label="Choose a page"><div class="hn-modal-head"><div><h3>Which page is the diagram on?</h3></div><button class="icon-btn hn-close" type="button" aria-label="Close">✕</button></div><div class="hn-chooser">${pages.map((p, i) => `<button type="button" data-i="${i}"><img src="${p.thumb}" alt="">Page ${i + 1}</button>`).join("")}</div></div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) { wrap.remove(); resolve(+b.dataset.i); }
      else if (e.target === wrap || e.target.closest(".hn-close")) { wrap.remove(); resolve(null); }
    });
  });
}

/* ---------- Editor & preview ---------- */

function insertAtCursor(text, selectWord) {
  const s = editor.selectionStart ?? editor.value.length;
  const e = editor.selectionEnd ?? s;
  editor.setRangeText(text, s, e, "end");
  if (selectWord) {
    const at = editor.value.lastIndexOf(selectWord, s + text.length);
    if (at >= s) editor.setSelectionRange(at, at + selectWord.length);
  }
  editor.focus();
  editorChanged(true);
}

function wrapSelection(before, after, placeholder) {
  const s = editor.selectionStart, e = editor.selectionEnd;
  const sel = editor.value.slice(s, e) || placeholder;
  editor.setRangeText(before + sel + after, s, e, "end");
  editor.setSelectionRange(s + before.length, s + before.length + sel.length);
  editor.focus();
  editorChanged(true);
}

function prefixLines(prefix) {
  const v = editor.value;
  const s = v.lastIndexOf("\n", editor.selectionStart - 1) + 1;
  let e = v.indexOf("\n", editor.selectionEnd);
  if (e < 0) e = v.length;
  const lines = v.slice(s, e).split("\n").map((l, k) => (typeof prefix === "function" ? prefix(k) : prefix) + l.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, ""));
  editor.setRangeText(lines.join("\n"), s, e, "end");
  editor.focus();
  editorChanged(true);
}

const INSERT = {
  bold: () => wrapSelection("**", "**", "bold text"),
  italic: () => wrapSelection("*", "*", "italic text"),
  h2: () => prefixLines("## "),
  ul: () => prefixLines("- "),
  ol: () => prefixLines((k) => `${k + 1}. `),
  math: () => wrapSelection("$", "$", "x^2"),
  dmath: () => wrapSelection("\n$$\n", "\n$$\n", "E = mc^2"),
  frac: () => wrapSelection("$\\frac{", "}{b}$", "a"),
  box: () => wrapSelection("\n> **Definition.** ", "\n", "your text"),
  table: () => insertAtCursor("\n| Quantity | Symbol | Unit |\n|---|:-:|:-:|\n| Force | $F$ | N |\n", "Quantity"),
  figure: () => pickFigure(),
};
document.querySelectorAll("[data-ins]").forEach((b) => b.addEventListener("click", () => INSERT[b.dataset.ins]()));

function setView(v) {
  if (v === "split" && narrow()) v = "preview";
  $("split").dataset.view = v;
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
}
document.querySelectorAll(".hn-view [data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

let renderTimer = 0;
let saveTimer = 0;
function editorChanged(now) {
  clearTimeout(renderTimer);
  if (now) renderPreview();
  else renderTimer = setTimeout(renderPreview, 160);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 600);
}
editor.addEventListener("input", () => editorChanged(false));

function pagePhotoUrl(n) {
  const p = pages[n - 1];
  if (!p) return null;
  const key = `photo|${p.id}|${p.version}`;
  if (!figCache.has(key)) {
    const c = newCanvas(Math.min(1000, p.out.width), (Math.min(1000, p.out.width) / p.out.width) * p.out.height);
    c.getContext("2d").drawImage(p.out, 0, 0, c.width, c.height);
    figCache.set(key, c.toDataURL("image/jpeg", 0.85));
  }
  return figCache.get(key);
}

function renderPreview() {
  const ast = parse(editor.value);
  const ctx = { imageUrl, lines: true, showUnsure: true, figNo: figureNumbers(ast), figureAttrs: (src) => (/^page:/i.test(src) ? ` data-fig="${esc(src)}" title="Click to adjust the crop"` : "") };
  let html;
  if ($("show-photos").checked && pages.length) {
    // Split at page markers and show each page's photo beside its text
    const segs = [];
    let cur = { n: null, blocks: [] };
    for (const b of ast) {
      if (b.t === "page") { if (cur.blocks.length || cur.n != null) segs.push(cur); cur = { n: b.n, blocks: [b] }; }
      else cur.blocks.push(b);
    }
    segs.push(cur);
    html = segs
      .filter((s) => s.blocks.length)
      .map((s) => {
        const url = s.n != null ? pagePhotoUrl(s.n) : null;
        const photo = url ? `<div class="hn-seg-photo"><img src="${url}" alt="Page ${s.n}" data-photo="${s.n}"></div>` : "<div></div>";
        return `<div class="hn-seg-row">${photo}<div class="hn-seg-text">${renderBlocksHTML(s.blocks, ctx)}</div></div>`;
      })
      .join("");
  } else {
    html = renderBlocksHTML(ast, ctx);
  }
  preview.innerHTML = html;
  updateStats(ast);
}
$("show-photos").addEventListener("change", () => {
  if ($("show-photos").checked && !pages.length) toast("Add the page photos in step 1 to see them here.");
  renderPreview();
});

function updateStats(ast) {
  const text = editor.value;
  const unsure = (text.match(/\[\?[^\n]*?\?\]/g) || []).length;
  $("unsure-count").textContent = unsure;
  let eq = 0, figs = 0;
  walkBlocks(ast, (b) => {
    if (b.t === "math") eq++;
    if (b.t === "figure") figs++;
  });
  eq += (text.match(/(^|[^\\$])\$[^$\n]+\$/g) || []).length;
  const words = (text.replace(/<!--[\s\S]*?-->|\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ").match(/[\p{L}\p{N}]+/gu) || []).length;
  const errors = preview.querySelectorAll(".math-error").length;
  $("stats").innerHTML = text.trim()
    ? `<b>${words}</b> words · <b>${eq}</b> equations · <b>${figs}</b> figures · <b>${unsure}</b> to check${errors ? ` · <span class="warn">${errors} equation${errors > 1 ? "s" : ""} with a LaTeX error (red — hover for details)</span>` : ""}`
    : "";
}

// Click in the preview → jump to that line in the editor; click a figure → adjust its crop
preview.addEventListener("click", (e) => {
  const fig = e.target.closest("figure[data-fig]");
  if (fig && e.target.tagName === "IMG") {
    const ref = parsePageRef(fig.dataset.fig);
    if (ref && pages[ref.page - 1]) { pickFigure({ pageIndex: ref.page - 1, box: ref.box, replaceSrc: fig.dataset.fig }); return; }
  }
  const photo = e.target.closest("[data-photo]");
  if (photo) { const n = +photo.dataset.photo; if (pages[n - 1]) viewPage(pages[n - 1], n - 1); return; }
  if (e.target.closest("a")) return;
  const el = e.target.closest("[data-line]");
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 600);
  jumpToLine(+el.dataset.line);
});

function jumpToLine(line, selectLen) {
  if ($("split").dataset.view === "preview") setView("edit");
  const lines = editor.value.split("\n");
  let at = 0;
  for (let k = 0; k < line && k < lines.length; k++) at += lines[k].length + 1;
  const end = at + (selectLen != null ? selectLen : (lines[line] || "").length);
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(at, end);
  scrollEditorTo(at);
}

function scrollEditorTo(offset) {
  const before = editor.value.slice(0, offset);
  const lineNo = before.split("\n").length - 1;
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 22;
  editor.scrollTop = Math.max(0, lineNo * lh - editor.clientHeight / 3);
  if (narrow()) editor.scrollIntoView({ block: "nearest" });
}

const UNSURE_RE = /\[\?([^\n]*?)\?\]/g;
$("btn-next-unsure").addEventListener("click", () => {
  const v = editor.value;
  UNSURE_RE.lastIndex = editor.selectionEnd || 0;
  let m = UNSURE_RE.exec(v);
  if (!m) { UNSURE_RE.lastIndex = 0; m = UNSURE_RE.exec(v); }
  if (!m) { toast("Nothing left to check. 🎉"); return; }
  if ($("split").dataset.view === "preview") setView("edit");
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(m.index, m.index + m[0].length);
  scrollEditorTo(m.index);
  toast(`Check “${m[1]}” — type the right word over it, or press Enter to keep the guess.`);
});
// Enter on a selected [?guess?] keeps the guess (removes the marker)
editor.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey) return;
  const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd);
  const m = sel.match(/^\[\?([^\n]*?)\?\]$/);
  if (!m) return;
  e.preventDefault();
  editor.setRangeText(m[1], editor.selectionStart, editor.selectionEnd, "end");
  editorChanged(true);
});

/* ---------- Draft (saved in this browser) ---------- */

const DRAFT = "nsz-hn-draft";
const FIELDS = ["doc-title", "doc-subtitle", "doc-author", "doc-date", "doc-theme", "doc-paper"];
const CHECKS = ["doc-breaks", "doc-unsure", "show-photos"];
function saveDraft() {
  const d = { text: editor.value, savedAt: Date.now(), style: writingStyle };
  FIELDS.forEach((id) => (d[id] = $(id).value));
  CHECKS.forEach((id) => (d[id] = $(id).checked));
  store.set(DRAFT, JSON.stringify(d));
}
function loadDraft() {
  let d = null;
  try { d = JSON.parse(store.get(DRAFT) || "null"); } catch (e) { d = null; }
  if (!d) return;
  FIELDS.forEach((id) => { if (d[id] != null) $(id).value = d[id]; });
  CHECKS.forEach((id) => { if (d[id] != null) $(id).checked = !!d[id]; });
  if (d.text && d.text.trim()) {
    editor.value = d.text;
    toast("Your last notes were restored from this browser.");
  }
}
[...FIELDS, ...CHECKS].forEach((id) => $(id).addEventListener("change", saveDraft));
FIELDS.forEach((id) => $(id).addEventListener("input", () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 600); }));

/* ---------- Downloads ---------- */

function docOptions() {
  return {
    title: $("doc-title").value.trim(),
    subtitle: $("doc-subtitle").value.trim(),
    author: $("doc-author").value.trim(),
    date: $("doc-date").value.trim(),
    theme: $("doc-theme").value,
    paper: $("doc-paper").value,
    pageBreaks: $("doc-breaks").checked,
    unsure: $("doc-unsure").checked ? "highlight" : "plain",
  };
}

function needText() {
  if (editor.value.trim()) return true;
  toast("There's no text yet — read your pages (step 2) or type in the editor.", "error");
  return false;
}

function missingFigures(ast) {
  let n = 0;
  walkBlocks(ast, (b) => { if (b.t === "figure" && /^page:/i.test(b.src) && !imageUrl(b.src)) n++; });
  if (n) toast(`${n} figure${n > 1 ? "s" : ""} can't be cut out because the page photos aren't loaded — add them in step 1 first.`, "error");
}

$("dl-docx").addEventListener("click", async () => {
  if (!needText()) return;
  const btn = $("dl-docx");
  btn.disabled = true;
  try {
    const ast = withoutTitleHeading(parse(editor.value), docOptions().title);
    missingFigures(ast);
    const blob = await buildDocx(ast, docOptions(), { getImage: imageBytes });
    downloadBlob(blob, `${baseName()}.docx`);
    toast("Word file ready.");
  } catch (err) {
    toast(friendlyError(err, "Couldn't make the Word file."), "error");
  } finally {
    btn.disabled = false;
  }
});

$("dl-pdf").addEventListener("click", async () => {
  if (!needText()) return;
  const o = docOptions();
  const ast = withoutTitleHeading(parse(editor.value), o.title);
  missingFigures(ast);
  const root = $("print-root");
  const head = [
    o.title ? `<h1 class="doc-title">${esc(o.title)}</h1>` : "",
    o.subtitle ? `<p class="doc-sub">${esc(o.subtitle)}</p>` : "",
    o.author || o.date ? `<p class="doc-meta">${esc([o.author, o.date].filter(Boolean).join("  ·  "))}</p>` : "",
  ].join("");
  root.className = `print-doc ${o.theme}`;
  root.innerHTML = (head ? `<header class="doc-head">${head}</header>` : "") + renderBlocksHTML(ast, { imageUrl, showUnsure: o.unsure === "highlight", pageMode: o.pageBreaks ? "break" : "none" });
  let pageStyle = document.getElementById("hn-page-style");
  if (!pageStyle) { pageStyle = document.createElement("style"); pageStyle.id = "hn-page-style"; document.head.appendChild(pageStyle); }
  const footer = o.title ? `"${o.title.replace(/["\\]/g, "")}  ·  " counter(page)` : "counter(page)";
  pageStyle.textContent = `@page { size: ${o.paper === "letter" ? "letter" : "A4"}; margin: 20mm 18mm 20mm; @bottom-center { content: ${footer}; font-size: 9pt; color: #9ca3af; } }`;
  await Promise.all(Array.from(root.querySelectorAll("img")).map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const oldTitle = document.title;
  document.title = baseName();
  const restore = () => { document.title = oldTitle; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  setTimeout(restore, 60000);
  window.print();
});

$("dl-tex").addEventListener("click", async () => {
  if (!needText() || !window.JSZip) return;
  try {
    const ast = withoutTitleHeading(parse(editor.value), docOptions().title);
    missingFigures(ast);
    const zip = new window.JSZip();
    const nums = figureNumbers(ast);
    const files = new Map();
    for (const [b, n] of nums) {
      const img = await imageBytes(b.src);
      if (img) { const name = `figures/fig${n}.png`; zip.file(name, img.data); files.set(b, name); }
    }
    const tex = buildLatex(ast, { ...docOptions(), figureFile: (b) => files.get(b) || null });
    zip.file("main.tex", tex);
    downloadBlob(await zip.generateAsync({ type: "blob" }), `${baseName()}_latex.zip`);
    toast("LaTeX project ready — upload the .zip to Overleaf (New Project → Upload Project).");
  } catch (err) {
    toast(friendlyError(err, "Couldn't make the LaTeX file."), "error");
  }
});

$("dl-md").addEventListener("click", async () => {
  if (!needText()) return;
  try {
    const ast = parse(editor.value);
    const keep = $("doc-unsure").checked;
    let md = editor.value;
    if (!keep) md = md.replace(UNSURE_RE, "$1");
    const nums = figureNumbers(ast);
    const zip = window.JSZip ? new window.JSZip() : null;
    let figs = 0;
    for (const [b, n] of nums) {
      if (!/^page:/i.test(b.src) || !zip) continue;
      const img = await imageBytes(b.src);
      if (!img) continue;
      zip.file(`figures/fig${n}.png`, img.data);
      md = md.split(`(${b.src})`).join(`(figures/fig${n}.png)`);
      figs++;
    }
    const o = docOptions();
    if (o.title && !/^\s*#\s/.test(md.replace(/<!--[\s\S]*?-->/g, "").trimStart())) md = `# ${o.title}\n\n${o.subtitle ? `*${o.subtitle}*\n\n` : ""}${md}`;
    if (figs) {
      zip.file(`${baseName()}.md`, md);
      downloadBlob(await zip.generateAsync({ type: "blob" }), `${baseName()}_markdown.zip`);
    } else {
      downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${baseName()}.md`);
    }
  } catch (err) {
    toast(friendlyError(err, "Couldn't make the Markdown file."), "error");
  }
});

/* ---------- Sample ---------- */

$("btn-sample").addEventListener("click", async () => {
  if (editor.value.trim() && !confirm("Load the sample? It replaces the text in the editor.")) return;
  const btn = $("btn-sample");
  btn.disabled = true;
  try {
    const canvas = await samplePage();
    const p = pageFromCanvas(canvas, "sample-notes.jpg");
    renderPage(p);
    pages.length = 0;
    pageStatus.clear();
    pages.push(p);
    pageStatus.set(p.id, "done");
    editor.value = SAMPLE_TEXT;
    if (!$("doc-title").value) $("doc-title").value = "Lecture 4 — Projectile Motion";
    if (!$("doc-subtitle").value) $("doc-subtitle").value = "PHY 101 · Sample notes";
    refreshPages();
    editorChanged(true);
    setView(narrow() ? "preview" : "split");
    toast("Sample loaded. This text is pre-made — with your API key, pages are read for real.");
  } catch (err) {
    toast(friendlyError(err, "Couldn't load the sample."), "error");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Start ---------- */

function start() {
  loadDraft();
  setView(narrow() ? "edit" : "split");
  if (editor.value.trim() && narrow()) setView("preview");
  refreshPages();
  const go = () => renderPreview();
  if (window.katex) go();
  else window.addEventListener("load", go);
  window.NSZ.ready();
}
start();
