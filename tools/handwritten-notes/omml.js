/* ==========================================================================
   LaTeX → Word equations (OMML)

   KaTeX turns LaTeX into MathML; this file turns that MathML into Office
   Math Markup, so equations in the .docx are real, editable Word equations
   (not pictures).
   ========================================================================== */

import { KATEX_MACROS } from "./md.js";

const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const NARY = new Set(["∑", "∏", "∐", "∫", "∬", "∭", "∮", "∯", "∰", "⋃", "⋂", "⋁", "⋀", "⨁", "⨂", "⨀", "⨄", "⨆"]);
const INTEGRALS = new Set(["∫", "∬", "∭", "∮", "∯", "∰"]);
const ACCENTS = {
  "^": "̂", "ˆ": "̂", "̂": "̂",
  "~": "̃", "˜": "̃", "̃": "̃",
  "ˉ": "̅", "¯": "̅", "̄": "̅", "̅": "̅",
  "⃗": "⃗", "→": "⃗",
  "˙": "̇", "̇": "̇",
  "¨": "̈", "̈": "̈",
  "ˇ": "̌", "˘": "̆", "´": "́", "`": "̀",
};
const SCRIPTS = { "double-struck": "double-struck", script: "script", "bold-script": "script", fraktur: "fraktur", "bold-fraktur": "fraktur", "sans-serif": "sans-serif", monospace: "monospace" };

const kids = (el) => Array.from(el.children || []);

function run(text, { sty, scr, nor } = {}) {
  if (text === "" || text == null) return "";
  const mr = [];
  if (nor) mr.push("<m:nor/>"); // normal text excludes scr/sty
  else {
    if (scr) mr.push(`<m:scr m:val="${scr}"/>`);
    if (sty) mr.push(`<m:sty m:val="${sty}"/>`);
  }
  const rPr = mr.length ? `<m:rPr>${mr.join("")}</m:rPr>` : "";
  const font = nor ? "" : '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
  return `<m:r>${rPr}${font}<m:t xml:space="preserve">${xe(text)}</m:t></m:r>`;
}

function styleOf(el, text) {
  const v = el.getAttribute("mathvariant");
  const scr = v && SCRIPTS[v];
  let sty = null;
  if (v === "normal") sty = "p";
  else if (v === "bold") sty = "b";
  else if (v === "bold-italic") sty = "bi";
  else if (v === "italic") sty = "i";
  else if (v && /^bold/.test(v)) sty = "b";
  else if (scr) sty = "p";
  else if (el.localName === "mi" && [...text].length > 1) sty = "p"; // sin, cos, log …
  return { sty, scr };
}

const wrap = (tag, inner) => `<m:${tag}>${inner}</m:${tag}>`;
const e = (inner) => wrap("e", inner || "");

/** Converts the children of a row, handling fences, n-ary operators and limits. */
function convertRow(list) {
  let out = "";
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const name = el.localName;

    // \left( … \right) — a stretchy delimiter pair
    if (name === "mo" && el.getAttribute("fence") === "true" && i === 0 && list.length > 1) {
      const last = list[list.length - 1];
      const closes = last.localName === "mo" && last.getAttribute("fence") === "true";
      const inner = closes ? list.slice(1, -1) : list.slice(1);
      const beg = el.textContent;
      const end = closes ? last.textContent : "";
      return out + `<m:d><m:dPr><m:begChr m:val="${xe(beg)}"/><m:endChr m:val="${xe(end)}"/><m:grow m:val="1"/></m:dPr>${e(convertRow(inner))}</m:d>`;
    }

    // ∑, ∫ … with or without limits: Word wants the operand inside the operator
    const nary = naryParts(el);
    if (nary) {
      const operand = i + 1 < list.length ? convert(list[++i]) : "";
      const pr = [`<m:chr m:val="${xe(nary.chr)}"/>`, `<m:limLoc m:val="${nary.under ? "undOvr" : "subSup"}"/>`];
      if (!nary.sub) pr.push('<m:subHide m:val="1"/>');
      if (!nary.sup) pr.push('<m:supHide m:val="1"/>');
      out += `<m:nary><m:naryPr>${pr.join("")}</m:naryPr>${wrap("sub", nary.sub ? convert(nary.sub) : "")}${wrap("sup", nary.sup ? convert(nary.sup) : "")}${e(operand)}</m:nary>`;
      continue;
    }

    out += convert(el);
  }
  return out;
}

