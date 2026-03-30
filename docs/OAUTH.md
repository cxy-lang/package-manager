# OAuth Integration for Cxy Package Registry

This document describes the authentication and authorization system for the Cxy Package Registry, which supports both local admin accounts and GitHub OAuth users.

## Overview

The package registry implements a **two-tier authentication system**:

### Tier 1: Session Authentication (Web UI)
1. **Local Admin Users** - Username/password authentication for bootstrap admin and internal accounts
2. **GitHub OAuth Users** - Social login via GitHub OAuth 2.0

Both user types authenticate via the web UI and receive a session cookie.

### Tier 2: API Key Authentication (Programmatic Access)
- Authenticated users create their own API keys via the web UI
- API keys are used with `Authorization: Bearer <key>` for CLI/API access
- Keys have scopes (`publish`, `yank`, `admin`) and optional expiry
- Keys are stored hashed (SHA-256) - never recoverable after creation

### Why Two Tiers?
- Web UI uses session cookies (HttpOnly, CSRF-protected)
- CLI/CI tools use API keys (revocable, scoped, auditable)
- No shared secrets - each user controls their own keys
- No `isUI` flag needed - middleware tries session cookie first, then API key

## Architecture

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     AuthMiddleware                          │
│  - Validates session tokens (JWT)                           │
│  - Loads user from database                                 │
│  - Stores user in AuthContext                               │
│  - Enforces requireUser/requireAdmin                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    RepoProvider                             │
│  - Provides database access                                 │
│  - Stores repo reference in RepoProviderContext             │
└─────────────────────────────────────────────────────────────┘
```

### Middleware Contexts

**RepoProviderContext:**
```cxy
pub struct RepoProviderContext {
    repo: &PackageRepository
    registryUrl: String
}
```

**AuthContext:**
```cxy
pub struct AuthContext {
    currentUser: User?      // Logged-in user (null if anonymous)
    isAdmin: bool           // True if user has admin privileges
}
```

Handlers access both contexts:
```cxy
var repoCtx = ep.context[RepoProvider](req)
var authCtx = ep.context[AuthMiddleware](req)

if !!authCtx.currentUser {
    var user = *authCtx.currentUser
    println(f"Request from: {user.login}")
}
```

## User Model

### Database Schema

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id INTEGER UNIQUE,               -- NULL for local users
    login TEXT NOT NULL UNIQUE,             -- username or GitHub login
    name TEXT,
    email TEXT,
    avatar_url TEXT,
    password_hash TEXT,                     -- NULL for GitHub users
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login TEXT NOT NULL,
    CHECK (
        (github_id IS NOT NULL AND password_hash IS NULL) OR
        (github_id IS NULL AND password_hash IS NOT NULL)
    )  -- Ensure user is either GitHub OR local, not both
);

CREATE INDEX idx_users_github_id ON users (github_id);
CREATE INDEX idx_users_login ON users (login);
```

### User Struct

```cxy
@json
pub struct User {
    id: i64
    github_id: i64?              // NULL for local users
    login: String                // Username or GitHub login
    name: String?
    email: String?
    avatar_url: String?
    password_hash: String?       // NULL for GitHub users (not serialized)
    is_admin: bool
    created_at: String           // ISO 8601 timestamp
    last_login: String           // ISO 8601 timestamp
    
    func isGitHubUser(): bool {
        return !!github_id
    }
    
    func isLocalUser(): bool {
        return password_hash != null
    }
}
```

## Authentication Flows

### 1. Local Admin Login

