/* PDF / Word → Markdown — page controller (upload, progress, results, downloads). */

const { toast, downloadBlob, formatBytes } = window.NSZ;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const els = {
  input: $("#file-input"),
  dropzone: $("#dropzone"),
  uploadView: $("#upload-view"),
  progressView: $("#progress-view"),
  resultView: $("#result-view"),
  pType: $("#p-type"),
  pName: $("#p-name"),
  pSize: $("#p-size"),
  pBar: $("#p-bar"),
  pStatus: $("#p-status"),
  rName: $("#r-name"),
  rStats: $("#r-stats"),
  rWarnings: $("#r-warnings"),
  preview: $("#preview"),
  editor: $("#md-editor"),
  figGrid: $("#figure-grid"),
  figCount: $("#fig-count"),
  zipTree: $("#zip-tree"),
  prefix: $("#opt-prefix"),
};

const MAX_SIZE = 150 * 1024 * 1024;

let state = null; // { baseName, markdown, figures, pages, urls: Map }

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function setStep(n) {
  $$(".step").forEach((s) => {
    const k = Number(s.dataset.step);
    s.classList.toggle("active", k === n);
    s.classList.toggle("done", k < n);
  });
}

function show(view) {
  els.uploadView.hidden = view !== "upload";
  els.progressView.hidden = view !== "progress";
  els.resultView.hidden = view !== "result";
}

function setProgress(fraction, message) {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  els.pBar.style.width = pct + "%";
  els.pBar.parentElement.setAttribute("aria-valuenow", String(pct));
  if (message) els.pStatus.textContent = message;
}

function safeBaseName(filename) {
  const base = filename.replace(/\.[^.]+$/, "").trim() || "document";
  return base.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function sanitizePrefix(v) {
  const clean = (v || "").trim().replace(/[^\w.-]+/g, "_");
  return clean || "fig";
}

function fileKind(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".doc")) return "doc";
  return null;
}

function readOptions() {
  return {
    figurePrefix: sanitizePrefix(els.prefix.value),
    minFigureSize: Math.max(0, Number($("#opt-minsize").value) || 0),
    vectorFigures: $("#opt-vector").checked,
    removeHeadersFooters: $("#opt-headers").checked,
    detectTables: $("#opt-tables").checked,
    pageMarkers: $("#opt-markers").checked,
    pageSnapshots: $("#opt-snapshots").checked,
  };
}

function yieldToBrowser() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ---------------------------------------------------------------------- */
/* Conversion                                                              */
/* ---------------------------------------------------------------------- */

async function handleFile(file) {
  if (!file) return;
  const kind = fileKind(file);
  if (kind === "doc") {
    toast("Old .doc files aren't supported. In Word, use File → Save As → .docx, then try again.", "error");
    return;
  }
  if (!kind) {
    toast("Please choose a PDF or Word (.docx) file.", "error");
    return;
  }
  if (file.size > MAX_SIZE) {
    toast(`That file is ${formatBytes(file.size)} — please use a file under ${formatBytes(MAX_SIZE)}.`, "error");
    return;
  }

  const options = readOptions();
  els.pType.textContent = kind.toUpperCase();
  els.pType.className = "ftype " + kind;
  els.pName.textContent = file.name;
  els.pSize.textContent = formatBytes(file.size);
  setProgress(0, "Loading file…");
  show("progress");
  setStep(2);
  await yieldToBrowser();

  const started = performance.now();
  try {
    const buffer = await file.arrayBuffer();
    let result;
    const onProgress = (f, msg) => setProgress(f, msg);
    if (kind === "pdf") {
      setProgress(0.02, "Loading PDF engine…");
      const { convertPdf } = await import("./pdf-to-md.js");
      result = await convertPdf(buffer, options, onProgress);
    } else {
      const { convertDocx } = await import("./docx-to-md.js");
      result = await convertDocx(buffer, options, onProgress);
    }
    result.seconds = (performance.now() - started) / 1000;
    showResult(file, kind, result);
  } catch (err) {
    console.error(err);
    toast(err && err.message ? err.message : "Something went wrong while converting this file.", "error");
    reset();
  }
}

/* ---------------------------------------------------------------------- */
/* Results                                                                 */
/* ---------------------------------------------------------------------- */

function releaseUrls() {
  if (state && state.urls) state.urls.forEach((u) => URL.revokeObjectURL(u));
}

function showResult(file, kind, result) {
  releaseUrls();
  const urls = new Map();
  for (const f of result.figures) urls.set("figures/" + f.name, URL.createObjectURL(f.blob));

  state = {
    baseName: safeBaseName(file.name),
    kind,
    markdown: result.markdown,
    figures: result.figures,
    pages: result.pages || [],
    urls,
  };

  els.rName.textContent = file.name;
  const stats = [];
  if (result.stats.pages) stats.push(["pages", result.stats.pages]);
  stats.push(["words", result.stats.words.toLocaleString()]);
  stats.push(["figures", result.stats.figures]);
  if (state.pages.length) stats.push(["page images", state.pages.length]);
  stats.push(["seconds", result.seconds.toFixed(1)]);
  els.rStats.innerHTML = stats.map(([k, v]) => `<span class="stat"><b>${escapeHtml(v)}</b> ${k}</span>`).join("");

  els.rWarnings.innerHTML = (result.warnings || [])
    .map((w) => `<div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>${escapeHtml(w)}</span></div>`)
    .join("");

  els.editor.value = state.markdown;
  els.figCount.textContent = state.figures.length;
  renderPreview();
  renderFigures();
  renderZipTree();
  selectTab("preview");

  setProgress(1, "Done");
  show("result");
  setStep(3);
  els.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
  toast(`Converted! ${state.figures.length} figure${state.figures.length === 1 ? "" : "s"} extracted.`);
}

