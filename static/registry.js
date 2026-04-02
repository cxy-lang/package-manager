// ============================================================================
// Registry (Public) JavaScript
// Public-specific code only — shared code lives in shared.js
// ============================================================================

// ============================================================================
// Theme Cycle Toggle
// ============================================================================

const THEME_CYCLE = ["light", "dark", "system"];
const THEME_ICONS = { light: "sun", dark: "moon", system: "monitor" };

function updateThemeCycleIcon() {
  const saved = localStorage.getItem("cxy-theme") || "system";
  const btn = document.getElementById("theme-cycle-btn");
  if (!btn) return;

  const icon = btn.querySelector("[data-lucide]");
  if (!icon) return;

  const iconName = THEME_ICONS[saved] || "sun";
  icon.setAttribute("data-lucide", iconName);
  btn.title = saved.charAt(0).toUpperCase() + saved.slice(1) + " mode";

  if (typeof lucide !== "undefined") {
    lucide.createIcons({ nodes: [icon] });
  }
}

function cycleTheme() {
  const saved = localStorage.getItem("cxy-theme") || "system";
  const idx = THEME_CYCLE.indexOf(saved);
  const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
  setTheme(next);
  updateThemeCycleIcon();
}

// ============================================================================
// Package Install Copy
// ============================================================================

function copyInstall(packageName) {
  const cmd = `cxy package add ${packageName}`;
  navigator.clipboard.writeText(cmd).then(() => {
    const btn = document.querySelector(".registry-copy-btn");
    if (btn) {
      const orig = btn.innerHTML;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.innerHTML = orig), 2000);
    }
  });
}

// ============================================================================
// Registry Init
// ============================================================================

document.addEventListener("DOMContentLoaded", function () {
  // Initialize shared functionality (theme, icons, API keys, logout, etc.)
  sharedInitialize();

  // Wire up the theme cycle button
  const themeCycleBtn = document.getElementById("theme-cycle-btn");
  if (themeCycleBtn) {
    themeCycleBtn.addEventListener("click", cycleTheme);
  }

  // Sync icon to current theme
  updateThemeCycleIcon();

  // Set sort dropdown to match current URL param and auto-submit on change
  var sortSelect = document.querySelector(".registry-sort-select");
  if (sortSelect) {
    var params = new URLSearchParams(window.location.search);
    var currentSort = params.get("sort");
    if (currentSort) {
      sortSelect.value = currentSort;
    }
    sortSelect.addEventListener("change", function () {
      this.closest("form").submit();
    });
  }
});
