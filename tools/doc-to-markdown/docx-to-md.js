/* ==========================================================================
   Word (.docx) → Markdown converter
   Uses mammoth (docx → HTML) and turndown (HTML → Markdown), loaded as
   classic scripts on the page (window.mammoth, window.TurndownService,
   window.turndownPluginGfm).
   ========================================================================== */

const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Caption'] => p.caption:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
  "r[style-name='Code'] => code",
  "p[style-name='Code'] => pre:separator('\\n')",
];

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png")
  );
}

/** Convert any browser-decodable image to PNG. Returns null if the browser can't decode it. */
async function toPng(buffer, contentType) {
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: contentType }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close && bitmap.close();
    return { blob: await canvasToBlob(canvas), width: canvas.width, height: canvas.height };
  } catch (e) {
    return null;
  }
}

const EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
  "image/emf": "emf",
  "image/wmf": "wmf",
};

/** Mammoth emits tables without header rows; GFM tables need one. */
function prepareHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const table of doc.querySelectorAll("table")) {
    const first = table.querySelector("tr");
    if (!first) continue;
    // Nested tables and merged cells can't be expressed in Markdown — keep as HTML.
    if (table.querySelector("table") || table.querySelector("[colspan],[rowspan]")) continue;
    for (const td of [...first.children]) {
      if (td.tagName === "TD") {
        const th = doc.createElement("th");
        th.innerHTML = td.innerHTML;
        td.replaceWith(th);
      }
    }
    // Paragraphs inside cells would break the one-line-per-row table format.
    for (const cell of table.querySelectorAll("td, th")) {
      const parts = [...cell.querySelectorAll(":scope > p")];
      if (parts.length) cell.innerHTML = parts.map((p) => p.innerHTML).join("<br>");
    }
  }
  // Empty anchors mammoth adds for bookmarks just add noise.
  for (const a of doc.querySelectorAll("a[id]:not([href])")) {
    if (!a.textContent.trim()) a.remove();
  }
  return doc.body.innerHTML;
}

function makeTurndown() {
  const td = new window.TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
  });
  if (window.turndownPluginGfm) td.use(window.turndownPluginGfm.gfm);
  td.keep(["sub", "sup"]);
  td.addRule("caption", {
    filter: (node) => node.nodeName === "P" && node.classList.contains("caption"),
    replacement: (content) => `\n\n*${content.trim()}*\n\n`,
  });
  return td;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {{figurePrefix?:string}} options
 * @param {(fraction:number, message:string)=>void} onProgress
 */
export async function convertDocx(arrayBuffer, options = {}, onProgress = () => {}) {
  if (!window.mammoth || !window.TurndownService) throw new Error("Converter libraries failed to load. Please refresh the page.");
  const prefix = options.figurePrefix || "fig";
  const figures = [];
  const warnings = [];
  let n = 0;

  onProgress(0.1, "Reading Word document…");

  const convertImage = window.mammoth.images.imgElement(async (image) => {
    n++;
    const index = n;
    onProgress(Math.min(0.8, 0.2 + index * 0.03), `Extracting figure ${index}…`);
    const buffer = await image.readAsArrayBuffer();
    const type = (image.contentType || "").toLowerCase();
    const png = await toPng(buffer, type);
    let name;
    let fig;
    if (png) {
      name = `${prefix}${index}.png`;
      fig = { name, blob: png.blob, width: png.width, height: png.height };
    } else {
      // e.g. EMF/WMF drawings, which browsers can't decode — keep the original file.
      const ext = EXT[type] || (type.split("/")[1] || "bin").replace(/^x-/, "");
      name = `${prefix}${index}.${ext}`;
      fig = { name, blob: new Blob([buffer], { type: type || "application/octet-stream" }), width: 0, height: 0, original: true };
      warnings.push(`${name} is a ${ext.toUpperCase()} image that browsers can't convert to PNG, so it was saved in its original format.`);
    }
    fig.caption = image.altText || "";
    fig.order = index;
    figures.push(fig);
    return { src: `figures/${name}`, alt: image.altText || `Figure ${index}` };
  });

  let result;
  try {
    result = await window.mammoth.convertToHtml({ arrayBuffer }, { convertImage, styleMap: STYLE_MAP });
  } catch (e) {
    throw new Error("This file could not be read as a Word (.docx) document. It may be damaged or in the old .doc format.");
  }

  onProgress(0.85, "Writing Markdown…");
  const html = prepareHtml(result.value);
  let markdown = makeTurndown().turndown(html);

  // Tidy up: single space after list markers, collapse blank lines, drop trailing spaces.
  markdown = markdown
    .replace(/^(\s*)(-|\d+\.) {2,}/gm, "$1$2 ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";

  // Use a "Figure N: …" caption right below an image as its alt text.
  markdown = markdown.replace(
    /!\[Figure \d+\]\((figures\/[^)]+)\)(\n\n[*_]?((?:Fig(?:ure)?\.?)\s*\d+[^\n]*?)[*_]?\n)/g,
    (m, src, rest, cap) => `![${cap.replace(/[[\]*_]/g, "").slice(0, 120)}](${src})${rest}`
  );

  figures.sort((a, b) => a.order - b.order);
  const words = markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  onProgress(1, "Done");
  return { markdown, figures, pages: [], stats: { pages: null, words, figures: figures.length }, warnings };
}
