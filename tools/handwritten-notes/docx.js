/* ==========================================================================
   Notes → Word (.docx)

   Writes the Office Open XML by hand (a .docx is a ZIP of XML files) with the
   bundled JSZip. Headings, lists, tables, callout boxes, figures with
   captions, page numbers — and equations as native, editable Word equations.
   ========================================================================== */

import { inlineText, caption, figureNumbers } from "./md.js";
import { latexToOmml } from "./omml.js";

const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Characters Word refuses inside XML text
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

const PAPER = { a4: { w: 11906, h: 16838 }, letter: { w: 12240, h: 15840 } };
const MARGIN = 1247; // 2.2 cm
const EMU_PER_TWIP = 635;

const THEMES = {
  serif: { body: "Cambria", head: "Calibri", accent: "4338CA" },
  sans: { body: "Calibri", head: "Calibri", accent: "4338CA" },
  times: { body: "Times New Roman", head: "Times New Roman", accent: "1F2937" },
};

const CALLOUT = {
  def: { border: "4F46E5", fill: "EEF0FF" },
  thm: { border: "7C3AED", fill: "F4EEFF" },
  ex: { border: "0EA5A4", fill: "E8F8F6" },
  warn: { border: "D97706", fill: "FFF5E5" },
  note: { border: "2563EB", fill: "EAF2FF" },
  plain: { border: "9CA3AF", fill: "F5F6F8" },
};

function calloutKind(blocks) {
  const first = blocks[0];
  const lead = first && first.t === "para" && first.inl[0] && first.inl[0].t === "b" ? inlineText(first.inl[0].c).toLowerCase() : "";
  if (/defin/.test(lead)) return "def";
  if (/theorem|law|lemma|principle|rule/.test(lead)) return "thm";
  if (/example|ex\b|problem|exercise/.test(lead)) return "ex";
  if (/check|warning|caution|⚠|mistake/.test(lead)) return "warn";
  if (/note|remember|important|tip|remark/.test(lead)) return "note";
  return "plain";
}

class Writer {
  constructor(opts, ctx) {
    this.opts = opts;
    this.ctx = ctx;
    this.rels = []; // { id, type, target, mode }
    this.media = []; // { name, data }
    this.nums = []; // { id, abstract, start, level }
    this.nextRel = 10;
    this.nextNum = 3;
    this.docPr = 1;
    const paper = PAPER[opts.paper] || PAPER.a4;
    this.textWidth = paper.w - 2 * MARGIN;
  }

