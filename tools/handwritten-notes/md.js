/* ==========================================================================
   Handwritten notes — a small Markdown + LaTeX parser.

   One syntax tree feeds every output (preview, print/PDF, Word, LaTeX), so
   what students see in the preview is what they download.

   Blocks:  heading{level,inl} para{inl} list{ordered,start,items[{blocks,checked}]}
            quote{blocks} code{lang,text} math{tex} table{align,head,rows}
            figure{src,alt} hr page{n}
   Inlines: text{v} b{c} i{c} s{c} mark{c} code{v} math{tex} link{href,c}
            img{src,alt} unsure{v} br
   Every top-level block has `line` (0-based source line) for click-to-edit.

   Notes-specific syntax:
     <!-- page 3 -->                    start of notebook page 3
     [?word?]                           a word the reader wasn't sure about
     ![Figure: caption](page:2#x0,y0,x1,y1)  a crop of page 2 (fractions 0–1)
   ========================================================================== */

const MATH_ENVS = /^\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|multline\*?|eqnarray\*?|cases|split|alignat\*?)\}/;
const PAGE_RE = /^<!--\s*page\s+(\d+)\s*-->\s*$/i;
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const HR_RE = /^ {0,3}([-*_])( *\1){2,} *$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/;

const indentOf = (s) => s.match(/^ */)[0].length;
const isBlank = (s) => !s || !s.trim();

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  let math = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "$") math = !math;
    if (ch === "|" && !math) { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
const isTableSep = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("|") && line.includes("-");

/** Lines that end a paragraph. */
function startsBlock(line, next) {
  return (
    PAGE_RE.test(line.trim()) ||
    /^ {0,3}#{1,6}(\s|$)/.test(line) ||
    FENCE_RE.test(line) ||
    /^\s*(\$\$|\\\[)/.test(line) ||
    MATH_ENVS.test(line.trim()) ||
    /^ {0,3}>/.test(line) ||
    HR_RE.test(line) ||
    LIST_RE.test(line) ||
    (line.includes("|") && next != null && isTableSep(next))
  );
}

export function parse(src) {
  const lines = String(src || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines, 0);
}

function parseBlocks(lines, offset) {
  const out = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const trimmed = line.trim();
    const at = offset + i;
    if (isBlank(line)) { i++; continue; }

    let m;
    if ((m = trimmed.match(PAGE_RE))) {
      out.push({ t: "page", n: +m[1], line: at });
      i++;
      continue;
    }

    if ((m = line.match(FENCE_RE))) {
      const fence = m[1];
      const body = [];
      i++;
      while (i < n && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      out.push({ t: "code", lang: m[2] || "", text: body.join("\n"), line: at });
      continue;
    }

    // Display math: $$ … $$, \[ … \], or a bare \begin{align} … \end{align}
    if (/^(\$\$|\\\[)/.test(trimmed) || MATH_ENVS.test(trimmed)) {
      const env = trimmed.match(MATH_ENVS);
      const open = env ? null : trimmed.startsWith("$$") ? "$$" : "\\[";
      const close = env ? `\\end{${env[1]}}` : open === "$$" ? "$$" : "\\]";
      let text = env ? trimmed : trimmed.slice(2);
      let after = "";
      let j = i;
      let endAt = text.indexOf(close);
      while (endAt < 0 && j + 1 < n) {
        j++;
        text += "\n" + lines[j];
        endAt = text.indexOf(close);
      }
      if (endAt >= 0) {
        after = text.slice(endAt + close.length).trim();
        text = env ? text.slice(0, endAt + close.length) : text.slice(0, endAt);
      }
      const tex = text.trim();
      if (tex) out.push({ t: "math", tex, line: at });
      i = j + 1;
      if (after) {
        // "$$ x $$ (1)" — keep the trailing text as its own paragraph
        out.push({ t: "para", inl: parseInline(after), line: at });
      }
      continue;
    }

    if ((m = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)) || (m = line.match(/^ {0,3}(#{1,6})$/))) {
      out.push({ t: "heading", level: m[1].length, inl: parseInline(m[2] || ""), line: at });
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      out.push({ t: "hr", line: at });
      i++;
      continue;
    }

    if (line.includes("|") && i + 1 < n && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
      const rows = [];
      i += 2;
      while (i < n && !isBlank(lines[i]) && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
      const cols = Math.max(head.length, ...rows.map((r) => r.length));
      const pad = (r) => Array.from({ length: cols }, (_, k) => parseInline(r[k] || ""));
      out.push({ t: "table", align: Array.from({ length: cols }, (_, k) => align[k] || ""), head: pad(head), rows: rows.map(pad), line: at });
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const body = [];
      while (i < n && !isBlank(lines[i])) {
        const l = lines[i];
        if (/^ {0,3}>/.test(l)) body.push(l.replace(/^ {0,3}> ?/, ""));
        else if (startsBlock(l, lines[i + 1])) break;
        else body.push(l); // lazy continuation
        i++;
      }
      out.push({ t: "quote", blocks: parseBlocks(body, at), line: at });
      continue;
    }

    if (LIST_RE.test(line)) {
      const res = parseList(lines, i, offset);
      out.push(res.node);
      i = res.next;
      continue;
    }

    // Paragraph
    const body = [line];
    i++;
    while (i < n && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) body.push(lines[i++]);
    const text = body.map((l) => l.replace(/^ +/, "")).join("\n");
    const inl = parseInline(text);
    const only = inl.filter((x) => !(x.t === "text" && !x.v.trim()));
    if (only.length === 1 && only[0].t === "img") out.push({ t: "figure", src: only[0].src, alt: only[0].alt, line: at });
    else out.push({ t: "para", inl, line: at });
  }
  return out;
}

function parseList(lines, start, offset) {
  const first = lines[start].match(LIST_RE);
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const node = { t: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items: [], line: offset + start };
  let i = start;
  const n = lines.length;
  while (i < n) {
    const m = lines[i].match(LIST_RE);
    if (!m || Math.abs(m[1].length - base) > 1 || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = m[1].length + m[2].length + Math.max(1, Math.min(m[3].length, 4));
    let text = m[4];
    let checked = null;
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) { checked = task[1] !== " "; text = task[2]; }
    const content = [text];
    const itemLine = i;
    i++;
    while (i < n) {
      const l = lines[i];
      if (isBlank(l)) {
        let k = i + 1;
        while (k < n && isBlank(lines[k])) k++;
        if (k < n && indentOf(lines[k]) > base && !(LIST_RE.test(lines[k]) && indentOf(lines[k]) <= base + 1)) {
          content.push("");
          i++;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      const lm = l.match(LIST_RE);
      if (lm && ind <= base + 1) break; // next sibling (or a list at this level)
      if (ind > base) { content.push(l.slice(Math.min(ind, contentIndent))); i++; continue; }
      // Lazy continuation of the item's paragraph
      if (!isBlank(content[content.length - 1]) && !startsBlock(l, lines[i + 1])) { content.push(l.trim()); i++; continue; }
      break;
    }
    node.items.push({ blocks: parseBlocks(content, offset + itemLine), checked });
    // A blank line followed by another item continues the list
    if (i < n && isBlank(lines[i])) {
      let k = i;
      while (k < n && isBlank(lines[k])) k++;
      const nm = k < n && lines[k].match(LIST_RE);
      if (nm && Math.abs(nm[1].length - base) <= 1 && /\d/.test(nm[2]) === ordered) { node.loose = true; i = k; }
    }
  }
  return { node, next: i };
}

/* ---------- Inline ---------- */

const PUNCT = "\\`*_{}[]()#+-.!|$~=<>\"'";

function closingDollar(s, from) {
  for (let k = from; k < s.length; k++) {
    if (s[k] === "\\") { k++; continue; }
    if (s[k] === "$") {
      if (s[k + 1] === "$") return -1;
      if (/\s/.test(s[k - 1])) continue;
      if (/\d/.test(s[k + 1] || "")) continue;
      return k;
    }
  }
  return -1;
}

function matchBracket(s, from, open, close) {
  let depth = 0;
  for (let k = from; k < s.length; k++) {
    if (s[k] === "\\") { k++; continue; }
    if (s[k] === open) depth++;
    else if (s[k] === close && --depth === 0) return k;
  }
  return -1;
}

export function parseInline(s) {
  const toks = [];
  let buf = "";
  const flush = () => { if (buf) { toks.push({ t: "text", v: buf }); buf = ""; } };
  const push = (node) => { flush(); toks.push(node); };
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    const nx = s[i + 1];

    if (ch === "\\") {
      if (nx === "(") {
        const end = s.indexOf("\\)", i + 2);
        if (end > 0) { push({ t: "math", tex: s.slice(i + 2, end).trim() }); i = end + 1; continue; }
      }
      if (nx === "[") {
        const end = s.indexOf("\\]", i + 2);
        if (end > 0) { push({ t: "math", tex: s.slice(i + 2, end).trim(), display: true }); i = end + 1; continue; }
      }
      if (nx === "\n") { push({ t: "br" }); i++; continue; }
      if (nx && PUNCT.includes(nx)) { buf += nx; i++; continue; }
      buf += ch;
      continue;
    }

    if (ch === "$") {
      if (nx === "$") {
        const end = s.indexOf("$$", i + 2);
        if (end > i + 2) { push({ t: "math", tex: s.slice(i + 2, end).trim(), display: true }); i = end + 1; continue; }
      } else if (nx && !/\s/.test(nx)) {
        const end = closingDollar(s, i + 1);
        if (end > i + 1) { push({ t: "math", tex: s.slice(i + 1, end) }); i = end; continue; }
      }
      buf += ch;
      continue;
    }

    if (ch === "`") {
      let ticks = 1;
      while (s[i + ticks] === "`") ticks++;
      const fence = "`".repeat(ticks);
      const end = s.indexOf(fence, i + ticks);
      if (end > 0) { push({ t: "code", v: s.slice(i + ticks, end).replace(/^ (.*) $/, "$1") }); i = end + ticks - 1; continue; }
      buf += fence;
      i += ticks - 1;
      continue;
    }

    if (ch === "[" && nx === "?") {
      const end = s.indexOf("?]", i + 2);
      if (end > i + 1 && end - i < 120 && !s.slice(i + 2, end).includes("\n")) { push({ t: "unsure", v: s.slice(i + 2, end).trim() }); i = end + 1; continue; }
    }

    if ((ch === "!" && nx === "[") || ch === "[") {
      const img = ch === "!";
      const lb = img ? i + 1 : i;
      const rb = matchBracket(s, lb, "[", "]");
      if (rb > 0 && s[rb + 1] === "(") {
        const rp = matchBracket(s, rb + 1, "(", ")");
        if (rp > 0) {
          const label = s.slice(lb + 1, rb);
          let target = s.slice(rb + 2, rp).trim();
          const title = target.match(/^(\S+)\s+["'].*["']$/);
          if (title) target = title[1];
          target = target.replace(/^<(.*)>$/, "$1");
          if (img) push({ t: "img", src: target, alt: label });
          else push({ t: "link", href: target, c: parseInline(label) });
          i = rp;
          continue;
        }
      }
    }

    if (ch === "<") {
      const br = s.slice(i).match(/^<br\s*\/?>/i);
      if (br) { push({ t: "br" }); i += br[0].length - 1; continue; }
      const auto = s.slice(i).match(/^<(https?:\/\/[^>\s]+)>/);
      if (auto) { push({ t: "link", href: auto[1], c: [{ t: "text", v: auto[1] }] }); i += auto[0].length - 1; continue; }
    }

    if (ch === "\n") {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ""); push({ t: "br" }); }
      else buf += " ";
      continue;
    }

    if (ch === "*" || ch === "_" || ch === "~" || ch === "=") {
      let run = 1;
      while (s[i + run] === ch) run++;
      if ((ch === "~" || ch === "=") && run !== 2) { buf += s.slice(i, i + run); i += run - 1; continue; }
      const before = s[i - 1] || " ";
      const after = s[i + run] || " ";
      let canOpen = !/\s/.test(after);
      let canClose = !/\s/.test(before);
      if (ch === "_") {
        // snake_case and file_names are not emphasis
        if (/[A-Za-z0-9]/.test(before)) canOpen = false;
        if (/[A-Za-z0-9]/.test(after)) canClose = false;
      }
      flush();
      let left = run;
      if (ch === "*" || ch === "_") {
        while (left > 0) {
          const size = left >= 2 ? 2 : 1;
          toks.push({ t: "delim", ch, size, raw: ch.repeat(size), canOpen, canClose });
          left -= size;
        }
      } else {
        toks.push({ t: "delim", ch, size: 2, raw: ch + ch, canOpen, canClose });
      }
      i += run - 1;
      continue;
    }

    buf += ch;
  }
  flush();
  return resolveDelims(toks);
}

function resolveDelims(toks) {
  const out = [];
  for (const tok of toks) {
    if (tok.t !== "delim") { out.push(tok); continue; }
    if (tok.canClose) {
      let j = out.length - 1;
      while (j >= 0 && !(out[j].t === "delim" && out[j].open && out[j].ch === tok.ch && out[j].size === tok.size)) j--;
      if (j >= 0) {
        const kids = finalize(out.splice(j + 1));
        out.pop();
        const kind = tok.ch === "~" ? "s" : tok.ch === "=" ? "mark" : tok.size === 2 ? "b" : "i";
        out.push({ t: kind, c: kids });
        continue;
      }
    }
    if (tok.canOpen) { out.push({ ...tok, open: true }); continue; }
    out.push({ t: "text", v: tok.raw });
  }
  return finalize(out);
}

function finalize(nodes) {
  const res = [];
  for (const nd of nodes) {
    const node = nd.t === "delim" ? { t: "text", v: nd.raw } : nd;
    const last = res[res.length - 1];
    if (node.t === "text" && last && last.t === "text") last.v += node.v;
    else res.push(node);
  }
  return res;
}

/* ---------- Helpers shared by the renderers ---------- */

export function inlineText(inl) {
  return (inl || [])
    .map((x) => (x.t === "text" ? x.v : x.t === "code" ? x.v : x.t === "math" ? x.tex : x.t === "unsure" ? x.v : x.t === "br" ? " " : x.c ? inlineText(x.c) : x.alt || ""))
    .join("");
}

/** page:2#0.10,0.20,0.80,0.55 → { page: 2, box: [x0,y0,x1,y1] } */
export function parsePageRef(src) {
  const m = String(src || "").match(/^page:(\d+)(?:#\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+))?$/i);
  if (!m) return null;
  let box = m[2] ? [+m[2], +m[3], +m[4], +m[5]] : [0, 0, 1, 1];
  // Accept percentages too (e.g. 10,20,80,55)
  if (box.some((v) => v > 1.0001)) box = box.map((v) => v / 100);
  const [a, b, c, d] = box.map((v) => Math.min(1, Math.max(0, v)));
  return { page: +m[1], box: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] };
}

export const caption = (alt) => String(alt || "").replace(/^\s*(figure|fig\.?|diagram)\s*\d*\s*[:.\-–]\s*/i, "").trim();

/** When the document title repeats the first top heading, drop that heading (no double title). */
export function withoutTitleHeading(blocks, title) {
  const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!norm(title)) return blocks;
  const i = blocks.findIndex((b) => b.t === "heading");
  if (i < 0 || blocks[i].level > 2 || norm(inlineText(blocks[i].inl)) !== norm(title)) return blocks;
  if (blocks.slice(0, i).some((b) => b.t === "heading" || b.t === "list" || b.t === "table" || b.t === "figure")) return blocks;
  return blocks.filter((_, k) => k !== i);
}

export function walkBlocks(blocks, fn) {
  for (const b of blocks) {
    fn(b);
    if (b.t === "quote") walkBlocks(b.blocks, fn);
    if (b.t === "list") b.items.forEach((it) => walkBlocks(it.blocks, fn));
  }
}

/** Renumber figures in reading order: returns Map(src → n). */
export function figureNumbers(blocks) {
  const map = new Map();
  let k = 0;
  walkBlocks(blocks, (b) => { if (b.t === "figure" && !map.has(b)) map.set(b, ++k); });
  return map;
}

/* ---------- HTML renderer (preview + print) ---------- */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const KATEX_MACROS = {
  "\\R": "\\mathbb{R}",
  "\\N": "\\mathbb{N}",
  "\\Z": "\\mathbb{Z}",
  "\\Q": "\\mathbb{Q}",
  "\\C": "\\mathbb{C}",
  "\\degree": "^\\circ",
  "\\celsius": "^\\circ\\mathrm{C}",
};

export function renderMath(tex, display) {
  const k = window.katex;
  if (!k) return `<code>${esc(tex)}</code>`;
  try {
    return k.renderToString(tex, { displayMode: !!display, throwOnError: true, strict: "ignore", trust: false, macros: { ...KATEX_MACROS } });
  } catch (e) {
    return `<span class="math-error" title="${esc(e.message || "LaTeX error")}">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</span>`;
  }
}

/**
 * ctx: { imageUrl(src) → url|null, figNo: Map, showUnsure: bool, lines: bool, figureAttrs(src) → string }
 */
export function renderInlineHTML(inl, ctx = {}) {
  return (inl || [])
    .map((x) => {
      switch (x.t) {
        case "text": return esc(x.v);
        case "b": return `<strong>${renderInlineHTML(x.c, ctx)}</strong>`;
        case "i": return `<em>${renderInlineHTML(x.c, ctx)}</em>`;
        case "s": return `<del>${renderInlineHTML(x.c, ctx)}</del>`;
        case "mark": return `<mark>${renderInlineHTML(x.c, ctx)}</mark>`;
        case "code": return `<code>${esc(x.v)}</code>`;
        case "math": return renderMath(x.tex, x.display);
        case "br": return "<br>";
        case "unsure": return ctx.showUnsure === false ? esc(x.v) : `<span class="unsure" title="The reader wasn't sure about this — please check">${esc(x.v)}</span>`;
        case "link": {
          const safe = /^(https?:|mailto:|#)/i.test(x.href) ? x.href : "#";
          return `<a href="${esc(safe)}" target="_blank" rel="noopener">${renderInlineHTML(x.c, ctx)}</a>`;
        }
        case "img": {
          const url = ctx.imageUrl ? ctx.imageUrl(x.src) : x.src;
          return url ? `<img src="${esc(url)}" alt="${esc(x.alt)}">` : `<span class="fig-missing">[${esc(x.alt || "image")}]</span>`;
        }
        default: return "";
      }
    })
    .join("");
}

export function renderBlocksHTML(blocks, ctx = {}, top = true) {
  const figNo = ctx.figNo || (ctx.figNo = figureNumbers(blocks));
  return blocks
    .map((b) => {
      const ln = top && ctx.lines && b.line != null ? ` data-line="${b.line}"` : "";
      switch (b.t) {
        case "heading": return `<h${b.level}${ln}>${renderInlineHTML(b.inl, ctx)}</h${b.level}>`;
        case "para": return `<p${ln}>${renderInlineHTML(b.inl, ctx)}</p>`;
        case "math": return `<div class="math-block"${ln}>${renderMath(b.tex, true)}</div>`;
        case "code": return `<pre${ln}><code>${esc(b.text)}</code></pre>`;
        case "hr": return `<hr${ln}>`;
        case "page": {
          if (ctx.pageMode === "none") return "";
          if (ctx.pageMode === "break") {
            const first = !ctx.seenPage;
            ctx.seenPage = true;
            return first ? "" : '<div class="page-break"></div>';
          }
          return `<div class="page-mark"${ln}><span>Page ${b.n}</span></div>`;
        }
        case "quote": {
          const lead = b.blocks[0] && b.blocks[0].t === "para" && b.blocks[0].inl[0] && b.blocks[0].inl[0].t === "b" ? inlineText(b.blocks[0].inl[0].c).toLowerCase() : "";
          const kind = /defin/.test(lead) ? "def" : /theorem|law|lemma|principle|rule/.test(lead) ? "thm" : /example|ex\b|problem|exercise/.test(lead) ? "ex" : /check|warning|caution|⚠|mistake/.test(lead) ? "warn" : /note|remember|important|tip|remark/.test(lead) ? "note" : "";
          return `<blockquote class="${kind ? "callout callout-" + kind : ""}"${ln}>${renderBlocksHTML(b.blocks, ctx, false)}</blockquote>`;
        }
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
          const items = b.items
            .map((it) => {
              const tight = !b.loose && it.blocks.length && it.blocks[0].t === "para";
              let inner = tight
                ? renderInlineHTML(it.blocks[0].inl, ctx) + renderBlocksHTML(it.blocks.slice(1), ctx, false)
                : renderBlocksHTML(it.blocks, ctx, false);
              if (it.checked != null) inner = `<input type="checkbox" disabled${it.checked ? " checked" : ""}> ` + inner;
              return `<li${it.checked != null ? ' class="task"' : ""}>${inner}</li>`;
            })
            .join("");
          return `<${tag}${start}${ln}>${items}</${tag}>`;
        }
        case "table": {
          const al = (k) => (b.align[k] ? ` style="text-align:${b.align[k]}"` : "");
          const head = `<tr>${b.head.map((c, k) => `<th${al(k)}>${renderInlineHTML(c, ctx)}</th>`).join("")}</tr>`;
          const rows = b.rows.map((r) => `<tr>${r.map((c, k) => `<td${al(k)}>${renderInlineHTML(c, ctx)}</td>`).join("")}</tr>`).join("");
          return `<div class="table-wrap"${ln}><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
        }
        case "figure": {
          const url = ctx.imageUrl ? ctx.imageUrl(b.src) : b.src;
          const no = figNo.get(b);
          const cap = caption(b.alt);
          const extra = ctx.figureAttrs ? ctx.figureAttrs(b.src) : "";
          const img = url ? `<img src="${esc(url)}" alt="${esc(cap || "Figure " + no)}">` : `<div class="fig-missing">Figure image not available — add the page photos again, or remove this line.</div>`;
          return `<figure${ln}${extra}>${img}<figcaption><b>Figure ${no}.</b> ${esc(cap)}</figcaption></figure>`;
        }
        default: return "";
      }
    })
    .join("\n");
}
