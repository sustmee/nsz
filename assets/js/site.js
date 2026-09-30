/* ==========================================================================
   NSZ Toolkit — shared site script
   Renders the header and footer, handles the light/dark theme,
   and exposes a few helpers (window.NSZ) that tool pages can use.

   Every page sets <body data-root="…"> to the relative path of the site
   root ("./" on the home page, "../../" inside tools/<tool-name>/).
   ========================================================================== */

(function () {
  "use strict";

  const SITE = {
    name: "NSZ Toolkit",
    owner: "Nafis Sadik Zim",
    ownerTitle: "Lecturer, SUST",
  };

  const ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    sun: '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    moon: '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  };

  /* ---------- Theme ---------- */

  function storedTheme() {
    try { return localStorage.getItem("nsz-theme"); } catch (e) { return null; }
  }
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("nsz-theme", theme); } catch (e) { /* storage unavailable */ }
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(current === "dark" ? "light" : "dark");
  }

  /* ---------- Layout ---------- */

  function renderHeader(root) {
    const el = document.getElementById("site-header");
    if (!el) return;
    el.className = "site-header";
    el.innerHTML = `
      <div class="container">
        <a class="brand" href="${root}index.html" aria-label="${SITE.name} home">
          <span class="brand-mark">${ICONS.logo}</span>
          <span>${SITE.name}<small>by ${SITE.owner}</small></span>
        </a>
        <nav class="nav" aria-label="Main">
          <a href="${root}index.html#tools">Tools</a>
          <a class="hide-sm" href="${root}index.html#why">Why us</a>
          <a class="hide-sm" href="${root}index.html#about">About</a>
          <button class="icon-btn theme-toggle" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
            ${ICONS.moon}${ICONS.sun}
          </button>
        </nav>
      </div>`;
    el.querySelector(".theme-toggle").addEventListener("click", toggleTheme);

    const onScroll = () => el.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function renderFooter(root) {
    const el = document.getElementById("site-footer");
    if (!el) return;
    el.className = "site-footer";
    const year = new Date().getFullYear();
    el.innerHTML = `
      <div class="container">
        <div>
          <strong>${SITE.name}</strong> — free tools for students.<br>
          Made with <span class="heart">♥</span> by <strong>${SITE.owner}</strong>, ${SITE.ownerTitle}.
        </div>
        <div>
          Your files are processed in your browser and never uploaded.<br>
          © ${year} ${SITE.owner}. <a href="${root}index.html#tools">All tools →</a>
        </div>
      </div>`;
  }

  function renderBackground() {
    if (document.querySelector(".bg-decor")) return;
    const bg = document.createElement("div");
    bg.className = "bg-decor";
    bg.setAttribute("aria-hidden", "true");
    bg.innerHTML = '<div class="grid"></div><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>';
    document.body.prepend(bg);
  }

  function setupReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      items.forEach((i) => i.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach((i) => io.observe(i));
  }

  /* ---------- Helpers for tool pages ---------- */

  function toast(message, type) {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "toast-wrap";
      wrap.setAttribute("role", "status");
      wrap.setAttribute("aria-live", "polite");
      document.body.appendChild(wrap);
    }
    const t = document.createElement("div");
    t.className = "toast" + (type === "error" ? " error" : "");
    t.innerHTML = (type === "error" ? ICONS.alert : ICONS.check) + "<span></span>";
    t.querySelector("span").textContent = message;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 300);
    }, type === "error" ? 5000 : 2600);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + " " + units[i];
  }

  /** Turns "browser too old" failures into advice a student can act on. */
  function friendlyError(err, fallback) {
    const msg = (err && err.message) || String(err || "");
    if (/dynamically imported module|importing a module script failed|module script|SyntaxError|Unexpected token|invalid regular expression|Can't find variable|is not defined/i.test(msg + " " + (err && err.name))) {
      return "Your browser is too old to run this tool. Please update it (iPhone: Settings → General → Software Update) or open the page in the latest Chrome.";
    }
    return msg || fallback || "Something went wrong.";
  }

  /**
   * Tool pages call NSZ.ready() once their script has started. If it never does
   * (an old browser that can't load the script), explain it instead of failing silently.
   */
  let toolReady = false;
  function ready() {
    toolReady = true;
  }
  window.addEventListener("load", () => {
    if (!document.querySelector("[data-tool]")) return;
    setTimeout(() => {
      if (toolReady) return;
      const box = document.createElement("div");
      box.className = "notice";
      box.setAttribute("role", "alert");
      box.innerHTML = ICONS.alert + "<span>This tool couldn't start in your browser. Please update your browser (iPhone: Settings → General → Software Update) or try the latest Chrome, then reload the page.</span>";
      const host = document.querySelector("[data-tool]");
      host.prepend(box);
    }, 1500);
  });

  window.NSZ = { SITE, ICONS, toast, downloadBlob, formatBytes, setTheme, toggleTheme, friendlyError, ready };

  /* ---------- Boot ---------- */

  if (!document.documentElement.getAttribute("data-theme")) {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", storedTheme() || (prefersDark ? "dark" : "light"));
  }

  function boot() {
    const root = document.body.dataset.root || "./";
    renderBackground();
    renderHeader(root);
    renderFooter(root);
    setupReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
