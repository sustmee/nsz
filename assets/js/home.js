/* Home page: renders tool cards from window.TOOLS with search + category filters. */
(function () {
  "use strict";

  const tools = window.TOOLS || [];
  const icons = window.TOOL_ICONS || {};
  const grid = document.getElementById("tool-grid");
  const empty = document.getElementById("tool-empty");
  const search = document.getElementById("tool-search");
  const filters = document.getElementById("tool-filters");

  let activeCategory = "All";

  const arrow =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function iconFor(tool) {
    if (tool.icon && tool.icon.trim().startsWith("<svg")) return tool.icon;
    return icons[tool.icon] || icons.sparkles || "";
  }

  function cardHtml(tool, index) {
    const style = tool.color ? ` style="background:linear-gradient(135deg, ${tool.color[0]}, ${tool.color[1]})"` : "";
    const badge = tool.comingSoon
      ? '<span class="badge soon">Coming soon</span>'
      : tool.badge ? `<span class="badge">${escapeHtml(tool.badge)}</span>` : "";
    const tags = (tool.tags || []).slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const tagName = tool.comingSoon ? "div" : "a";
    const href = tool.comingSoon ? "" : ` href="${escapeHtml(tool.href)}"`;
    return `
      <${tagName} class="tool-card${tool.comingSoon ? " disabled" : ""}"${href} style="animation-delay:${index * 60}ms">
        <div class="tool-card-top">
          <span class="tool-card-icon"${style}>${iconFor(tool)}</span>
          ${badge}
        </div>
        <h3>${escapeHtml(tool.name)}</h3>
        <p>${escapeHtml(tool.description)}</p>
        <div class="tool-card-tags">${tags}</div>
        ${tool.comingSoon ? "" : `<span class="tool-card-go">Open tool ${arrow}</span>`}
      </${tagName}>`;
  }

  function placeholderCard() {
    return `
      <div class="tool-card placeholder" aria-hidden="true">
        <div class="ph-plus">+</div>
        <h3>More tools coming soon</h3>
        <p>New tools are added to this toolkit regularly. Check back often!</p>
      </div>`;
  }

  function matches(tool, q) {
    if (!q) return true;
    const hay = [tool.name, tool.description, tool.category, ...(tool.tags || [])].join(" ").toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  }

  function render() {
    const q = (search.value || "").trim().toLowerCase();
    const list = tools.filter((t) => (activeCategory === "All" || t.category === activeCategory) && matches(t, q));
    let html;
    const cats = [...new Set(list.map((t) => t.category || "Other"))];
    if (!q && activeCategory === "All" && cats.length > 1) {
      // Group cards under a heading per category.
      let i = 0;
      html = cats
        .map((c) => {
          const items = list.filter((t) => (t.category || "Other") === c);
          return `<h3 class="cat-head"><span>${escapeHtml(c)}</span><small>${items.length} tool${items.length === 1 ? "" : "s"}</small></h3>` +
            items.map((t) => cardHtml(t, i++)).join("");
        })
        .join("");
    } else {
      html = list.map(cardHtml).join("");
    }
    if (!q && activeCategory === "All") html += placeholderCard();
    grid.innerHTML = html;
    empty.hidden = list.length > 0 || (!q && activeCategory === "All");
  }

  function renderFilters() {
    const cats = ["All", ...new Set(tools.map((t) => t.category).filter(Boolean))];
    if (cats.length <= 2) {
      // With a single category the chips add nothing; keep the UI calm.
      filters.hidden = true;
      return;
    }
    filters.innerHTML = cats
      .map((c) => `<button type="button" role="tab" class="filter${c === activeCategory ? " active" : ""}" aria-selected="${c === activeCategory}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
      .join("");
    filters.querySelectorAll(".filter").forEach((btn) =>
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.cat;
        renderFilters();
        render();
      })
    );
  }

  search.addEventListener("input", render);
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== search && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      search.focus();
    }
  });

  const stat = document.getElementById("stat-tools");
  const ready = tools.filter((t) => !t.comingSoon).length;
  if (stat) {
    stat.textContent = ready;
    stat.nextElementSibling.textContent = ready === 1 ? "tool ready" : "tools ready";
  }

  renderFilters();
  render();
})();
