// ============================================================================
// Admin Panel JavaScript
// Session-based authentication + API key management
// ============================================================================

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

async function apiGet(url) {
  return apiRequest(url, { method: "GET" });
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

function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleDateString();
  } catch {
    return isoStr;
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
 * Load and render the current user's API keys
 */
async function loadApiKeys() {
  const loading = document.getElementById("keys-loading");
  const empty = document.getElementById("keys-empty");
  const table = document.getElementById("keys-table");
  const tbody = document.getElementById("keys-tbody");

  if (!tbody) return;

  try {
    const resp = await apiGet("/api/v1/user/keys");
    const keys = await resp.json();

    if (loading) loading.style.display = "none";

    if (!keys || keys.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }

    tbody.innerHTML = "";
    keys.forEach((key) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(key.name)}</td>
        <td>${escapeHtml(key.scopes || "")}</td>
        <td>${formatDate(key.created_at)}</td>
        <td>${formatDate(key.last_used)}</td>
        <td>${formatDate(key.expires_at)}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="revokeApiKey(${key.id}, '${escapeHtml(key.name)}')">
            Revoke
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (table) table.style.display = "table";
  } catch (err) {
    if (loading) loading.textContent = "Failed to load API keys.";
  }
}

/**
 * Handle create API key form submission
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

  // Collect checked scopes
  const scopeCheckboxes = form.querySelectorAll('input[name="scopes"]:checked');
  const scopes = Array.from(scopeCheckboxes).map((cb) => cb.value);
  if (scopes.length === 0) {
    showError("key-error", "Select at least one scope");
    return;
  }

  const expiresAtInput = document.getElementById("expires-at").value;
  const expiresAt = expiresAtInput
    ? new Date(expiresAtInput).toISOString()
    : null;

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
    displayGeneratedKey(data.key);
    form.reset();
    enableButton(submitBtn);
    loadApiKeys(); // Refresh list
  } catch (err) {
    showError("key-error", "Network error: " + err.message);
    enableButton(submitBtn);
  }
}

/**
 * Show the generated key (only once)
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
 * Copy generated key to clipboard
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
 * Revoke an API key
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
      loadApiKeys();
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
  // Login form (password)
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  // Create API key form
  const createKeyForm = document.getElementById("create-key-form");
  if (createKeyForm) {
    createKeyForm.addEventListener("submit", handleCreateApiKey);
    loadApiKeys();
  }

  // Copy key button
  const copyKeyBtn = document.getElementById("copy-key-btn");
  if (copyKeyBtn) {
    copyKeyBtn.addEventListener("click", copyGeneratedKey);
  }

  // Logout button
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
