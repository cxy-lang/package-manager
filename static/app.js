// ============================================================================
// Admin Panel JavaScript
// Session-based authentication + API key management
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
  }
  // "system" or no preference: leave the data-theme="light" from the server
  // and let Pico respect prefers-color-scheme via its own [data-theme] logic.
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
// Login (password form - session cookie returned by server)
// ============================================================================

async function handleLogin(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  hideError("login-error");
  disableButton(submitBtn);

  try {
    const resp = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
      credentials: "same-origin",
    });

    if (resp.ok) {
      const data = await resp.json();
      window.location.href = data.redirect || "/admin";
      return;
    }

    const data = await resp.json().catch(() => ({}));
    showError("login-error", data?.error?.message || "Invalid credentials");
    enableButton(submitBtn);
  } catch (err) {
    showError("login-error", "Network error: " + err.message);
    enableButton(submitBtn);
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
 * server renders a fresh table.  appInitialize() picks up the key on the next
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
// Package Management
// ============================================================================

async function yankVersion(packageName, version) {
  if (
    !confirm(
      `Yank ${packageName} v${version}?\n\nThis will prevent new installations of this version.`,
    )
  ) {
    return;
  }
  try {
    const resp = await apiPost(
      `/api/v1/admin/packages/${packageName}/${version}/yank`,
      {},
    );
    if (resp.ok) {
      window.location.reload();
    } else {
      alert("Failed to yank version");
    }
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

async function unyankVersion(packageName, version) {
  if (!confirm(`Unyank ${packageName} v${version}?`)) return;
  try {
    const resp = await apiPost(
      `/api/v1/admin/packages/${packageName}/${version}/unyank`,
      {},
    );
    if (resp.ok) {
      window.location.reload();
    } else {
      alert("Failed to unyank version");
    }
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

// ============================================================================
// User Management
// ============================================================================

async function makeAdmin(userId) {
  if (!confirm("Grant admin privileges to this user?")) return;
  try {
    const resp = await apiPost(`/api/v1/admin/users/${userId}/make-admin`, {});
    if (resp.ok) window.location.reload();
    else alert("Failed to grant admin");
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

async function revokeAdmin(userId) {
  if (
    !confirm(
      "Revoke admin privileges from this user?\nThey will lose access to the admin panel.",
    )
  )
    return;
  try {
    const resp = await apiPost(
      `/api/v1/admin/users/${userId}/revoke-admin`,
      {},
    );
    if (resp.ok) window.location.reload();
    else alert("Failed to revoke admin");
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// App Init
// ============================================================================

function appInitialize() {
  // ── Icons ──────────────────────────────────────────────────────────────────
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  // ── Active nav link ────────────────────────────────────────────────────────
  const path = window.location.pathname;
  const adminLinks = {
    "/admin": path === "/admin",
    "/admin/api-keys": path.startsWith("/admin/api-keys"),
    "/admin/packages": path.startsWith("/admin/packages"),
    "/admin/users": path.startsWith("/admin/users"),
  };
  document.querySelectorAll(".admin-navbar-links a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href && adminLinks[href]) link.classList.add("active");
  });

  // ── Theme ──────────────────────────────────────────────────────────────────
  // Re-apply in case the server sent data-theme="light" after our early call
  applyStoredTheme();

  // ── Login form ─────────────────────────────────────────────────────────────
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  // ── API Keys page ──────────────────────────────────────────────────────────

  // "+ New Key" / "✕ Cancel" toggle
  const newKeyBtn = document.getElementById("new-key-btn");
  if (newKeyBtn) {
    newKeyBtn.addEventListener("click", toggleCreateForm);
  }

  // Create key form submission
  const createKeyForm = document.getElementById("create-key-form");
  if (createKeyForm) {
    createKeyForm.addEventListener("submit", handleCreateApiKey);
  }

  // Date picker for API key expiry (Flatpickr loaded via CDN in layout)
  const expiresAt = document.getElementById("expires-at");
  if (expiresAt && typeof flatpickr !== "undefined") {
    flatpickr(expiresAt, {
      minDate: "today",
      dateFormat: "Y-m-d",
      allowInput: true,
    });
  }

  // Restore generated key from sessionStorage after post-create reload
  const pendingKey = sessionStorage.getItem("newApiKey");
  if (pendingKey) {
    sessionStorage.removeItem("newApiKey");
    displayGeneratedKey(pendingKey);
  }

  // Copy key to clipboard
  const copyKeyBtn = document.getElementById("copy-key-btn");
  if (copyKeyBtn) {
    copyKeyBtn.addEventListener("click", copyGeneratedKey);
  }

  // "Done" — reload to clear the key result panel
  const doneKeyBtn = document.getElementById("done-key-btn");
  if (doneKeyBtn) {
    doneKeyBtn.addEventListener("click", () => window.location.reload());
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (confirm("Are you sure you want to logout?")) {
        fetch("/auth/logout", {
          method: "POST",
          credentials: "same-origin",
        }).finally(() => (window.location.href = "/auth/login"));
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", appInitialize);
