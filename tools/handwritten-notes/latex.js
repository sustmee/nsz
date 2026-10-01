/* ==========================================================================
   Notes → LaTeX (.tex), ready for Overleaf
   ========================================================================== */

import { caption, figureNumbers, inlineText } from "./md.js";

const TEXT_SYMBOLS = {
  "→": "$\\rightarrow$", "←": "$\\leftarrow$", "↔": "$\\leftrightarrow$", "⇒": "$\\Rightarrow$", "⇐": "$\\Leftarrow$", "⇔": "$\\Leftrightarrow$",
  "×": "$\\times$", "÷": "$\\div$", "±": "$\\pm$", "∓": "$\\mp$", "≈": "$\\approx$", "≠": "$\\neq$", "≤": "$\\leq$", "≥": "$\\geq$",
  "∞": "$\\infty$", "°": "$^\\circ$", "µ": "$\\mu$", "μ": "$\\mu$", "∴": "$\\therefore$", "∵": "$\\because$", "∝": "$\\propto$",
  "√": "$\\surd$", "∑": "$\\sum$", "∫": "$\\int$", "∂": "$\\partial$", "∇": "$\\nabla$", "Δ": "$\\Delta$", "∆": "$\\Delta$",
  "α": "$\\alpha$", "β": "$\\beta$", "γ": "$\\gamma$", "δ": "$\\delta$", "ε": "$\\varepsilon$", "θ": "$\\theta$", "λ": "$\\lambda$",
  "π": "$\\pi$", "ρ": "$\\rho$", "σ": "$\\sigma$", "τ": "$\\tau$", "φ": "$\\phi$", "ω": "$\\omega$", "Ω": "$\\Omega$",
  "•": "\\textbullet{}", "–": "--", "—": "---", "…": "\\ldots{}", "“": "``", "”": "''", "‘": "`", "’": "'", "☐": "$\\square$", "☑": "$\\boxtimes$", "⚠": "(!)",
};