```
User                    Browser                 Server
  │                       │                       │
  │  Visit /auth/login    │                       │
  ├──────────────────────>│                       │
  │                       │   GET /auth/login     │
  │                       ├──────────────────────>│
  │                       │   <login page HTML>   │
  │                       │<──────────────────────┤
  │                       │                       │
  │  Enter credentials    │                       │
  │  (username/password)  │                       │
  ├──────────────────────>│                       │
  │                       │  POST /auth/login     │
  │                       ├──────────────────────>│
  │                       │   (form data)         │
  │                       │                       │
  │                       │  Verify password      │
  │                       │  Create session JWT   │
  │                       │  Set cookie           │
  │                       │                       │
  │                       │   302 Redirect        │
  │                       │<──────────────────────┤
  │                       │   Set-Cookie: session │
  │                       │                       │
  │  View dashboard       │                       │
  ├──────────────────────>│                       │
  │                       │   GET /admin          │
  │                       ├──────────────────────>│
  │                       │   (with session)      │
  │                       │   <dashboard HTML>    │
  │                       │<──────────────────────┤
```

**Endpoints:**
- `GET /auth/login` - Display login page (form + GitHub button)
- `POST /auth/login` - Process username/password login
- `POST /auth/logout` - Clear session cookie

### 2. GitHub OAuth Login

```
User                Browser              Server              GitHub
  │                   │                    │                   │
  │  Click "GitHub"   │                    │                   │
  ├──────────────────>│                    │                   │
  │                   │  GET /auth/github  │                   │
  │                   ├───────────────────>│                   │
  │                   │                    │ getAuthUrl()      │
  │                   │  302 → GitHub      │                   │
  │                   │<───────────────────┤                   │
  │                   │                    │                   │
  │                   │     Redirect to GitHub OAuth           │
  │                   ├───────────────────────────────────────>│
  │                   │                    │                   │
  │  Authorize app    │                    │                   │
  ├──────────────────────────────────────────────────────────>│
  │                   │                    │                   │
  │                   │  302 → callback    │                   │
  │                   │<───────────────────────────────────────┤
  │                   │  (code, state)     │                   │
  │                   │                    │                   │
  │                   │  GET /auth/callback│                   │
  │                   ├───────────────────>│                   │
  │                   │  ?code=xxx&state=y │                   │
  │                   │                    │                   │
  │                   │                    │ Exchange code     │
  │                   │                    ├──────────────────>│
  │                   │                    │ <access_token>    │
  │                   │                    │<──────────────────┤
  │                   │                    │                   │
  │                   │                    │ getGitHubUser()   │
  │                   │                    ├──────────────────>│
  │                   │                    │ <user profile>    │
  │                   │                    │<──────────────────┤
  │                   │                    │                   │
  │                   │                    │ Upsert user in DB │
  │                   │                    │ Create session    │
  │                   │                    │ Set cookie        │
  │                   │                    │                   │
  │                   │   302 Redirect     │                   │
  │                   │<───────────────────┤                   │
  │                   │   Set-Cookie       │                   │
```

**Endpoints:**
- `GET /auth/github` - Redirect to GitHub OAuth
- `GET /auth/github/callback` - Handle OAuth callback, exchange code for token

**GitHub User Data:**
```cxy
pub struct GitHubUser {
    id: i64                    // GitHub user ID
    login: String              // GitHub username
    email: String?             // Email (may be private)
    name: String?              // Display name
    avatarUrl: String?         // Profile picture URL
    // ... other fields
}
```

### 3. Session Validation

On every request to protected routes:

```
1. AuthMiddleware.before() runs
2. Read session_token cookie
3. Verify JWT signature with secret
4. Check JWT expiration
5. Extract user_id from "sub" claim
6. Load User from database via RepoProvider
7. Store User in AuthContext
8. Check authorization (requireUser/requireAdmin)
9. Allow or deny request
```

## Session Management

### Session Token Format

JWT with the following claims:

```json
{
  "sub": "123",              // user_id (primary key)
  "login": "username",       // username for display
  "exp": 1234567890          // expiration timestamp
}
```

### Cookie Settings

```
session_token=<JWT>; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000
```

- **HttpOnly** - Prevents JavaScript access (XSS protection)
- **SameSite=Lax** - CSRF protection
- **Max-Age=2592000** - 30 days expiration
- **Secure** - HTTPS only (production)

