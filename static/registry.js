/**
 * Apply saved theme (or system default) to avoid flash.
 */
function applyStoredTheme() {
  const saved = localStorage.getItem("cxy-theme");
  if (saved && saved !== "system") {
    document.documentElement.setAttribute("data-theme", saved);
  }
  // "system" or no preference: remove data-theme to let Pico respect prefers-color-scheme
  else {
    document.documentElement.removeAttribute("data-theme");
  }
}

// Apply immediately (before DOMContentLoaded) to avoid theme flash
applyStoredTheme();

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

document.addEventListener("DOMContentLoaded", function () {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

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
