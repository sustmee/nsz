# NSZ Toolkit

Free, private, in-browser tools for students, built by **Nafis Sadik Zim**, Lecturer, SUST.

Everything runs in the visitor's browser. Files are never uploaded, so there is no server
to pay for or maintain. The whole site is static HTML/CSS/JS with **no build step**.

## Tools

| Tool | What it does |
| --- | --- |
| [PDF / Word → Markdown](tools/doc-to-markdown/) | Converts a PDF or `.docx` file into a `.md` file and saves every figure as `fig1.png`, `fig2.png`, … Downloads everything as one ZIP. |
| [Plot Digitizer & Compare](tools/plot-digitizer/) | Extracts data points from a published figure (axes, ticks and curve colours detected automatically) and compares them with your own results — a data file or another figure — on one chart, with error metrics. |
| [MD Paper → LAMMPS Input](tools/paper-to-lammps/) | Reads a molecular dynamics paper, lists its simulation parameters (each linked to its source sentence) and writes a commented starter LAMMPS input script. |

### PDF / Word → Markdown: what it handles

- **Word (.docx):** headings, bold/italic, bulleted and numbered lists, tables, links, footnotes and images.
  Images are converted to PNG. EMF/WMF drawings are kept in their original format because browsers can't decode them.
- **PDF:** rebuilds the text from its layout. It detects:
  - headings (by font size and bold text), paragraphs, bulleted and numbered lists
  - two-column layouts (most research papers)
  - simple tables made of aligned text
  - repeated page headers, footers and page numbers (removed)
  - embedded photos and images, saved at full resolution
  - charts and diagrams drawn as vector graphics that have a "Figure N" caption (saved as a rendered PNG)
- Output ZIP:
  ```
  report.zip
  └── report/
      ├── report.md          ← contains ![Figure 1: …](figures/fig1.png)
      ├── figures/
      │   ├── fig1.png
      │   └── fig2.png
      └── pages/             ← only if "Also save every page as an image" is on
  ```
- Limits: scanned PDFs have no text layer (no OCR), old binary `.doc` files are not supported
  (save as `.docx` first), and complex PDF layouts can still need a quick manual clean-up.

### MD Paper → LAMMPS Input: what it handles

- **Input:** PDF (best), `.docx`, plain text, or pasted Methods text. A built-in sample shows how it works.
- **Finds (rule-based, in the browser):** material and elements, crystal structure, lattice constant, orientation,
  box size, number of atoms, boundary conditions, fixed/thermostat layers, defects, potential and its source/file,
  cutoff, electrostatics, software, units, time step, minimization, ensembles, thermostat/barostat and damping,
  temperature(s), pressure, equilibration and production time, output frequency, simulation type, loading direction,
  strain rate, maximum strain, heating rate, indenter size/speed/depth, Green–Kubo correlation time, PKA energy,
  plus the properties computed, analysis methods (CNA, DXA, …) and tools (OVITO, VMD, …).
- **Every value** shows the sentence and page it came from, alternatives found elsewhere in the paper, and a status:
  *Found*, *Typical* (a usual value suggested by the tool) or *Missing*. Sentences that describe *other* studies
  (Introduction, citations) are down-weighted.
- **Script generator:** builds `in.lammps` from the (editable) table. Every line is tagged `[paper]`, `[typical]` or
  `[TODO]`. It builds graphene / h-BN sheets and fcc, bcc, hcp, diamond, zinc-blende and B2 crystals directly in LAMMPS,
  and explains how to build nanotubes, MoS₂, polymers and water with VMD, ASE, Atomsk or Packmol. Templates cover
  tension/compression (stress–strain output), shear, nanoindentation, Green–Kubo and Müller-Plathe thermal
  conductivity, heating/melting, diffusion (MSD), irradiation cascades and plain production runs.
  The generated graphene-tension, copper-nanoindentation and SiC Green–Kubo scripts were test-run in LAMMPS (22 Jul 2025).
- **Downloads:** `in.lammps`, or a ZIP with the script, `parameters.csv`, `parameters.md`, the paper text and a
  ready-made prompt for a second opinion from an AI chat.
- Limits: it reads text with rules, so it can pick the wrong number — always check the sources. Values only shown in
  tables of images, or in equations, may be missed.

### Plot Digitizer & Compare: what it handles

- **Published figure** (PNG/JPG, or paste a screenshot with Ctrl+V): finds the x and y axes (also when a curve
  paints over an axis) and the tick marks — including ticks hidden in the origin corner or a frame line — and
  places the four calibration markers (X1, X2, Y1, Y2) on the outermost ticks. A zoomed preview of each marker's
  tick label is shown next to its input, so you only type the numbers. Log axes are supported.