### Token Creation

```cxy
func createUserSessionToken(user: User, jwtSecret: String): String {
    var jwt = Jwt()
    jwt.payload().sub = f"{user.id}"
    jwt.payload().exp = Time().timestamp() + 2592000  // 30 days
    jwt.setClaim("login".S, Value.String(user.login))
    
    return jwt.sign(jwtSecret.__str())
}
```

## Password Security

### Password Hashing

Uses salt + SHA-256 (upgrade to bcrypt recommended):

```cxy
// Hash password with auto-generated salt
func hashPasswordWithSalt(password: String): String {
    var salt = generateSalt()           // 16 random bytes
    var hash = hashPassword(password, salt)
    return f"{salt}:{hash}"             // Format: "salt:hash"
}

// Verify password
func verifyPassword(password: String, storedHash: String, salt: String): bool {
    var computed = hashPassword(password, String(salt))
    return computed.__str() == storedHash.__str()
}
```

### Stored Format

```
password_hash column: "a3f2e9d4...1c7b:5e9a2f...8d3c"
                      └─ salt ─┘ └─── hash ────┘
```

## Repository Interface

### User Management Methods

```cxy
pub class PackageRepository {
    // ===== User Management =====
    
    /// Get user by ID
    virtual func getUser(userId: i64): !User?
    
    /// Get user by GitHub ID
    virtual func getUserByGitHubId(githubId: i64): !User?
    
    /// Get user by login (username)
    virtual func getUserByLogin(login: String): !User?
    
    /// Create or update GitHub user
    virtual func upsertGitHubUser(
        githubId: i64,
        login: String,
        name: String?,
        email: String?,
        avatarUrl: String?
    ): !User
    
    /// Create local user with password
    virtual func createLocalUser(
        login: String,
        password: String,
        name: String?,
        email: String?,
        isAdmin: bool
    ): !User
    
    /// Verify local user password and return user if valid
    virtual func verifyLocalUserPassword(login: String, password: String): !User?
    
    /// Update user's last_login timestamp
    virtual func updateLastLogin(userId: i64): !void
    
    /// Make user an admin
    virtual func setUserAdmin(userId: i64, isAdmin: bool): !void
    
    /// Bootstrap admin user on first run
    /// Returns true if admin was created, false if already exists
    virtual func bootstrapAdmin(password: String?): !bool
}
```

## API Key System

### Overview

Users create API keys via the web UI at `/admin/tokens`. Keys are:
- Owned by the user who created them
- Scoped to specific operations
- Optionally expiring
- Stored as SHA-256 hashes (plain text shown once at creation)

### Database Schema

```sql
CREATE TABLE api_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    key_hash   TEXT NOT NULL UNIQUE,       -- SHA-256 of actual key
    name       TEXT NOT NULL,              -- User-friendly label
    scopes     TEXT NOT NULL,              -- JSON array: ["publish","yank","admin"]
    created_at TEXT NOT NULL,
    last_used  TEXT,                       -- NULL = never used
    expires_at TEXT,                       -- NULL = never expires
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)
```

### Key Format

```
cxy_live_<32 url-safe base64 chars>
e.g., cxy_live_aB3xK9mP2nQ4vY7wL3sR8tU1
```

### Scopes

| Scope | Description |
|-------|-------------|
| `publish` | Can publish packages via API |
| `yank` | Can yank/unyank package versions |
| `admin` | Full admin access (admin users only) |

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/user/keys` | User | List your API keys |
| `POST` | `/api/v1/user/keys` | User | Create new API key |
| `DELETE` | `/api/v1/user/keys/{id}` | User | Revoke API key |

### Create Key Request

```json
{
  "name": "CI/CD Pipeline",
  "scopes": ["publish", "yank"],
  "expires_at": "2025-12-31T00:00:00Z"
}
```

### Create Key Response (key shown ONCE)

```json
{
  "key": "cxy_live_aB3xK9mP2nQ4vY7wL3sR8tU1",
  "id": 1,
  "name": "CI/CD Pipeline",
  "scopes": "[\"publish\",\"yank\"]",
  "created_at": "2024-01-15T10:30:00Z",
  "expires_at": "2025-12-31T00:00:00Z"
}
```

### Using API Keys

```bash
# Publish a package
curl -X POST https://registry.example.com/api/v1/packages \
  -H "Authorization: Bearer cxy_live_aB3xK9mP2..." \
  -H "Content-Type: application/json" \
  -d @publish.json

