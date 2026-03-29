// ============================================================================
// Admin Panel JavaScript
// Handles authentication, token storage, and API interactions
// ============================================================================

const ADMIN_TOKEN_KEY = "cxy_registry_admin_token";

// ============================================================================
// Authentication
// ============================================================================

/**
 * Store admin token in localStorage
 */
function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

/**
 * Get admin token from localStorage
 */
function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

/**
 * Remove admin token from localStorage
 */
function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
  return getAdminToken() !== null;
}

/**
 * Logout user and redirect to login
 */
function logout() {
  clearAdminToken();
  window.location.href = "/admin/login";
}

/**
 * Redirect to login if not authenticated
 */
function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = "/admin/login";
  }
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Make authenticated API request
 */
async function apiRequest(url, options = {}) {
  const token = getAdminToken();

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized
  if (response.status === 401) {
    clearAdminToken();
    window.location.href = "/admin/login";
    throw new Error("Unauthorized");
  }

  return response;
}

/**
 * Make authenticated GET request
 */
async function apiGet(url) {
  return apiRequest(url, { method: "GET" });
}

/**
 * Make authenticated POST request
 */
async function apiPost(url, data) {
  return apiRequest(url, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// UI Helpers
// ============================================================================

/**
 * Show error message
 */
function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.style.display = "block";
  }
}

/**
 * Hide error message
 */
function hideError(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = "none";
  }
}

/**
 * Show success message
 */
function showSuccess(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.style.display = "block";
  }
}

/**
 * Hide success message
 */
function hideSuccess(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = "none";
  }
}

/**
 * Disable form button
 */
function disableButton(button) {
  button.disabled = true;
  button.dataset.originalText = button.textContent;
  button.textContent = "Processing...";
}

/**
 * Enable form button
 */
function enableButton(button) {
  button.disabled = false;
  if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
  }
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy:", err);
    return false;
  }
}

/**
 * Confirm dangerous action
 */
function confirmAction(message) {
  return confirm(message);
}

// ============================================================================
// Form Handlers
// ============================================================================

/**
 * Handle login form submission
 */
async function handleLogin(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const tokenInput = document.getElementById("admin-token");
  const token = tokenInput.value.trim();

  hideError("login-error");

  if (!token) {
    showError("login-error", "Please enter an admin token");
    return;
  }

  disableButton(submitBtn);

  try {
    console.log("Attempting login with token:", token.substring(0, 20) + "...");

    // Verify token with login endpoint
    const response = await fetch("/admin/login", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    console.log("Login response status:", response.status);

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      showError(
        "login-error",
        data.error ||
          "Invalid admin token. Please check your token and try again.",
      );
      enableButton(submitBtn);
      return;
    }

    const data = await response.json();
    console.log("Login response data:", data);

    if (!data.success) {
      showError("login-error", data.error || "Invalid admin token");
      enableButton(submitBtn);
      return;
    }

    // Token is valid, store it and redirect
    console.log("Login successful, storing token and redirecting...");
    setAdminToken(token);
    console.log("Token stored, redirecting to /admin");
    // Small delay to allow browser to process Set-Cookie header
    setTimeout(() => {
      window.location.href = "/admin";
    }, 100);
  } catch (error) {
    showError("login-error", "Network error: " + error.message);
    enableButton(submitBtn);
  }
}

/**
 * Handle create token form submission
 */
async function handleCreateToken(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('button[type="submit"]');

  const subject = document.getElementById("subject").value.trim();
  const scope = document.getElementById("scope").value;
  const daysValid = parseInt(document.getElementById("days_valid").value, 10);

  hideError("token-error");
  hideSuccess("token-success");

  if (!subject) {
    showError("token-error", "Subject is required");
    return;
  }

  if (daysValid < 1 || daysValid > 365) {
    showError("token-error", "Days valid must be between 1 and 365");
    return;
  }

  disableButton(submitBtn);

  try {
    const response = await apiPost("/api/v1/admin/tokens", {
      subject,
      scope,
      days_valid: daysValid,
    });

    if (!response.ok) {
      const text = await response.text();
      showError("token-error", text || "Failed to create token");
      enableButton(submitBtn);
      return;
    }

    const data = await response.json();

    // Show the token
    displayGeneratedToken(data.token);

    // Reset form
    form.reset();
    enableButton(submitBtn);
  } catch (error) {
    showError("token-error", "Network error: " + error.message);
    enableButton(submitBtn);
  }
}

/**
 * Display generated token
 */
function displayGeneratedToken(token) {
  const container = document.getElementById("token-result");
  const tokenDisplay = document.getElementById("generated-token");

  if (container && tokenDisplay) {
    tokenDisplay.textContent = token;
    container.style.display = "block";

    // Scroll to token
    container.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/**
 * Copy generated token to clipboard
 */
async function copyGeneratedToken() {
  const tokenDisplay = document.getElementById("generated-token");
  if (!tokenDisplay) return;

  const token = tokenDisplay.textContent;
  const success = await copyToClipboard(token);

  const copyBtn = document.getElementById("copy-token-btn");
  if (success && copyBtn) {
    const originalText = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  }
}

// ============================================================================
// Package Management
// ============================================================================

/**
 * Yank a package version
 */
async function yankVersion(packageName, version) {
  if (
    !confirmAction(
      `Are you sure you want to yank ${packageName} v${version}?\n\nThis will prevent new installations of this version.`,
    )
  ) {
    return;
  }

  try {
    const response = await apiPost(
      `/api/v1/packages/${packageName}/${version}/yank`,
      {},
    );

    if (response.ok) {
      alert("Version yanked successfully");
      window.location.reload();
    } else {
      const text = await response.text();
      alert("Failed to yank version: " + text);
    }
  } catch (error) {
    alert("Network error: " + error.message);
  }
}

/**
 * Unyank a package version
 */
async function unyankVersion(packageName, version) {
  if (!confirmAction(`Unyank ${packageName} v${version}?`)) {
    return;
  }

  try {
    const response = await apiPost(
      `/api/v1/packages/${packageName}/${version}/unyank`,
      {},
    );

    if (response.ok) {
      alert("Version unyanked successfully");
      window.location.reload();
    } else {
      const text = await response.text();
      alert("Failed to unyank version: " + text);
    }
  } catch (error) {
    alert("Network error: " + error.message);
  }
}

// ============================================================================
// Page Init
// ============================================================================

/**
 * Initialize admin pages on load
 */
document.addEventListener("DOMContentLoaded", function () {
  // Login form
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  // Create token form
  const createTokenForm = document.getElementById("create-token-form");
  if (createTokenForm) {
    createTokenForm.addEventListener("submit", handleCreateToken);
  }

  // Copy token button
  const copyTokenBtn = document.getElementById("copy-token-btn");
  if (copyTokenBtn) {
    copyTokenBtn.addEventListener("click", copyGeneratedToken);
  }

  // Logout button
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (confirm("Are you sure you want to logout?")) {
        logout();
      }
    });
  }
});
