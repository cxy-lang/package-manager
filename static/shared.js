// ============================================================================
// Shared JavaScript
// Common code for admin and public pages: theme, API, UI, auth
// ============================================================================

// ============================================================================
// Theme
// ============================================================================

/**
 * Apply a theme to the <html> element and persist it.
 * @param {"light"|"dark"|"system"} theme
 */
function setTheme(theme) {
  const html = document.documentElement;
  if (theme === "system") {
    html.removeAttribute("data-theme");
  } else {
    html.setAttribute("data-theme", theme);
  }
  localStorage.setItem("cxy-theme", theme);

  // Close dropdown after selection
  document.activeElement?.blur();
}

/**
 * Apply saved theme (or system default) as early as possible to avoid flash.
 */
function applyStoredTheme() {
  const saved = localStorage.getItem("cxy-theme");
  if (saved && saved !== "system") {
    document.documentElement.setAttribute("data-theme", saved);
  } else {
    // Remove data-theme to allow @media (prefers-color-scheme) to work
    document.documentElement.removeAttribute("data-theme");
  }
}

// Apply immediately (before DOMContentLoaded) to avoid theme flash
applyStoredTheme();

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Make API request (session cookie is sent automatically)
 */
async function apiRequest(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  // Handle 401/403 - redirect to login
  if (response.status === 401 || response.status === 403) {
    window.location.href = "/auth/login";
    throw new Error("Unauthorized");
  }

  return response;
}

async function apiPost(url, data) {
  return apiRequest(url, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function apiDelete(url) {
  return apiRequest(url, { method: "DELETE" });
}

// ============================================================================
// UI Helpers
// ============================================================================

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.style.display = "block";
  }
}

function hideError(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.style.display = "none";
}

function disableButton(btn) {
  btn.disabled = true;
  btn.dataset.originalText = btn.textContent;
  btn.textContent = "Processing...";
}

function enableButton(btn) {
  btn.disabled = false;
  if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    return false;
  }
}

// ============================================================================
// API Key Management
// ============================================================================

/**
 * Toggle the create-key panel.
 * - If the key result panel is visible, hide it first.
 * - Toggles the form and flips the button label between "+ New Key" / "✕ Cancel".
 */
function toggleCreateForm() {
  const panel = document.getElementById("create-key-panel");
  const btn = document.getElementById("new-key-btn");
  const result = document.getElementById("key-result");

  if (!panel) return;

  const isVisible = panel.style.display !== "none";

  if (isVisible) {
    panel.style.display = "none";
    if (btn) btn.textContent = "+ New Key";
  } else {
    // Hide the key result if it is currently showing
    if (result) result.style.display = "none";
    panel.style.display = "block";
    if (btn) btn.textContent = "✕ Cancel";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/**
 * Handle create API key form submission.
 * On success, stores the plain-text key in sessionStorage and reloads so the
 * server renders a fresh table.  sharedInitialize() picks up the key on the next
 * load and shows it in the key-result panel.
 */
async function handleCreateApiKey(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  hideError("key-error");

  const name = document.getElementById("key-name").value.trim();
  if (!name) {
    showError("key-error", "Key name is required");
    return;
  }

  const scopeCheckboxes = form.querySelectorAll('input[name="scopes"]:checked');
  const scopes = Array.from(scopeCheckboxes).map((cb) => cb.value);
  if (scopes.length === 0) {
    showError("key-error", "Select at least one scope");
    return;
  }

  const expiresAtInput = document.getElementById("expires-at").value;
  const expiresAt = expiresAtInput || null;

  disableButton(submitBtn);

  try {
    const resp = await apiPost("/api/v1/user/keys", {
      name,
      scopes,
      expires_at: expiresAt,
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      showError(
        "key-error",
        data?.error?.message || "Failed to create API key",
      );
      enableButton(submitBtn);
      return;
    }

    const data = await resp.json();

    // Store the plain-text key so it survives the reload
    sessionStorage.setItem("newApiKey", data.key);
    window.location.reload();
  } catch (err) {
    showError("key-error", "Network error: " + err.message);
    enableButton(submitBtn);
  }
}

/**
 * Show the generated key panel (populated from sessionStorage after reload).
 */
function displayGeneratedKey(key) {
  const result = document.getElementById("key-result");
  const display = document.getElementById("generated-key");

  if (result && display) {
    display.textContent = key;
    result.style.display = "block";
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/**
 * Copy the generated key to clipboard.
 */
async function copyGeneratedKey() {
  const display = document.getElementById("generated-key");
  if (!display) return;

  const success = await copyToClipboard(display.textContent);
  const btn = document.getElementById("copy-key-btn");
  if (success && btn) {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = orig), 2000);
  }
}

/**
 * Revoke an API key — reloads the page on success so the server renders
 * the updated table.
 */
async function revokeApiKey(keyId, keyName) {
  if (
    !confirm(
      `Revoke API key "${keyName}"?\n\nAny CI/CD pipelines using this key will stop working.`,
    )
  ) {
    return;
  }

  try {
    const resp = await apiDelete(`/api/v1/user/keys/${keyId}`);
    if (resp.ok || resp.status === 204) {
      window.location.reload();
    } else {
      alert("Failed to revoke key");
    }
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

// ============================================================================
// Shared Initialization
// ============================================================================

/**
 * Initialize common functionality that both admin and public pages need.
 * Call this from DOMContentLoaded in page-specific scripts.
 */
function sharedInitialize() {
  // Lucide icons
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  // Re-apply theme in case the server sent data-theme="light"
  applyStoredTheme();

  // API Key management event listeners
  const newKeyBtn = document.getElementById("new-key-btn");
  if (newKeyBtn) {
    newKeyBtn.addEventListener("click", toggleCreateForm);
  }

  const createKeyForm = document.getElementById("create-key-form");
  if (createKeyForm) {
    createKeyForm.addEventListener("submit", handleCreateApiKey);
  }

  const copyKeyBtn = document.getElementById("copy-key-btn");
  if (copyKeyBtn) {
    copyKeyBtn.addEventListener("click", copyGeneratedKey);
  }

  const doneKeyBtn = document.getElementById("done-key-btn");
  if (doneKeyBtn) {
    doneKeyBtn.addEventListener("click", () => {
      sessionStorage.removeItem("newApiKey");
      window.location.reload();
    });
  }

  // Check if we just created a new key (stored in sessionStorage)
  const newApiKey = sessionStorage.getItem("newApiKey");
  if (newApiKey) {
    displayGeneratedKey(newApiKey);
  }

  // Logout button handler
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      }).then(() => {
        window.location.href = "/";
      });
    });
  }
}