- **Curves:** colours inside the plot are grouped automatically (blue, red, black/grey, …); one tap extracts a
  curve. Tools: *Click a curve* (picks the exact curve — useful when several share a colour), *Add / delete points*,
  *Erase area* (legends, labels), *Crop panel* (multi-panel figures), line or scatter-marker mode, number of points,
  colour tolerance. Vertical drops (e.g. fracture) keep both ends. Legend samples are ignored automatically.
  On test figures made with matplotlib the extracted points were within ~0.2 % (median) of the true curve.
- **Your results:** a data file (`.txt`, `.dat`, `.csv`; comment lines and LAMMPS-style `# x y` headers understood;
  decimal commas too), pasted numbers, or a second figure digitized the same way. Pick the x/y columns, scale units
  (a hint appears when your values are ~1000× off, with a one-click fix).
- **Comparison:** both on one chart (crosshair tooltip, legend + direct labels, light/dark), the difference curve,
  your curve drawn onto the original figure, and a table. Metrics: RMSE (also as % of the published range), R²,
  mean relative error, peak value and its x, and last x (e.g. fracture strain), with an agreement verdict.
  Downloads: chart PNG/SVG, all data CSV.
- **Just the numbers:** step *3 · Download data* inside the digitizer exports the extracted curves on their own —
  no comparison needed — as **Excel (.xlsx)** (one sheet per curve, an “All curves” sheet and an “Info” sheet with
  the calibration), **text (.txt)** (tab-separated, one block per curve, `#` header lines) or **CSV**.

## Project structure

```
index.html                  Home page (tool cards are generated from the registry)
404.html
assets/
  css/style.css             Shared design system (colours, buttons, header, footer, dark mode)
  css/home.css              Home page only
  js/site.js                Shared header/footer, theme toggle, helpers (window.NSZ)
  js/tools-registry.js      ← the list of tools shown on the home page
  js/home.js                Search + category filters on the home page
  img/favicon.svg
  vendor/                   Third-party libraries (pdf.js, mammoth, turndown, marked, JSZip, DOMPurify)
tools/
  _template/                Copy this to start a new tool
  doc-to-markdown/          PDF / Word → Markdown tool
    index.html  tool.css  app.js  pdf-to-md.js  docx-to-md.js
  plot-digitizer/           Plot Digitizer & Compare tool
    digitizer-core.js       axis/tick/colour detection and curve extraction (no DOM; runs in Node too)
    digitizer-ui.js         the interactive digitizer (used for the published figure and for yours)
    compare.js              data-file parsing, interpolation, error metrics
    chart.js                SVG comparison chart with crosshair tooltip and PNG/SVG export
  paper-to-lammps/          MD Paper → LAMMPS Input tool (reuses the PDF reader above)
    index.html  tool.css  app.js
    data.js                 materials, potentials, masses, keywords
    extractor.js            text → parameters (no DOM; runs in Node too)
    script-gen.js           parameters → in.lammps (no DOM; runs in Node too)
```

## Adding a new tool

1. Copy `tools/_template/` to `tools/<your-tool-id>/`, for example `tools/image-compressor/`.
2. Edit the page title, heading and description in its `index.html`, then build the tool in `app.js`.
   Shared helpers: `NSZ.toast()`, `NSZ.downloadBlob()`, `NSZ.formatBytes()`.
3. Add an entry to `assets/js/tools-registry.js`:
   ```js
   {
     id: "image-compressor",
     name: "Image Compressor",
     description: "Shrink JPG/PNG images without visible quality loss.",
     href: "tools/image-compressor/index.html",
     category: "Images",          // categories become filter chips once there are 2+
     tags: ["jpg", "png", "compress"],
     icon: "image",               // a key from TOOL_ICONS, or raw <svg> markup
     badge: "New",                // optional
   },
   ```
   The card, search and category filters on the home page update automatically.
   Set `comingSoon: true` to show a greyed-out preview card.

## Running locally

Any static file server works. The page must be served over `http://` (not opened as `file://`),
because the PDF engine loads as a JavaScript module:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publishing (free) with GitHub Pages

1. Merge this branch into `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the site on every push to `main`.
   The address will be `https://<github-username>.github.io/<repository-name>/`.

The site also works as-is on Netlify, Vercel, Cloudflare Pages or any ordinary web host: just upload the folder.

## Credits

Third-party libraries and their licenses are listed in [`assets/vendor/LICENSES.md`](assets/vendor/LICENSES.md).
