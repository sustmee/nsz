/* MD Paper → LAMMPS Input — page controller */

import { extractParameters } from "./extractor.js";
import { buildScript } from "./script-gen.js";

const { toast, downloadBlob, formatBytes, friendlyError } = window.NSZ;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

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
  groups: $("#param-groups"),
  lists: $("#lists"),
  scriptView: $("#script-view"),
  todoBox: $("#todo-box"),
  todoCount: $("#todo-count"),
  numList: $("#num-list"),
  numFilter: $("#num-filter"),
  numCount: $("#num-count"),
  methods: $("#methods-view"),
  summary: $("#summary"),
};

let state = null; // { result, values, status, fileName, baseName, paperText, script }

const SAMPLE = `# Mechanical properties of defective graphene under uniaxial tension: a molecular dynamics study

## 2 Simulation methods

All simulations were performed with the open-source code LAMMPS (version 29 Oct 2020). A rectangular graphene sheet with dimensions of 10 nm × 10 nm containing 3,936 carbon atoms was built. Periodic boundary conditions were applied in the x and y directions, while the z direction was kept non-periodic. The interactions between carbon atoms were described by the AIREBO potential developed by Stuart et al. [21], with the cutoff distance of the REBO term modified to 2.0 Å to avoid the non-physical strain hardening. The equations of motion were integrated using the velocity Verlet algorithm with a time step of 1 fs.

Before loading, the structure was first optimized by the conjugate gradient method with an energy tolerance of 10^-10. The system was then equilibrated in the NPT ensemble at 300 K and zero pressure for 100 ps using the Nosé–Hoover thermostat and barostat. The damping parameters for the thermostat and barostat were 0.1 ps and 1 ps, respectively. Initial velocities were assigned from a Gaussian distribution.

Uniaxial tension was applied along the armchair (x) direction at a strain rate of 1 × 10^9 s^-1 until fracture. During loading the sheet was kept in the NPT ensemble so that the stress in the y direction remained zero. The atomic stress was computed with the virial theorem and the thickness of graphene was taken as 3.35 Å. Vacancy defects with concentrations of 0.5%, 1% and 2% were randomly distributed. Simulations were repeated at 300, 600, 900 and 1200 K. Atomic configurations were saved every 1000 steps and visualized using OVITO.`;

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, match) {
  const safe = escapeHtml(text);
  if (!match) return safe;
  const m = escapeHtml(match);
  const i = safe.indexOf(m);
  if (i < 0) return safe;
  return safe.slice(0, i) + "<mark>" + m + "</mark>" + safe.slice(i + m.length);
}

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

function setProgress(f, msg) {
  const pct = Math.max(0, Math.min(100, Math.round(f * 100)));
  els.pBar.style.width = pct + "%";
  els.pBar.parentElement.setAttribute("aria-valuenow", String(pct));
  if (msg) els.pStatus.textContent = msg;
}

function safeBaseName(filename) {
  return (filename.replace(/\.[^.]+$/, "").trim() || "paper").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60);
}

const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ---------------------------------------------------------------------- */
/* Reading the paper                                                        */
/* ---------------------------------------------------------------------- */

async function readPaper(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    setProgress(0.03, "Loading PDF engine…");
    const { convertPdf } = await import("../doc-to-markdown/pdf-to-md.js");
    const buf = await file.arrayBuffer();
    const res = await convertPdf(buf, { extractFigures: false, pageMarkers: true, removeHeadersFooters: true, detectTables: true }, (f, m) => setProgress(0.05 + f * 0.85, m));
    return { text: res.markdown, warnings: res.warnings };
  }
  if (name.endsWith(".docx")) {
    const { convertDocx } = await import("../doc-to-markdown/docx-to-md.js");
    const res = await convertDocx(await file.arrayBuffer(), {}, (f, m) => setProgress(0.05 + f * 0.85, m));
    return { text: res.markdown, warnings: [] };
  }
  if (name.endsWith(".doc")) throw new Error("Old .doc files aren't supported. Save the paper as PDF or .docx and try again.");
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return { text: await file.text(), warnings: [] };
  throw new Error("Please choose a PDF, Word (.docx) or text file.");
}