function escText(s) {
  return String(s)
    .replace(/[\\{}$&#^_%~]/g, (c) => ({ "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#", "^": "\\^{}", _: "\\_", "%": "\\%", "~": "\\textasciitilde{}" })[c])
    .replace(/[\u0964\u0965]/g, (c) => `\\foreignlanguage{bengali}{${c}}`) // the Bangla full stop lives outside the Bengali block
    .replace(/[→←↔⇒⇐⇔×÷±∓≈≠≤≥∞°µμ∴∵∝√∑∫∂∇Δ∆αβγδεθλπρστφωΩ•–—…“”‘’☐☑⚠]/g, (c) => TEXT_SYMBOLS[c] || c);
}

function inl(list, o) {
  return (list || [])
    .map((x) => {
      switch (x.t) {
        case "text": return escText(x.v);
        case "b": return `\\textbf{${inl(x.c, o)}}`;
        case "i": return `\\emph{${inl(x.c, o)}}`;
        case "s": return `\\sout{${inl(x.c, o)}}`;
        case "mark": return `\\hl{${inl(x.c, o)}}`;
        case "code": return `\\texttt{${escText(x.v)}}`;
        case "math": return x.display ? `\\[ ${x.tex} \\]` : `$${x.tex}$`;
        case "br": return "\\\\\n";
        case "unsure": return o.unsure === "highlight" ? `\\unsure{${escText(x.v)}}` : escText(x.v);
        case "link": return /^https?:/i.test(x.href) ? `\\href{${x.href.replace(/[%#]/g, "\\$&")}}{${inl(x.c, o)}}` : inl(x.c, o);
        case "img": return `[${escText(x.alt || "image")}]`;
        default: return "";
      }
    })
    .join("");
}

const isEnv = (tex) => /^\\begin\{(equation|align|gather|multline|eqnarray|alignat)\*?\}/.test(tex.trim());

function blocks(list, o, depth = 0) {
  return list.map((b) => block(b, o, depth)).filter(Boolean).join("\n\n");
}

function block(b, o, depth) {
  switch (b.t) {
    case "page": return o.pageBreaks && b.n > o.firstPage ? "\\clearpage" : `% --- page ${b.n} ---`;
    case "heading": {
      const cmd = ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "subparagraph"][b.level - 1];
      return `\\${cmd}*{${inl(b.inl, o)}}`;
    }
    case "para": return inl(b.inl, o);
    case "math": return isEnv(b.tex) ? b.tex.trim() : `\\[\n${b.tex.trim()}\n\\]`;
    case "code": return `\\begin{verbatim}\n${b.text}\n\\end{verbatim}`;
    case "hr": return "\\noindent\\rule{\\linewidth}{0.4pt}";
    case "quote": return `\\begin{notebox}\n${blocks(b.blocks, o, depth)}\n\\end{notebox}`;
    case "list": {
      const env = b.ordered ? "enumerate" : "itemize";
      const start = b.ordered && b.start > 1 ? `[start=${b.start}]` : "";
      const items = b.items
        .map((it) => {
          const mark = it.checked == null ? "\\item " : it.checked ? "\\item[$\\boxtimes$] " : "\\item[$\\square$] ";
          return mark + blocks(it.blocks, o, depth + 1);
        })
        .join("\n");
      return `\\begin{${env}}${start}\n${items}\n\\end{${env}}`;
    }
    case "table": {
      const spec = b.align.map((a) => (a === "center" ? "c" : a === "right" ? "r" : "l")).join(" ");
      const row = (r) => r.map((c) => inl(c, o)).join(" & ") + " \\\\";
      return `\\begin{center}\n\\begin{tabular}{${spec}}\n\\toprule\n${row(b.head.map((c) => [{ t: "b", c }]))}\n\\midrule\n${b.rows.map(row).join("\n")}\n\\bottomrule\n\\end{tabular}\n\\end{center}`;
    }
    case "figure": {
      const file = o.figureFile ? o.figureFile(b) : null;
      const cap = escText(caption(b.alt));
      if (!file) return `% Figure: ${cap} (image not available)`;
      return `\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\linewidth,height=0.4\\textheight,keepaspectratio]{${file}}\n\\caption{${cap}}\n\\end{figure}`;
    }
    default: return "";
  }
}

/**
 * opts: { title, subtitle, author, date, paper, pageBreaks, unsure, figureFile(block) → "figures/fig1.png" }
 */
export function buildLatex(ast, opts = {}) {
  const firstPage = (ast.find((b) => b.t === "page") || { n: 1 }).n;
  const o = { ...opts, firstPage };
  const body = blocks(ast, o);
  const all = inlineText(ast.flatMap((b) => b.inl || [])) + body;
  const bangla = /[\u0980-\u09FF\u0964\u0965]/.test(all);
  const lines = [
    "% Created with NSZ Toolkit — Handwritten Notes → Text",
    bangla ? "% This file contains Bangla text: compile it with LuaLaTeX (Overleaf: Menu → Compiler → LuaLaTeX)." : "% Compile with pdfLaTeX (default on Overleaf).",
    `\\documentclass[11pt,${opts.paper === "letter" ? "letterpaper" : "a4paper"}]{article}`,
    bangla ? "\\usepackage{fontspec}\n\\usepackage[english]{babel}\n\\babelprovide[import, onchar=ids fonts]{bengali}\n\\babelfont{rm}{Latin Modern Roman}\n\\babelfont[bengali]{rm}[Renderer=HarfBuzz]{FreeSerif}" : "\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}",
    "\\usepackage[margin=2.2cm]{geometry}",
    "\\usepackage{amsmath,amssymb,mathtools,bm}",
    "\\usepackage{graphicx,booktabs,enumitem,xcolor}",
    "\\IfFileExists{ulem.sty}{\\usepackage[normalem]{ulem}}{}\\providecommand{\\sout}[1]{#1}",
    "\\usepackage[most]{tcolorbox}",
    "\\usepackage[hidelinks]{hyperref}",
    "\\newtcolorbox{notebox}{enhanced,breakable,colback=blue!3,colframe=blue!45!black,boxrule=0pt,leftrule=3pt,arc=2pt,left=8pt,right=8pt,top=4pt,bottom=4pt}",
    "\\newcommand{\\unsure}[1]{\\colorbox{yellow!40}{#1}}",
    "\\newcommand{\\hl}[1]{\\colorbox{yellow!50}{#1}}",
    "\\providecommand{\\R}{\\mathbb{R}}\\providecommand{\\N}{\\mathbb{N}}\\providecommand{\\Z}{\\mathbb{Z}}\\providecommand{\\Q}{\\mathbb{Q}}\\providecommand{\\C}{\\mathbb{C}}\\providecommand{\\degree}{^\\circ}",
    "\\setlength{\\parskip}{0.5em}\\setlength{\\parindent}{0pt}",
    "",
  ];
  if (opts.title) lines.push(`\\title{${escText(opts.title)}${opts.subtitle ? `\\\\[0.3em]\\large ${escText(opts.subtitle)}` : ""}}`);
  lines.push(`\\author{${escText(opts.author || "")}}`, `\\date{${escText(opts.date || "")}}`, "", "\\begin{document}");
  if (opts.title) lines.push("\\maketitle");
  lines.push("", body, "", "\\end{document}", "");
  return lines.join("\n");
}
