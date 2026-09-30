/* ==========================================================================
   Tool registry — the single list of tools shown on the home page.

   To add a new tool:
     1. Copy the folder tools/_template/ to tools/<your-tool-id>/
     2. Build the tool inside that folder.
     3. Add an entry to the TOOLS array below.
   The home page (cards, search and category filters) updates automatically.

   Fields:
     id          unique id, also the folder name under tools/
     name        title shown on the card
     description one or two sentences
     href        link relative to the site root
     category    used for the filter chips on the home page
     tags        extra keywords for search (shown as small tags)
     icon        a key from TOOL_ICONS below (or raw <svg> markup)
     color       optional [from, to] gradient for the icon tile
     badge       optional short label, e.g. "New" or "Popular"
     comingSoon  optional; true shows a disabled "coming soon" card
   ========================================================================== */

window.TOOL_ICONS = {
  "doc-to-md":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M7.5 17v-4l2 2 2-2v4"/><path d="M15.5 13v4m0 0-1.5-1.5m1.5 1.5 1.5-1.5"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>',
  calculator:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>',
  atom:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></svg>',
  sparkles:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>',
};

window.TOOLS = [
  {
    id: "doc-to-markdown",
    name: "PDF / Word → Markdown",
    description:
      "Turn a PDF or Word (.docx) file into a clean Markdown file and extract every figure as fig1.png, fig2.png… Download everything as one ZIP.",
    href: "tools/doc-to-markdown/index.html",
    category: "Documents",
    tags: ["pdf", "docx", "word", "markdown", "md", "figures", "images", "png", "convert"],
    icon: "doc-to-md",
    badge: "New",
  },
  {
    id: "paper-to-lammps",
    name: "MD Paper → LAMMPS Input",
    description:
      "Upload a molecular dynamics paper and get every simulation parameter in a table — each linked to its source sentence — plus a commented starter LAMMPS input script.",
    href: "tools/paper-to-lammps/index.html",
    category: "LAMMPS & MD Simulation",
    tags: ["lammps", "molecular dynamics", "md", "parameters", "input script", "potential", "pdf"],
    icon: "atom",
    color: ["#0ea5e9", "#10b9a6"],
    badge: "New",
  },
];