async function handleFile(file) {
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  els.pType.textContent = ext.toUpperCase().slice(0, 4);
  els.pType.className = "ftype " + (ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "txt");
  els.pName.textContent = file.name;
  els.pSize.textContent = formatBytes(file.size);
  setProgress(0, "Reading file…");
  show("progress");
  setStep(2);
  await tick();
  try {
    const { text, warnings } = await readPaper(file);
    await analyse(text, file.name, warnings);
  } catch (err) {
    console.error(err);
    toast(friendlyError(err, "Could not read this file."), "error");
    reset();
  }
}

async function analyse(text, fileName, warnings = []) {
  setProgress(0.93, "Finding simulation parameters…");
  await tick();
  const result = extractParameters(text);
  const values = {};
  const status = {};
  for (const g of result.groups) for (const p of g.params) {
    values[p.id] = p.value;
    status[p.id] = p.status;
  }
  const allWarnings = [...warnings];
  if (!result.looksLikeMD) allWarnings.push("This doesn't look like a molecular dynamics paper: no interatomic potential, time step or mention of MD / LAMMPS was found.");
  if (!result.hasMethods) allWarnings.push("No Methods / Simulation section heading was recognised, so the whole paper was searched. Values from the Introduction may describe other studies — check the sources.");
  if (result.sentenceCount < 15) allWarnings.push("Very little text was found. If this is a scanned PDF, the text can't be read — paste the Methods section into the “Paste text” tab instead.");
  state = { result, values, status, fileName, baseName: safeBaseName(fileName), paperText: text, warnings: allWarnings };
  setProgress(1, "Done");
  renderResult();
  show("result");
  setStep(3);
  els.resultView.scrollIntoView({ behavior: "smooth", block: "start" });
  const found = Object.values(status).filter((s) => s === "found").length;
  toast(`Found ${found} parameters. Check each one against the paper.`);
}

/* ---------------------------------------------------------------------- */
/* Rendering                                                               */
/* ---------------------------------------------------------------------- */

const GROUP_ICONS = {
  atom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const STATUS_LABEL = { found: "Found", suggested: "Typical", missing: "Missing", edited: "Edited" };

function renderResult() {
  const { result, fileName } = state;
  $("#r-title").textContent = result.title ? result.title.slice(0, 160) : "Parameters extracted";
  $("#r-name").textContent = fileName;
  renderStats();
  $("#r-warnings").innerHTML = state.warnings
    .map((w) => `<div class="notice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>${escapeHtml(w)}</span></div>`)
    .join("");
  renderSummary();
  renderGroups();
  renderLists();
  renderNumbers();
  renderMethods();
  updateScript();
  selectTab("params");
}

function renderStats() {
  const st = Object.values(state.status);
  const c = (k) => st.filter((s) => s === k).length;
  $("#r-stats").innerHTML = [
    ["found", c("found") + c("edited"), "found"],
    ["suggested", c("suggested"), "typical"],
    ["missing", c("missing"), "missing"],
  ].map(([cls, n, label]) => `<span class="stat ${cls}"><b>${n}</b> ${label}</span>`).join("");
}

function renderSummary() {
  const v = state.values;
  const items = [
    ["Material", v.material], ["Potential", v.potential], ["Simulation", v.simType],
    ["Ensemble", v.ensemble], ["Temperature", v.temperature], ["Time step", v.timestep],
  ];
  els.summary.innerHTML = items
    .map(([k, val]) => `<div class="sum-card${val ? "" : " empty"}"><small>${k}</small><strong>${escapeHtml(val || "—")}</strong></div>`)
    .join("");
}

function renderGroups() {
  els.groups.innerHTML = state.result.groups.map((g) => `
    <section class="pgroup">
      <h3><span class="pg-icon">${GROUP_ICONS[g.icon] || ""}</span>${escapeHtml(g.label)}</h3>
      <div class="ptable">
        ${g.params.map((p) => paramRow(p)).join("")}
      </div>
    </section>`).join("");

  els.groups.querySelectorAll("input.pval").forEach((inp) => {
    inp.addEventListener("input", () => {
      const id = inp.dataset.id;
      state.values[id] = inp.value;
      const p = findParam(id);
      state.status[id] = inp.value.trim() === "" ? "missing" : inp.value === p.value ? p.status : "edited";
      const badge = els.groups.querySelector(`.badge-status[data-for="${id}"]`);
      badge.className = "badge-status " + state.status[id];
      badge.textContent = STATUS_LABEL[state.status[id]];
      scheduleUpdate();
    });
  });
  els.groups.querySelectorAll(".src-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const row = btn.closest(".prow");
      row.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(row.classList.contains("open")));
    })
  );
  els.groups.querySelectorAll(".alt-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      const inp = els.groups.querySelector(`input.pval[data-id="${chip.dataset.id}"]`);
      inp.value = chip.dataset.value;
      inp.dispatchEvent(new Event("input"));
      inp.focus();
    })
  );
}

