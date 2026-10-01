/* ==========================================================================
   Cleaned page photos → one "scanned" PDF (one JPEG per A4 / Letter page)
   ========================================================================== */

const enc = new TextEncoder();

/**
 * pages: [{ jpeg: Uint8Array, w, h }]   paper: "a4" | "letter"
 * Each image is fitted inside the page (portrait or landscape to match it).
 */
export function imagesToPdf(pages, paper = "a4", title = "Notes") {
  const P = paper === "letter" ? [612, 792] : [595.28, 841.89];
  const parts = [];
  const offsets = [];
  let length = 0;
  const add = (chunk) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    add(`${n} 0 obj\n`);
    body();
    add("\nendobj\n");
  };

  add("%PDF-1.4\n%âãÏÓ\n");
  const nPages = pages.length;
  // object numbers: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const pageObj = (i) => 4 + i * 3;
  obj(1, () => add("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => add(`<< /Type /Pages /Count ${nPages} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`));
  const safeTitle = String(title).replace(/[^\x20-\x7e]/g, "").replace(/[()\\]/g, "\\$&");
  obj(3, () => add(`<< /Title (${safeTitle}) /Producer (NSZ Toolkit) >>`));

  pages.forEach((pg, i) => {
    const landscape = pg.w > pg.h;
    const [W, H] = landscape ? [P[1], P[0]] : P;
    const s = Math.min(W / pg.w, H / pg.h);
    const dw = pg.w * s;
    const dh = pg.h * s;
    const x = (W - dw) / 2;
    const y = (H - dh) / 2;
    const n = pageObj(i);
    obj(n, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`));
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
    obj(n + 1, () => add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(n + 2, () => {
      add(`<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
      add(pg.jpeg);
      add("\nendstream");
    });
  });

  const count = 4 + nPages * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let k = 1; k < count; k++) table += `${String(offsets[k]).padStart(10, "0")} 00000 n \n`;
  add(table);
  add(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