  rel(type, target, external) {
    const id = `rId${this.nextRel++}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  /* ---------- Inline ---------- */

  runs(inl, fmt = {}) {
    let out = "";
    for (const x of inl || []) {
      switch (x.t) {
        case "text": out += this.textRun(x.v, fmt); break;
        case "b": out += this.runs(x.c, { ...fmt, b: true }); break;
        case "i": out += this.runs(x.c, { ...fmt, i: true }); break;
        case "s": out += this.runs(x.c, { ...fmt, s: true }); break;
        case "mark": out += this.runs(x.c, { ...fmt, mark: "yellow" }); break;
        case "code": out += this.textRun(x.v, { ...fmt, code: true }); break;
        case "br": out += "<w:r><w:br/></w:r>"; break;
        case "unsure": out += this.textRun(x.v, this.opts.unsure === "highlight" ? { ...fmt, mark: "yellow" } : fmt); break;
        case "math": {
          const omml = latexToOmml(x.tex, false);
          out += omml || this.textRun(`$${x.tex}$`, { ...fmt, code: true });
          break;
        }
        case "link": {
          if (/^https?:|^mailto:/i.test(x.href)) {
            const id = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", x.href, true);
            out += `<w:hyperlink r:id="${id}" w:history="1">${this.runs(x.c, { ...fmt, link: true })}</w:hyperlink>`;
          } else out += this.runs(x.c, fmt);
          break;
        }
        case "img": out += this.textRun(`[${x.alt || "image"}]`, { ...fmt, i: true }); break;
        default: break;
      }
    }
    return out;
  }

  textRun(text, f) {
    if (!text) return "";
    const pr = [];
    if (f.link) pr.push('<w:rStyle w:val="Hyperlink"/>');
    if (f.code) pr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
    if (f.b) pr.push("<w:b/><w:bCs/>");
    if (f.i) pr.push("<w:i/><w:iCs/>");
    if (f.s) pr.push("<w:strike/>");
    if (f.color) pr.push(`<w:color w:val="${f.color}"/>`);
    if (f.size) pr.push(`<w:sz w:val="${f.size}"/><w:szCs w:val="${f.size}"/>`);
    if (f.mark) pr.push(`<w:highlight w:val="${f.mark}"/>`);
    if (f.code) pr.push('<w:shd w:val="clear" w:color="auto" w:fill="F1F2F6"/>');
    const rPr = pr.length ? `<w:rPr>${pr.join("")}</w:rPr>` : "";
    return `<w:r>${rPr}<w:t xml:space="preserve">${xe(clean(text))}</w:t></w:r>`;
  }

  /* ---------- Blocks ---------- */

  para(body, { style, jc, numId, ilvl, ind, keepNext, extra } = {}) {
    const pr = [];
    if (style) pr.push(`<w:pStyle w:val="${style}"/>`);
    if (keepNext) pr.push("<w:keepNext/>");
    if (numId != null) pr.push(`<w:numPr><w:ilvl w:val="${ilvl || 0}"/><w:numId w:val="${numId}"/></w:numPr>`);
    if (extra) pr.push(extra);
    if (ind != null) pr.push(`<w:ind w:left="${ind}"/>`);
    if (jc) pr.push(`<w:jc w:val="${jc}"/>`);
    return `<w:p>${pr.length ? `<w:pPr>${pr.join("")}</w:pPr>` : ""}${body}</w:p>`;
  }

  async blocks(list, env = {}) {
    let out = "";
    for (const b of list) out += await this.block(b, env);
    return out;
  }

  quoteExtra(env) {
    if (!env.callout) return "";
    const c = CALLOUT[env.callout];
    return `<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${c.border}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>`;
  }

  async block(b, env) {
    const ind = env.ind;
    const extra = this.quoteExtra(env);
    switch (b.t) {
      case "page": {
        if (!this.opts.pageBreaks || this.firstPageSeen === undefined) { this.firstPageSeen = true; return ""; }
        return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
      case "heading": {
        const level = Math.min(4, b.level);
        return this.para(this.runs(b.inl), { style: `Heading${level}`, keepNext: true });
      }
      case "para":
        return this.para(this.runs(b.inl), { style: env.callout ? "CalloutText" : undefined, ind, extra });
      case "math": {
        const omml = latexToOmml(b.tex, true);
        const body = omml ? `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>${omml}</m:oMathPara>` : this.textRun(b.tex, { code: true });
        return this.para(body, { style: env.callout ? "CalloutEquation" : "Equation", ind, extra });
      }
      case "code":
        return b.text
          .split("\n")
          .map((l) => this.para(this.textRun(l || " ", { code: true }), { style: "Code", ind }))
          .join("");
      case "hr":
        return this.para("", { style: "Divider" });
      case "quote": {
        const kind = env.callout || calloutKind(b.blocks);
        const inner = await this.blocks(b.blocks, { ...env, callout: kind });
        // a small spacer keeps two callouts in a row from merging into one box
        return inner + this.para("", { style: "Spacer" });
      }
      case "list":
        return this.list(b, env, env.level || 0);
      case "table":
        return this.table(b);
      case "figure":
        return this.figure(b);
      default:
        return "";
    }
  }

  async list(b, env, level) {
    let numId = 1;
    if (b.ordered) {
      numId = this.nextNum++;
      this.nums.push({ id: numId, abstract: 2, start: b.start || 1, level });
    } else if (b.items.some((it) => it.checked != null)) {
      numId = 2; // check boxes
    }
    let out = "";
    for (const it of b.items) {
      const [first, ...rest] = it.blocks;
      let firstXml;
      const prefix = it.checked != null ? this.textRun(it.checked ? "☑ " : "☐ ", {}) : "";
      if (first && first.t === "para") {
        firstXml = this.para(prefix + this.runs(first.inl), { style: "ListParagraph", numId: it.checked != null ? null : numId, ilvl: level, ind: it.checked != null ? 360 + level * 360 : undefined, extra: this.quoteExtra(env) });
      } else {
        firstXml = this.para(prefix, { style: "ListParagraph", numId: it.checked != null ? null : numId, ilvl: level, extra: this.quoteExtra(env) });
        if (first) rest.unshift(first);
      }
      out += firstXml;
      for (const sub of rest) {
        if (sub.t === "list") out += await this.list(sub, env, Math.min(level + 1, 5));
        else out += await this.block(sub, { ...env, ind: 720 + level * 360, level: level + 1 });
      }
    }
    return out;
  }

  table(b) {
    const cols = b.head.length;
    const w = Math.floor(this.textWidth / cols);
    const cell = (inl, k, head) => {
      const jc = b.align[k] === "center" ? "center" : b.align[k] === "right" ? "right" : null;
      const shade = head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF0FA"/>' : "";
      const body = this.runs(inl, head ? { b: true } : {});
      return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shade}</w:tcPr>${this.para(body, { style: "TableText", jc })}</w:tc>`;
    };
    const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`;
    const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.head.map((c, k) => cell(c, k, true)).join("")}</w:tr>`;
    const rows = b.rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, k) => cell(c, k, false)).join("")}</w:tr>`).join("");
    const pr = `<w:tblPr><w:tblStyle w:val="NotesTable"/><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
    return `<w:tbl>${pr}${grid}${head}${rows}</w:tbl>` + this.para("", { style: "Spacer" });
  }

  async figure(b) {
    const no = this.figNo.get(b);
    const cap = caption(b.alt);
    const img = this.ctx.getImage ? await this.ctx.getImage(b.src) : null;
    const capXml = this.para(this.textRun(`Figure ${no}. `, { b: true }) + this.textRun(cap, {}), { style: "Caption" });
    if (!img) return this.para(this.textRun(`[Figure ${no}: ${cap}]`, { i: true }), { style: "Caption" });
    const name = `image${this.media.length + 1}.${img.ext}`;
    this.media.push({ name, data: img.data });
    const id = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `media/${name}`);
    // Fit inside the text width and ~10 cm tall
    const maxW = this.textWidth * EMU_PER_TWIP * 0.9;
    const maxH = 5669 * EMU_PER_TWIP;
    const scale = Math.min(maxW / img.w, maxH / img.h, 9525 * 1.5); // never more than 1.5× native (96 dpi → EMU)
    const cx = Math.round(img.w * scale);
    const cy = Math.round(img.h * scale);
    const n = this.docPr++;
    const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${n}" name="Figure ${no}" descr="${xe(clean(cap))}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    return this.para(drawing, { style: "FigurePara", keepNext: true }) + capXml;
  }

  titleBlock() {
    const o = this.opts;
    let out = "";
    if (o.title) out += this.para(this.textRun(o.title, {}), { style: "Title" });
    if (o.subtitle) out += this.para(this.textRun(o.subtitle, {}), { style: "Subtitle" });
    const meta = [o.author, o.date].filter(Boolean).join("   ·   ");
    if (meta) out += this.para(this.textRun(meta, {}), { style: "Meta" });
    if (out) out += this.para("", { style: "Divider" });
    return out;
  }
}