function findParam(id) {
  for (const g of state.result.groups) for (const p of g.params) if (p.id === id) return p;
  return null;
}

function paramRow(p) {
  const st = state.status[p.id];
  const evidence = p.candidates.slice(0, 5).map((c, i) => `
    <div class="ev">
      <div class="ev-head">
        <span class="ev-val">${escapeHtml(c.display)}</span>
        ${i > 0 ? `<button type="button" class="alt-chip" data-id="${p.id}" data-value="${escapeHtml(c.display)}">Use this</button>` : '<span class="ev-used">in use</span>'}
      </div>
      ${c.evidence.slice(0, 2).map((e) => `<blockquote>${highlight(e.text, e.match)}<cite>Page ${e.page}${e.section ? " · " + escapeHtml(e.section.slice(0, 60)) : ""}</cite></blockquote>`).join("")}
    </div>`).join("");
  const note = p.note ? `<div class="pnote">${escapeHtml(p.note)}</div>` : "";
  const hasSrc = p.candidates.length > 0;
  const alts = p.candidates.length > 1 ? `<span class="alt-count" title="Other values found">+${p.candidates.length - 1}</span>` : "";
  return `
    <div class="prow">
      <div class="pmain">
        <label class="plabel" for="p-${p.id}">${escapeHtml(p.label)}</label>
        <div class="pinput">
          <input id="p-${p.id}" class="pval" data-id="${p.id}" type="text" value="${escapeHtml(state.values[p.id] || "")}" placeholder="not found — type a value" spellcheck="false" autocomplete="off">
          ${alts}
        </div>
        <span class="badge-status ${st}" data-for="${p.id}">${STATUS_LABEL[st]}</span>
        ${hasSrc ? `<button type="button" class="src-btn" aria-expanded="false">Source</button>` : '<span class="src-none"></span>'}
      </div>
      ${note}
      ${hasSrc ? `<div class="pevidence">${evidence}</div>` : ""}
    </div>`;
}

function renderLists() {
  const { lists } = state.result;
  const block = (title, arr) => arr.length
    ? `<div class="list-block"><h4>${title}</h4><div class="chips">${arr.map((x) => `<span class="chip" title="${escapeHtml(x.evidence[0] ? x.evidence[0].text.slice(0, 200) : "")}">${escapeHtml(x.display)}</span>`).join("")}</div></div>`
    : "";
  els.lists.innerHTML = block("Properties computed", lists.properties) + block("Analysis methods", lists.analysis) + block("Software & tools", lists.tools);
}

function renderNumbers() {
  const q = (els.numFilter.value || "").trim().toLowerCase();
  const list = state.result.numerics.filter((n) => !q || n.text.toLowerCase().includes(q));
  els.numCount.textContent = state.result.numerics.length;
  els.numList.innerHTML = list.length
    ? list.map((n) => {
      let html = escapeHtml(n.text);
      for (const val of [...new Set(n.values)].sort((a, b) => b.length - a.length)) {
        html = html.replace(new RegExp(escapeRe(escapeHtml(val)) + "(?![^<]*</mark>)", "g"), "<mark>$&</mark>");
      }
      return `<div class="num-item ${n.kind}"><span class="num-meta">p. ${n.page}${n.kind === "methods" ? ' · <b>Methods</b>' : n.kind === "intro" ? " · Intro" : ""}</span><p>${html}</p></div>`;
    }).join("")
    : '<p class="hint">No matching sentences.</p>';
}

function renderMethods() {
  const s = state.result.methodsText;
  if (!s.length) {
    els.methods.innerHTML = '<p class="hint">No section titled “Methods”, “Simulation details” or similar was recognised. Use the <b>Every number</b> tab to scan the whole paper.</p>';
    return;
  }
  let html = "";
  let sec = null;
  for (const x of s) {
    if (x.section !== sec) {
      sec = x.section;
      html += `<h4>${escapeHtml(sec)}</h4>`;
    }
    html += `<span class="msent">${escapeHtml(x.text)} </span>`;
  }
  els.methods.innerHTML = html;
}