# Or via cxy CLI
export CXY_REGISTRY_TOKEN=cxy_live_aB3xK9mP2...
cxy package publish
```

### Authentication Middleware Flow

```
Incoming Request
      │
      ▼
AuthMiddleware.before()
      │
      ├─ Check session_token cookie
      │   └─ Valid? → Load user from DB → Set AuthContext
      │
      ├─ No session? Check Authorization header
      │   └─ Valid API key? → Load user from DB → Set AuthContext
      │
      └─ Check route requirements
          ├─ requireAdmin → ctx.isAdmin? → Allow / Redirect to login
          └─ requireUser  → ctx.currentUser? → Allow / Redirect to login
```

## Bootstrap Process

### First Run

When the server starts for the first time:

1. Check if any admin user exists in database
2. If no admin exists:
   - Generate random password (or use `ADMIN_PASSWORD` env var)
   - Create local user with `login="admin"`
   - Set `is_admin=true`
   - Print credentials to console
3. If admin exists, skip bootstrap

**Console Output:**

```
=====================================
  Cxy Package Registry Server
=====================================
Port:         8080
Database:     registry.db
Registry URL: http://localhost:8080
=====================================

=====================================
BOOTSTRAP: Admin user created!
=====================================
Username: admin
Password: Kx9mP2nQ4vY7wL3s

Save these credentials securely!
Login at: http://localhost:8080/auth/login
=====================================

Server listening on port 8080
```

### Environment Variables

```bash
# Required
export JWT_SECRET="your-secret-key"

# Optional - Bootstrap admin
export ADMIN_PASSWORD="choose-secure-password"

# Optional - GitHub OAuth (can use local auth only)
export GITHUB_CLIENT_ID="your-client-id"
export GITHUB_CLIENT_SECRET="your-client-secret"
export GITHUB_CALLBACK_URL="http://localhost:8080/auth/github/callback"
```

## Authorization

### Route Protection

**Exempt (public):**
```cxy
auth.exempt(ep("GET /api/v1/packages", ...))
```

**Require logged-in user:**
```cxy
auth.requireUser(ep("GET /dashboard", ...))
```

**Require admin:**
```cxy
auth.requireAdmin(ep("GET /admin/tokens", ...))
```

### Middleware Methods

```cxy
pub class AuthMiddleware {
    /// Mark route as public (no authentication required)
    func exempt(route: &Route): &Route
    
    /// Mark route as requiring any logged-in user
    func requireUser(route: &Route): &Route
    