function renderPreview() {
  const md = els.editor.value;
  let html = window.marked ? window.marked.parse(md, { gfm: true, breaks: false }) : `<pre>${escapeHtml(md)}</pre>`;
  html = window.DOMPurify ? window.DOMPurify.sanitize(html) : escapeHtml(md);
  els.preview.innerHTML = html;
  els.preview.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (state.urls.has(src)) img.src = state.urls.get(src);
    img.loading = "lazy";
  });
  els.preview.querySelectorAll("a[href]").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  if (!md.trim()) els.preview.innerHTML = '<p class="hint">No text was found in this document.</p>';
}

function renderFigures() {
  if (!state.figures.length) {
    els.figGrid.innerHTML = `<div class="empty-figs">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
      <p>No figures were found in this document.</p></div>`;
    return;
  }
  els.figGrid.innerHTML = state.figures
    .map((f, i) => {
      const url = state.urls.get("figures/" + f.name);
      const dims = f.width ? `${f.width} × ${f.height}px` : "original format";
      const thumb = f.original
        ? `<div class="fig-noimg">${escapeHtml(f.name.split(".").pop().toUpperCase())}</div>`
        : `<img src="${url}" alt="${escapeHtml(f.caption || f.name)}" loading="lazy">`;
      return `<figure class="fig-card" style="animation-delay:${Math.min(i, 12) * 40}ms">
        <div class="fig-thumb">${thumb}</div>
        <figcaption>
          <div><strong>${escapeHtml(f.name)}</strong><small>${dims} · ${formatBytes(f.blob.size)}</small></div>
          <button class="icon-btn fig-dl" type="button" data-index="${i}" aria-label="Download ${escapeHtml(f.name)}" title="Download ${escapeHtml(f.name)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          </button>
        </figcaption>
      </figure>`;
    })
    .join("");
  els.figGrid.querySelectorAll(".fig-dl").forEach((btn) =>
    btn.addEventListener("click", () => {
      const f = state.figures[Number(btn.dataset.index)];
      downloadBlob(f.blob, f.name);
    })
  );
}

function renderZipTree() {
  const b = state.baseName;
  const lines = [`${b}.zip`, `└── ${b}/`];
  const children = [`${b}.md`];
  if (state.figures.length) children.push("figures/");
  if (state.pages.length) children.push("pages/");
  children.forEach((c, i) => {
    const last = i === children.length - 1;
    lines.push(`    ${last ? "└──" : "├──"} ${c}`);
    const sub = c === "figures/" ? state.figures.map((f) => f.name) : c === "pages/" ? state.pages.map((p) => p.name) : [];
    const shown = sub.length > 12 ? [...sub.slice(0, 10), `… ${sub.length - 10} more`] : sub;
    shown.forEach((s, j) => lines.push(`    ${last ? "    " : "│   "}${j === shown.length - 1 ? "└──" : "├──"} ${s}`));
  });
  els.zipTree.textContent = lines.join("\n");
}

function selectTab(name) {
  $$(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  if (name === "preview" && state) renderPreview();
}

async function downloadZip() {
  if (!state) return;
  if (!window.JSZip) {
    toast("ZIP library failed to load. Please refresh the page.", "error");
    return;
  }
  const btn = $("#btn-zip");
  btn.disabled = true;
  try {
    const zip = new window.JSZip();
    const root = zip.folder(state.baseName);
    root.file(`${state.baseName}.md`, els.editor.value);
    if (state.figures.length) {
      const figs = root.folder("figures");
      state.figures.forEach((f) => figs.file(f.name, f.blob));
    }
    if (state.pages.length) {
      const pages = root.folder("pages");
      state.pages.forEach((p) => pages.file(p.name, p.blob));
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    downloadBlob(blob, `${state.baseName}.zip`);
    toast("ZIP downloaded");
  } catch (e) {
    console.error(e);
    toast("Could not create the ZIP file.", "error");
  } finally {
    btn.disabled = false;
  }
}

function reset() {
  els.input.value = "";
  show("upload");
  setStep(1);
}

/* ---------------------------------------------------------------------- */
/* Events                                                                  */
/* ---------------------------------------------------------------------- */

els.input.addEventListener("change", () => handleFile(els.input.files[0]));

["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragging");
  })
);
["dragleave", "dragend", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev !== "dragleave" || !els.dropzone.contains(e.relatedTarget)) els.dropzone.classList.remove("dragging");
  })
);
els.dropzone.addEventListener("drop", (e) => {
  e.stopPropagation();
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(file);
});
// Dropping a file anywhere else on the page shouldn't navigate away.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!els.uploadView.hidden && e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

els.prefix.addEventListener("input", () => {
  const p = sanitizePrefix(els.prefix.value);
  $$(".prefix-preview").forEach((b) => (b.textContent = p));
});

$$(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
$("#btn-zip").addEventListener("click", downloadZip);
$("#btn-md").addEventListener("click", () => {
  if (!state) return;
  downloadBlob(new Blob([els.editor.value], { type: "text/markdown;charset=utf-8" }), `${state.baseName}.md`);
});
$("#btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.editor.value);
    toast("Markdown copied to clipboard");
  } catch (e) {
    els.editor.select();
    toast("Press Ctrl+C to copy", "error");
  }
});
$("#btn-new").addEventListener("click", () => {
  reset();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