/* ---------------------------------------------------------------------- */
/* Script                                                                  */
/* ---------------------------------------------------------------------- */

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateScript();
    renderStats();
    renderSummary();
  }, 200);
}

function updateScript() {
  const orient = findParam("orientation");
  const potRef = findParam("potentialRef");
  const info = {
    title: state.result.title,
    fileName: state.fileName,
    status: state.status,
    orientations: orient ? [state.values.orientation, ...orient.candidates.map((c) => c.display)].filter(Boolean) : [],
    potentialFiles: potRef ? potRef.candidates.map((c) => c.display) : [],
  };
  const { script, todo } = buildScript(state.values, info);
  state.script = script;
  state.todo = todo;
  els.scriptView.innerHTML = colorize(script);
  els.todoCount.hidden = !todo.length;
  els.todoCount.textContent = todo.length;
  els.todoBox.innerHTML = todo.length
    ? `<div class="todo-box"><strong>${todo.length} thing${todo.length === 1 ? "" : "s"} to check</strong> — not found in the paper, so defaults were used:<ul>${todo.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`
    : `<div class="todo-box ok"><strong>Everything the script needs was found in the paper.</strong> Still compare it with the Methods section before running.</div>`;
}

function colorize(script) {
  return script.split("\n").map((line) => {
    const hash = line.indexOf("#");
    const code = hash >= 0 ? line.slice(0, hash) : line;
    const comment = hash >= 0 ? line.slice(hash) : "";
    let c = escapeHtml(code)
      .replace(/^(\s*)([a-z_]+)/, '$1<span class="k">$2</span>')
      .replace(/(\$\{[^}]+\}|\$\([^)]*\)|\bv_\w+|\bc_\w+(?:\[\d\])?|\bf_\w+(?:\[\d\])?)/g, '<span class="v">$1</span>');
    let cm = escapeHtml(comment)
      .replace(/\[TODO[^\]]*\]|TODO:?/g, '<span class="t-todo">$&</span>')
      .replace(/\[paper\]/g, '<span class="t-paper">$&</span>')
      .replace(/\[typical\]/g, '<span class="t-typ">$&</span>');
    return c + (cm ? `<span class="cm">${cm}</span>` : "");
  }).join("\n");
}

/* ---------------------------------------------------------------------- */
/* Downloads                                                               */
/* ---------------------------------------------------------------------- */

function tableRows() {
  const rows = [];
  for (const g of state.result.groups) for (const p of g.params) {
    const c = p.candidates.find((x) => x.display === state.values[p.id]) || p.candidates[0];
    const ev = c && c.evidence[0] ? c.evidence[0] : null;
    rows.push({ group: g.label, label: p.label, value: state.values[p.id] || "", status: STATUS_LABEL[state.status[p.id]], page: ev ? ev.page : "", source: ev ? ev.text : p.note || "" });
  }
  return rows;
}

function toCsv() {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  return ["Group,Parameter,Value,Status,Page,Source sentence", ...tableRows().map((r) => [r.group, r.label, r.value, r.status, r.page, r.source].map(q).join(","))].join("\r\n");
}

function toMarkdown() {
  const esc = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  let md = `# Simulation parameters\n\n**Paper:** ${esc(state.result.title || state.fileName)}\n\n`;
  let group = null;
  for (const r of tableRows()) {
    if (r.group !== group) {
      group = r.group;
      md += `\n## ${group}\n\n| Parameter | Value | Status | Page | Source |\n| --- | --- | --- | --- | --- |\n`;
    }
    md += `| ${esc(r.label)} | ${esc(r.value || "—")} | ${r.status} | ${r.page} | ${esc(r.source).slice(0, 220)} |\n`;
  }
  const { lists } = state.result;
  for (const [title, arr] of [["Properties computed", lists.properties], ["Analysis methods", lists.analysis], ["Software & tools", lists.tools]]) {
    if (arr.length) md += `\n## ${title}\n\n${arr.map((x) => "- " + x.display).join("\n")}\n`;
  }
  return md;
}

