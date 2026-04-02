// ============================================================================
// Admin Panel JavaScript
// Admin-specific code (login, package/user management)
// Shared code is in shared.js (theme, API, UI, auth)
// ============================================================================

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
// Admin Init
// ============================================================================

function adminInitialize() {
  // ── Active nav link ────────────────────────────────────────────────────────
  const path = window.location.pathname;
  const adminLinks = {
    "/admin": path === "/admin",
    "/admin/api-keys": path.startsWith("/admin/api-keys"),
    "/admin/packages": path.startsWith("/admin/packages"),
    "/admin/users": path.startsWith("/admin/users"),
  };
  document.querySelectorAll(".site-navbar-links a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href && adminLinks[href]) link.classList.add("active");
  });

  // ── Login form ─────────────────────────────────────────────────────────────
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  // ── Date picker for API key expiry ─────────────────────────────────────────
  const expiresAt = document.getElementById("expires-at");
  if (expiresAt && typeof flatpickr !== "undefined") {
    flatpickr(expiresAt, {
      minDate: "today",
      dateFormat: "Y-m-d",
      allowInput: true,
    });
  }
}

document.addEventListener("DOMContentLoaded", function () {
  // Call shared initialization first
  sharedInitialize();
  // Then admin-specific initialization
  adminInitialize();
});