/* ---------- Static parts ---------- */

function stylesXml(theme) {
  const t = THEMES[theme] || THEMES.serif;
  const fonts = (f) => `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="Nirmala UI"/>`;
  const head = (id, name, size, color, before, after, outline) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}" w:line="259" w:lineRule="auto"/><w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr>${fonts(t.head)}<w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${fonts(t.body)}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="bn-BD"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="1F2330"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr><w:rPr>${fonts(t.head)}<w:b/><w:color w:val="111827"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr>${fonts(t.head)}<w:color w:val="${t.accent}"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Meta"><w:name w:val="Meta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="6B7280"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
${head("Heading1", "heading 1", 32, t.accent, 360, 120, 0)}
${head("Heading2", "heading 2", 27, "1F2937", 280, 100, 1)}
${head("Heading3", "heading 3", 24, "374151", 220, 80, 2)}
${head("Heading4", "heading 4", 22, "4B5563", 200, 60, 3)}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Equation"><w:name w:val="Equation"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="120"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CalloutEquation"><w:name w:val="Callout Equation"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="60" w:after="60"/><w:ind w:left="240" w:right="240"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="CalloutText"><w:name w:val="Callout Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:ind w:left="240" w:right="240"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Spacer"><w:name w:val="Spacer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr><w:rPr><w:sz w:val="8"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F2F6"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40" w:line="252" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="FigurePara"><w:name w:val="Figure"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="4B5563"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Divider"><w:name w:val="Divider"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D1D5DB"/></w:pBdr><w:spacing w:after="200"/></w:pPr><w:rPr><w:sz w:val="8"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="9CA3AF"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2563EB"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:customStyle="1" w:styleId="NotesTable"><w:name w:val="Notes Table"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="C7CBD6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="C7CBD6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="C7CBD6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="C7CBD6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="C7CBD6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="C7CBD6"/></w:tblBorders><w:tblCellMar><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
}

