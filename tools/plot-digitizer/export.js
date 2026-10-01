/* ==========================================================================
   Plot digitizer — exporting digitized data (Excel .xlsx, .txt, .csv)

   series: [{ name, points: [[x, y]] }]
   meta:   { source, xLabel, yLabel, calibration: [[label, value]] }
   The .xlsx is written by hand (it is a ZIP of XML files) with the
   bundled JSZip, so no spreadsheet library is needed.
   ========================================================================== */

const num = (v) => (isFinite(v) ? +Number(v).toPrecision(8) : "");

function xmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: ≤ 31 chars, no []:*?/\ and unique. */
function sheetNames(names) {
  const used = new Set();
  return names.map((n, i) => {
    let base = String(n || `Curve ${i + 1}`).replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || `Curve ${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base.slice(0, 26)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(rows, widths) {
  // rows: array of arrays; strings become inline strings, numbers stay numbers; row 0 is bold
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          if (v === "" || v == null) return "";
          const ref = `${colName(ci)}${ri + 1}`;
          const style = ri === 0 ? ' s="1"' : "";
          if (typeof v === "number") return `<c r="${ref}"${style}><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const freeze = '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** Builds an .xlsx: one sheet per curve, an "All curves" sheet side by side, and an "Info" sheet. */
export async function toXlsx(series, meta = {}) {
  if (!window.JSZip) throw new Error("The spreadsheet writer failed to load. Please refresh the page.");
  const xl = meta.xLabel || "x";
  const yl = meta.yLabel || "y";
  const sheets = [];
  const names = sheetNames(series.map((s) => s.name));
  series.forEach((s, i) => {
    sheets.push({ name: names[i], xml: sheetXml([[xl, yl], ...s.points.map(([x, y]) => [num(x), num(y)])], [16, 16]) });
  });
  if (series.length > 1) {
    const header = series.flatMap((s) => [`${s.name} – ${xl}`, `${s.name} – ${yl}`]);
    const n = Math.max(...series.map((s) => s.points.length));
    const rows = [header];
    for (let r = 0; r < n; r++) rows.push(series.flatMap((s) => (s.points[r] ? [num(s.points[r][0]), num(s.points[r][1])] : ["", ""])));
    sheets.push({ name: "All curves", xml: sheetXml(rows, header.map(() => 22)) });
  }
  const info = [
    ["Item", "Value"],
    ["Digitized from", meta.source || ""],
    ["Created", new Date().toISOString().slice(0, 16).replace("T", " ")],
    ["Tool", "NSZ Toolkit — Plot Digitizer"],
    ["x-axis", xl],
    ["y-axis", yl],
    ...(meta.calibration || []),
    ...series.map((s) => [`Points in “${s.name}”`, s.points.length]),
  ];
  sheets.push({ name: "Info", xml: sheetXml(info, [28, 40]) });

  const zip = new window.JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", compression: "DEFLATE" });
}

/** Tab-separated text; curves separated by two blank lines (gnuplot "index" blocks), # comments. */
export function toTxt(series, meta = {}) {
  const xl = meta.xLabel || "x";
  const yl = meta.yLabel || "y";
  const lines = [`# Digitized with NSZ Toolkit — Plot Digitizer`, `# Source: ${meta.source || ""}`];
  for (const [k, v] of meta.calibration || []) lines.push(`# ${k}: ${v}`);
  series.forEach((s, i) => {
    if (i) lines.push("", "");
    lines.push(`# Curve: ${s.name} (${s.points.length} points)`, `# ${xl}\t${yl}`);
    for (const [x, y] of s.points) lines.push(`${num(x)}\t${num(y)}`);
  });
  return lines.join("\n") + "\n";
}

/** Comma-separated, curves side by side. */
export function toCsv(series, meta = {}) {
  const xl = meta.xLabel || "x";
  const yl = meta.yLabel || "y";
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const header = series.flatMap((s) => [`${s.name} – ${xl}`, `${s.name} – ${yl}`]);
  const n = Math.max(0, ...series.map((s) => s.points.length));
  const rows = [header.map(cell).join(",")];
  for (let r = 0; r < n; r++) rows.push(series.flatMap((s) => (s.points[r] ? [num(s.points[r][0]), num(s.points[r][1])] : ["", ""])).join(","));
  return "﻿" + rows.join("\r\n"); // BOM so Excel opens UTF-8 names correctly
}