    /// Mark route as requiring admin privileges
    func requireAdmin(route: &Route): &Route
}
```

### In Handlers

```cxy
auth.requireAdmin(ep("GET /admin", (req: &const Request, resp: &Response) => {
    var authCtx = ep.context[AuthMiddleware](req)
    
    // authCtx.currentUser is guaranteed to exist and be admin
    var user = *authCtx.currentUser
    
    if !authCtx.isAdmin {
        // This won't happen - middleware blocks non-admins
        resp.end(Status.Forbidden)
        return
    }
    
    // Render admin page
}))
```

## Security Considerations

### Authentication Security

1. **Password Storage**
   - Never store plaintext passwords
   - Use salt + hash (SHA-256 minimum, bcrypt recommended)
   - Each user has unique salt

2. **Session Tokens**
   - JWT signed with secret
   - 30-day expiration
   - HttpOnly cookies (prevent XSS)
   - SameSite=Lax (prevent CSRF)

3. **OAuth State Parameter**
   - PKCE enabled by default (GitHub doesn't require but we use it)
   - State parameter validated (CSRF protection)
   - Authorization code is single-use

### Transport Security

1. **Production:**
   - Use HTTPS only
   - Add `Secure` flag to cookies
   - Set `HSTS` headers

2. **Development:**
   - HTTP allowed for localhost
   - No `Secure` flag on cookies

### Admin Privileges

1. **Granting Admin**
   - Only admins can grant admin privileges
   - Use `setUserAdmin()` method
   - Audit log recommended

2. **First Admin**
   - Bootstrap creates first admin automatically
   - Random password generated and displayed once
   - Admin can then create/promote other users

## Usage Examples

### Local Admin Login

```bash
# Start server
./package-manager

# Visit http://localhost:8080/auth/login
# Enter:
#   Username: admin
#   Password: <bootstrap password>
```

### GitHub OAuth Setup

1. **Create GitHub OAuth App:**
   - Go to https://github.com/settings/developers
   - Click "New OAuth App"
   - Application name: "Cxy Package Registry"
   - Homepage URL: `http://localhost:8080`
   - Callback URL: `http://localhost:8080/auth/github/callback`
   - Copy Client ID and Client Secret

2. **Configure Server:**
   ```bash
   export GITHUB_CLIENT_ID="your-client-id"
   export GITHUB_CLIENT_SECRET="your-client-secret"
   export GITHUB_CALLBACK_URL="http://localhost:8080/auth/github/callback"
   ./package-manager
   ```

3. **Login:**
   - Visit http://localhost:8080/auth/login
   - Click "Login with GitHub"
   - Authorize the application
   - Redirected to dashboard

### Promote User to Admin

```cxy
// In admin UI or CLI tool
var repo = SQLitePackageRepository.open("registry.db")
repo.setUserAdmin(userId, true)
```

## API Routes

### Authentication Routes

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| `GET` | `/auth/login` | Display login page | No |
| `POST` | `/auth/login` | Process local login | No |
| `POST` | `/auth/logout` | Clear session | No |
| `GET` | `/auth/github` | Redirect to GitHub OAuth | No |
| `GET` | `/auth/github/callback` | Handle OAuth callback | No |
| `GET` | `/auth/me` | Get current user info | Yes (user) |

### API Key Routes

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| `GET` | `/api/v1/user/keys` | List your API keys | Yes (user) |
| `POST` | `/api/v1/user/keys` | Create new API key | Yes (user) |
| `DELETE` | `/api/v1/user/keys/{id}` | Revoke API key | Yes (user) |

### Admin Routes

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| `GET` | `/admin` | Admin dashboard | Yes (admin) |
| `GET` | `/admin/packages` | Package management | Yes (admin) |
| `GET` | `/admin/tokens` | API key management | Yes (admin) |
| `GET` | `/admin/users` | User management | Yes (admin) |

## Future Enhancements

1. **OAuth Providers**
   - Add Google OAuth
   - Add GitLab OAuth
   - Add Microsoft OAuth

2. **Password Security**
   - Upgrade to bcrypt/argon2
   - Add password strength requirements
   - Add password reset flow

3. **User Management**
   - Add user profile editing
   - Add email verification
   - Add 2FA support

4. **Audit Log**
   - Track admin actions
   - Track login attempts
   - Track package publications

5. **Session Management**
   - Add session revocation
   - Add "remember me" option
   - Add active sessions view

## References

- [OAuth 2.0 RFC 6749](https://tools.ietf.org/html/rfc6749)
- [PKCE RFC 7636](https://tools.ietf.org/html/rfc7636)
- [GitHub OAuth Apps](https://docs.github.com/en/developers/apps/building-oauth-apps)
- [JWT RFC 7519](https://tools.ietf.org/html/rfc7519)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)