function naryParts(el) {
  const name = el.localName;
  const isOp = (x) => x && x.localName === "mo" && NARY.has(x.textContent.trim());
  if (name === "mo" && isOp(el)) return { chr: el.textContent.trim(), under: false };
  const c = kids(el);
  if ((name === "msub" || name === "munder") && isOp(c[0])) return { chr: c[0].textContent.trim(), sub: c[1], under: name === "munder" };
  if ((name === "msup" || name === "mover") && isOp(c[0])) return { chr: c[0].textContent.trim(), sup: c[1], under: name === "mover" };
  if ((name === "msubsup" || name === "munderover") && isOp(c[0])) {
    const chr = c[0].textContent.trim();
    return { chr, sub: c[1], sup: c[2], under: name === "munderover" && !INTEGRALS.has(chr) };
  }
  return null;
}

function convert(el) {
  if (!el) return "";
  const name = el.localName;
  const c = kids(el);
  switch (name) {
    case "math":
    case "mrow":
    case "mstyle":
    case "mpadded":
    case "merror":
      return convertRow(c);
    case "semantics":
      return convertRow(c.filter((x) => !/^annotation/.test(x.localName)));
    case "annotation":
    case "annotation-xml":
    case "mphantom":
    case "none":
      return "";
    case "mi":
    case "mn":
    case "mo": {
      const text = el.textContent.replace(/\u2223/g, "|").replace(/\u2225/g, "‖"); // KaTeX writes |x| with "divides"
      if (name === "mo" && !text.trim()) return "";
      return run(text, name === "mn" ? { sty: "p" } : name === "mo" ? { sty: "p" } : styleOf(el, text));
    }
    case "mtext":
    case "ms":
      return run(el.textContent.replace(/ /g, " "), { nor: true, sty: "p" });
    case "mspace": {
      const w = parseFloat(el.getAttribute("width") || "0");
      if (w >= 0.9) return run(" ", { sty: "p" });
      if (w >= 0.25) return run(" ", { sty: "p" });
      if (w > 0) return run(" ", { sty: "p" });
      return "";
    }
    case "mfrac": {
      const lt = el.getAttribute("linethickness");
      const noBar = lt != null && parseFloat(lt) === 0;
      return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ""}${wrap("num", convert(c[0]))}${wrap("den", convert(c[1]))}</m:f>`;
    }
    case "msqrt":
      return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(convertRow(c))}</m:rad>`;
    case "mroot":
      return `<m:rad>${wrap("deg", convert(c[1]))}${e(convert(c[0]))}</m:rad>`;
    case "msup":
      return `<m:sSup>${e(convert(c[0]))}${wrap("sup", convert(c[1]))}</m:sSup>`;
    case "msub":
      return `<m:sSub>${e(convert(c[0]))}${wrap("sub", convert(c[1]))}</m:sSub>`;
    case "msubsup":
      return `<m:sSubSup>${e(convert(c[0]))}${wrap("sub", convert(c[1]))}${wrap("sup", convert(c[2]))}</m:sSubSup>`;
    case "mover": {
      const top = c[1];
      const ch = top && top.localName === "mo" ? top.textContent.trim() : "";
      if (ch === "‾" || ch === "¯" || ch === "_" || (ch === "ˉ" && top.getAttribute("stretchy") === "true")) {
        return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${e(convert(c[0]))}</m:bar>`;
      }
      if (ch === "⏞" || ch === "︷") return `<m:groupChr><m:groupChrPr><m:chr m:val="⏞"/><m:pos m:val="top"/><m:vertJc m:val="bot"/></m:groupChrPr>${e(convert(c[0]))}</m:groupChr>`;
      if (ch && ACCENTS[ch] && el.getAttribute("accent") === "true") {
        return `<m:acc><m:accPr><m:chr m:val="${ACCENTS[ch]}"/></m:accPr>${e(convert(c[0]))}</m:acc>`;
      }
      if (ch && ACCENTS[ch]) return `<m:acc><m:accPr><m:chr m:val="${ACCENTS[ch]}"/></m:accPr>${e(convert(c[0]))}</m:acc>`;
      return `<m:limUpp>${e(convert(c[0]))}${wrap("lim", convert(c[1]))}</m:limUpp>`;
    }
    case "munder": {
      const bot = c[1];
      const ch = bot && bot.localName === "mo" ? bot.textContent.trim() : "";
      if (ch === "‾" || ch === "_" || ch === "¯") return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${e(convert(c[0]))}</m:bar>`;
      if (ch === "⏟" || ch === "︸") return `<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/><m:pos m:val="bot"/><m:vertJc m:val="top"/></m:groupChrPr>${e(convert(c[0]))}</m:groupChr>`;
      return `<m:limLow>${e(convert(c[0]))}${wrap("lim", convert(c[1]))}</m:limLow>`;
    }
    case "munderover":
      return `<m:limUpp>${e(`<m:limLow>${e(convert(c[0]))}${wrap("lim", convert(c[1]))}</m:limLow>`)}${wrap("lim", convert(c[2]))}</m:limUpp>`;
    case "menclose": {
      const note = el.getAttribute("notation") || "";
      if (/box|roundedbox/.test(note)) return `<m:borderBox>${e(convertRow(c))}</m:borderBox>`;
      if (/strike/.test(note)) return `<m:borderBox><m:borderBoxPr><m:hideTop m:val="1"/><m:hideBot m:val="1"/><m:hideLeft m:val="1"/><m:hideRight m:val="1"/><m:strikeBLTR m:val="1"/></m:borderBoxPr>${e(convertRow(c))}</m:borderBox>`;
      return convertRow(c);
    }
    case "mtable":
      return table(el);
    case "mtr":
    case "mlabeledtr":
    case "mtd":
      return convertRow(c);
    case "mmultiscripts":
      return convertRow(c.filter((x) => x.localName !== "mprescripts"));
    default:
      return convertRow(c);
  }
}

/** Marks the first run of an aligned cell as the alignment point (m:aln goes last in m:rPr). */
function addAlignPoint(xml) {
  const at = xml.indexOf("<m:r>");
  if (at < 0) return xml;
  const head = xml.slice(0, at + 5);
  const rest = xml.slice(at + 5);
  if (rest.startsWith("<m:rPr>")) return head + rest.replace("</m:rPr>", "<m:aln/></m:rPr>");
  return head + "<m:rPr><m:aln/></m:rPr>" + rest;
}

function table(el) {
  const rows = kids(el).filter((r) => r.localName === "mtr" || r.localName === "mlabeledtr");
  const align = (el.getAttribute("columnalign") || "").split(/\s+/);
  const ncol = Math.max(0, ...rows.map((r) => kids(r).length));
  // aligned / align: columns alternate right, left — an equation array with alignment points
  const isAligned = ncol >= 2 && align[0] === "right" && align[1] === "left";
  if (ncol <= 1 || isAligned) {
    const body = rows
      .map((r) => {
        const cells = kids(r).filter((x) => x.localName === "mtd");
        const parts = cells.map((cell, k) => {
          const inner = convertRow(kids(cell));
          return k % 2 === 1 ? addAlignPoint(inner) : inner;
        });
        // "&= …" rows: give the empty left side a normal-text space so LibreOffice/WPS
        // don't show "¿" for an "=" with nothing before it (Word ignores it)
        if (parts.length > 1 && !parts[0]) parts[0] = run(" ", { nor: true });
        return e(parts.join(""));
      })
      .join("");
    return `<m:eqArr>${body}</m:eqArr>`;
  }
  const mcs = `<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${ncol}"/><m:mcJc m:val="${align[0] === "left" ? "left" : "center"}"/></m:mcPr></m:mc></m:mcs></m:mPr>`;
  const body = rows
    .map((r) => {
      const cells = kids(r).filter((x) => x.localName === "mtd");
      while (cells.length < ncol) cells.push(null);
      return `<m:mr>${cells.map((cell) => e(cell ? convertRow(kids(cell)) : "")).join("")}</m:mr>`;
    })
    .join("");
  return `<m:m>${mcs}${body}</m:m>`;
}

/** LaTeX → "<m:oMath>…</m:oMath>" (or null if KaTeX can't parse it). */
export function latexToOmml(tex, display) {
  const k = window.katex;
  if (!k) return null;
  let mathml;
  try {
    mathml = k.renderToString(tex, { output: "mathml", displayMode: !!display, throwOnError: true, strict: "ignore", macros: { ...KATEX_MACROS } });
  } catch (err) {
    return null;
  }
  const doc = new DOMParser().parseFromString(mathml.replace(/^<span[^>]*>|<\/span>$/g, ""), "text/html");
  const math = doc.querySelector("math");
  if (!math) return null;
  return `<m:oMath>${convert(math)}</m:oMath>`;
}