function aiPrompt() {
  const methods = state.result.methodsText.length
    ? state.result.methodsText.map((s) => s.text).join(" ")
    : state.result.numerics.map((n) => n.text).join(" ");
  const found = tableRows().filter((r) => r.value).map((r) => `- ${r.label}: ${r.value}`).join("\n");
  return `You are an expert in molecular dynamics and LAMMPS. Below is the simulation/methods text of a research paper${state.result.title ? ` titled "${state.result.title}"` : ""}.

Tasks:
1. List EVERY simulation detail needed to reproduce the study in a table (parameter | value with units | exact quote from the text). Include: material and structure, lattice constant, orientation, box size and number of atoms, boundary conditions, interatomic potential and its source/file, cutoffs, units, time step, minimization, ensembles, thermostat/barostat and damping constants, temperature(s), pressure, equilibration and production times, loading method (strain rate, direction, maximum strain or other), output frequency, and the analysis methods. Write "not stated" when something is missing; do not guess silently.
2. Then write a complete, commented LAMMPS input script (latest LAMMPS syntax) that reproduces the simulation, and list every value you had to assume.

A rule-based tool already found these values (verify them, they may be wrong):
${found}

--- PAPER TEXT ---
${methods.slice(0, 12000)}`;
}

async function downloadZip() {
  if (!window.JSZip) return toast("ZIP library failed to load. Please refresh.", "error");
  const zip = new window.JSZip();
  const root = zip.folder(state.baseName + "_lammps");
  root.file("in.lammps", state.script);
  root.file("parameters.csv", toCsv());
  root.file("parameters.md", toMarkdown());
  root.file("paper_text.md", state.paperText);
  root.file("ai_prompt.txt", aiPrompt());
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadBlob(blob, `${state.baseName}_lammps.zip`);
  toast("ZIP downloaded");
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(okMsg);
    } catch (e2) {
      toast("Copy failed — select the text and press Ctrl+C.", "error");
    }
    ta.remove();
  }
}

/* ---------------------------------------------------------------------- */
/* Tabs & events                                                           */
/* ---------------------------------------------------------------------- */

function selectTab(name) {
  $$(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", String(on));
  });
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
}

function reset() {
  els.input.value = "";
  show("upload");
  setStep(1);
}

$$(".input-tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".input-tab").forEach((x) => {
      x.classList.toggle("active", x === t);
      x.setAttribute("aria-selected", String(x === t));
    });
    $$("[data-input-panel]").forEach((p) => (p.hidden = p.dataset.inputPanel !== t.dataset.input));
  })
);

els.input.addEventListener("change", () => handleFile(els.input.files[0]));
["dragenter", "dragover"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  els.dropzone.classList.add("dragging");
}));
["dragleave", "dragend", "drop"].forEach((ev) => els.dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev !== "dragleave" || !els.dropzone.contains(e.relatedTarget)) els.dropzone.classList.remove("dragging");
}));
els.dropzone.addEventListener("drop", (e) => {
  e.stopPropagation();
  handleFile(e.dataTransfer && e.dataTransfer.files[0]);
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!els.uploadView.hidden && e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

$("#btn-paste").addEventListener("click", async () => {
  const text = $("#paste-input").value;
  if (text.trim().length < 40) return toast("Please paste more of the paper's text (at least a few sentences).", "error");
  show("progress");
  setStep(2);
  els.pType.textContent = "TXT";
  els.pType.className = "ftype txt";
  els.pName.textContent = "Pasted text";
  els.pSize.textContent = `${text.length.toLocaleString()} characters`;
  await analyse(text, "pasted_text.txt");
});

$("#btn-sample").addEventListener("click", async () => {
  show("progress");
  setStep(2);
  els.pType.textContent = "TXT";
  els.pType.className = "ftype txt";
  els.pName.textContent = "Sample: graphene tensile test";
  els.pSize.textContent = "";
  await analyse(SAMPLE, "sample_graphene_tension.txt");
});

$$(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
els.numFilter.addEventListener("input", renderNumbers);

const dlScript = () => downloadBlob(new Blob([state.script], { type: "text/plain" }), "in.lammps");
$("#btn-script").addEventListener("click", dlScript);
$("#btn-script2").addEventListener("click", dlScript);
$("#btn-copy-script").addEventListener("click", () => copyText(state.script, "Script copied"));
$("#btn-zip").addEventListener("click", downloadZip);
$("#btn-ai").addEventListener("click", () => copyText(aiPrompt(), "AI prompt copied — paste it into ChatGPT, Claude or Gemini"));
$("#btn-new").addEventListener("click", () => {
  reset();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.NSZ.ready();