function numberingXml(nums) {
  const bullets = ["•", "◦", "▪", "•", "◦", "▪"];
  const fmts = ["decimal", "lowerLetter", "lowerRoman", "decimal", "lowerLetter", "lowerRoman"];
  const lvl = (k, fmt, text, font) =>
    `<w:lvl w:ilvl="${k}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + k * 360}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ""}</w:lvl>`;
  const bulletAbs = `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${bullets.map((b, k) => lvl(k, "bullet", b, "Calibri")).join("")}</w:abstractNum>`;
  const orderedAbs = `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>${fmts.map((f, k) => lvl(k, f, `%${k + 1}.`)).join("")}</w:abstractNum>`;
  const checkAbs = `<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="hybridMultilevel"/>${bullets.map((_, k) => lvl(k, "none", "", null)).join("")}</w:abstractNum>`;
  const inst = nums
    .map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.abstract}"/><w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride></w:num>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${bulletAbs}${orderedAbs}${checkAbs}<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="3"/></w:num>${inst}</w:numbering>`;
}

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function footerXml(title) {
  const t = title ? `<w:r><w:t xml:space="preserve">${xe(clean(title))}   ·   </w:t></w:r>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${t}<w:r><w:t xml:space="preserve">Page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
}

/**
 * ast:  parse() output
 * opts: { title, subtitle, author, date, theme: serif|sans|times, paper: a4|letter, pageBreaks, unsure: plain|highlight }
 * ctx:  { getImage(src) → Promise<{ data: Uint8Array, w, h, ext } | null> }
 */
export async function buildDocx(ast, opts = {}, ctx = {}) {
  if (!window.JSZip) throw new Error("The Word writer failed to load. Please refresh the page.");
  const w = new Writer(opts, ctx);
  w.figNo = figureNumbers(ast);
  const body = w.titleBlock() + (await w.blocks(ast));
  const paper = PAPER[opts.paper] || PAPER.a4;
  const footerId = "rId4";
  const sect = `<w:sectPr><w:footerReference w:type="default" r:id="${footerId}"/><w:pgSz w:w="${paper.w}" w:h="${paper.h}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/><w:cols w:space="708"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body || "<w:p/>"}${sect}</w:body></w:document>`;

  const zip = new window.JSZip();
  const hasPng = w.media.some((m) => m.name.endsWith(".png"));
  const hasJpg = w.media.some((m) => m.name.endsWith(".jpg"));
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasPng ? '<Default Extension="png" ContentType="image/png"/>' : ""}${hasJpg ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : ""}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(clean(opts.title || "Notes"))}</dc:title><dc:creator>${xe(clean(opts.author || "NSZ Toolkit"))}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NSZ Toolkit — Handwritten Notes</Application></Properties>`
  );
  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
    `<Relationship Id="${footerId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`,
    ...w.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xe(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`),
  ];
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  zip.file("word/document.xml", document);
  zip.file("word/styles.xml", stylesXml(opts.theme));
  zip.file("word/numbering.xml", numberingXml(w.nums));
  zip.file("word/footer1.xml", footerXml(opts.title));
  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
  );
  for (const m of w.media) zip.file(`word/media/${m.name}`, m.data);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}
