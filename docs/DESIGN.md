# Cxy Package Registry — Server Design

## Table of Contents

1. [Design Review — March 2026](#design-review--march-2026)
2. [Overview](#overview)
3. [Goals and Non-Goals](#goals-and-non-goals)
4. [Architecture](#architecture)
5. [Package Lifecycle](#package-lifecycle)
6. [Database Schema](#database-schema)
7. [REST API](#rest-api)
8. [Web UI](#web-ui)
9. [Tech Stack](#tech-stack)
10. [Project Structure](#project-structure)
11. [Future Considerations](#future-considerations)

---

## Design Review — March 2026

**Status:** ✅ **Design validated and updated** after implementing the `@markdown` package.

### Changes from original design

#### 1. Markdown package location
- **Original:** `stdlib/markdown.cxy`
- **Actual:** `@markdown` (separate package in mono-repo)
- **Rationale:** Markdown parsing is a substantial feature (~3,800 lines) better suited as a standalone package rather than stdlib inclusion.

#### 2. Markdown implementation details
- **Zero-copy lexing:** Tokens hold `__string` slices into the source instead of allocated `String` copies. The parser owns a single source allocation; all tokens reference into it. This significantly reduces memory allocations during parsing.
- **File caching support:** The `Markdown` class includes an intelligent file-to-file caching system (though we won't use it for registry README rendering).
- **Error handling:** `toHtml()` methods return `!void` or `!Path`, so callers must handle potential errors.

#### 3. Integration points confirmed

**Package instantiation:**
```cxy
import { Markdown } from "@markdown"

// Create once at server startup
var md = Markdown()
// No configuration needed for basic string→HTML rendering
```

**Component usage:**
```cxy
pub class PackagePage: View {
    - _pkg:      Package
    - _markdown: &Markdown

    @override
    func render(os: &OutputStream): !void {
        // Pass __string directly; lexer creates slices
        _markdown.toHtml(os, _pkg.readme.__str())
        // Zero allocations during lexing
        // HTML streams directly to response buffer
    }
}
```

**Error handling pattern:**
```cxy
func handlePackageRequest(req: &Request, res: &Response): !void {
    var pkg = db.getPackage(name)?
    var page = PackagePage(pkg, &md)
    page.render(&res.body)  // propagates !void error
}
```

### Features validated

| Feature | Status | Notes |
|---------|--------|-------|
| CommonMark support | ✅ | Headings, lists, code blocks, tables, quotes, links, images all working |
| Semantic HTML output | ✅ | Consistent `mk-*` classes (mk-h1, mk-p, mk-code, etc.) for easy styling |
| Zero-copy lexing | ✅ | Parser owns source; tokens are __string slices |
| Stream-to-stream rendering | ✅ | `toHtml(os: &OutputStream, source: __string)` writes directly to output |
| HTML escaping | ✅ | Automatic escaping of <, >, &, " |
| File caching | ⚠️ | Available but not needed; registry uses zero-copy response chunking with __string refs |
| Test coverage | ✅ | All 7 test files pass, comprehensive test suite |

### Design still holds

**No schema changes needed:**
- `packages.readme` remains `TEXT` storing raw Markdown
- Rendering happens at request time in the `PackagePage` component
- No need to pre-render or cache HTML in the database

**SSR integration works as designed:**
- `Markdown` instance created once at server startup
- Passed by reference to page components
- Renders directly into response stream (zero intermediate allocations)
- Error handling fits naturally into Cxy's `!void` pattern

**Zero-copy caching strategy:**
```cxy
// In-memory LRU cache stores rendered HTML as String (owns allocation)
var htmlCache = LRUCache[String, String](maxSize: 1000)

func handlePackageRequest(name: String, res: &Response): !void {
    // Check cache first
    if (var cached = htmlCache.get(name)) {
        // Zero-copy: chunk references cached.__str() without copying
        res.chunk(cached.__str())
        return
    }
    
    // Cache miss: render and store
    var pkg = db.getPackage(name)?
    var html = String()
    md.toHtml(&html, pkg.readme.__str())
    
    htmlCache.set(name, &&html)  // Cache owns the allocation
    res.chunk(html.__str())
}
```

**Performance characteristics:**
- Zero-copy lexing reduces allocations during markdown parsing
- Zero-copy chunking: `__string` passed to `chunk()` is auto-wrapped in ResponseChunk union
- LRU cache (1000 packages × ~50KB = ~50MB) handles traffic power-law distribution
- Popular packages stay hot in cache; cold packages render on-demand
- Cache invalidation on package publish (simple key eviction)

### Action items

- [x] Update import from `stdlib/markdown.cxy` to `@markdown`
- [x] Add `!void` return type to render methods that call `toHtml()`
- [x] Document zero-copy lexing benefit in Tech Stack table
- [x] Design zero-copy caching with response chunking
- [ ] Add `@markdown` to `Cxyfile.yaml` dependencies when implementing
- [ ] Implement LRU cache for rendered HTML with ResponseChunk
- [ ] Consider styling for `mk-*` classes in `static/style.css`
- [ ] Test error handling when malformed Markdown is stored

### Conclusion

The original design holds up well. The markdown parser we implemented exceeds the original requirements with zero-copy optimization and comprehensive CommonMark support. Key refinements:

1. Import path correction (`@markdown` instead of `stdlib/markdown.cxy`)
2. Error handling acknowledgment (`!void` return types)
3. Zero-copy optimizations at two levels:
   - **Parsing:** Lexer uses `__string` slices instead of allocating String copies
   - **Caching:** Response chunking with `__string` refs avoids copying cached HTML

No architectural changes required. Ready for implementation. ✅

---

## Overview

The Cxy Package Registry is a central index for discovering, publishing, and
tracking Cxy packages. It is the server-side counterpart to the `cxy package`
CLI tool.

Packages in Cxy are git-repository based — there are no binary tarballs hosted
on the registry. The registry acts as a **catalog**: it stores metadata read
from each package's `Cxyfile.yaml` and `README.md`, tracks version history via
git tags, records download statistics, and exposes everything through both a
JSON REST API (consumed by the `cxy` CLI) and a server-side-rendered web UI
(consumed by humans).

```
┌─────────────────────┐         ┌──────────────────────────┐
│   cxy package CLI   │◄──────► │  Registry REST API       │
│  (install / search) │  JSON   │  /api/v1/...             │
└─────────────────────┘         └──────────┬───────────────┘
                                           │
┌─────────────────────┐                    │ shared
│   Browser           │◄──────────────────►│ handlers /
│  (human browsing)   │   SSR HTML         │ data layer
└─────────────────────┘         ┌──────────┴───────────────┐
                                │  SQLite Database         │
                                │  (Postgres later)        │
                                └──────────────────────────┘
```

---

## Goals and Non-Goals

### Goals

- **Discovery** — allow developers to search for packages by name, keyword, or
  author.
- **Metadata** — surface every field from `Cxyfile.yaml` (name, version,
  description, author, license, repository, homepage) alongside a rendered
  `README.md`, mirroring the npm package page experience.
- **Version tracking** — list all published versions of a package, their git
  tags, commit hashes, and publish dates.
- **Download statistics** — track total downloads and per-version download
  counts; show weekly/monthly trends on the package page.
- **CLI integration** — provide a stable JSON API so `cxy package install`,
  `cxy package add`, and `cxy package info` can resolve package metadata,
  version constraints, and checksums from the registry.
- **SSR web UI** — render all pages server-side using the `cxyml` plugin so the
  site works without JavaScript (JS is only used for the new-post-style submit
  flow on the publish form).
- **Publishing** — allow package authors to register a new package or publish a
  new version via a simple API call, secured with a publish token.

### Non-Goals

- **Binary hosting** — packages are always fetched directly from their git
  repositories; the registry stores metadata only.
- **Authentication / accounts** — user accounts, OAuth, and access control are
  out of scope for v1. Publish tokens are issued manually.
- **Private packages** — all indexed packages are public.
- **Dependency resolution** — the full resolution algorithm runs in the CLI,
  not the server.

---

## Architecture

### Request flow — CLI

```
cxy package install
  → reads Cxyfile.yaml
  → for each dependency:
      GET /api/v1/packages/{name}          # resolve git URL + latest version
      GET /api/v1/packages/{name}/{version} # get commit hash + checksum
      git clone <repository> @ <commit>
      POST /api/v1/packages/{name}/{version}/download  # record stat
```

### Request flow — Browser

```
Browser GET /packages/cxyml
  → server queries SQLite
  → renders PackagePage component via cxyml::render(...)
  → returns complete HTML — no client-side framework
```

### Component boundaries

```
src/
  main.cxy          ← HTTP server, route wiring
  db.cxy            ← RegistryDb class (all SQL)
  models.cxy        ← Package, Version, Dependency structs
  api/
    packages.cxy    ← JSON handlers for /api/v1/...
  pages/            ← SSR page components
  components/       ← Reusable UI components
  static/           ← CSS, served via SendFile
```

---

## Package Lifecycle

### 1. Publishing a new package

A package author runs (or will run, once `cxy package publish` is implemented):

```bash
cxy package publish --registry https://registry.cxy-lang.org
```

The CLI already has everything it needs locally — it reads `Cxyfile.yaml` and
`README.md` from disk, resolves the tag to a commit hash via `git rev-parse`,
and computes the source tree checksum. It sends all of this in one request:

```
POST /api/v1/packages
Authorization: Bearer <publish-token>
Content-Type: application/json

{
  "repository": "https://github.com/alice/cxyml.git",
  "tag":        "v0.2.0",
  "commit":     "c060158f3a...",
  "checksum":   "sha256:a1b2c3...",
  "metadata": {
    "name":        "cxyml",
    "version":     "0.2.0",
    "description": "Compile-time HTML templating plugin for Cxy",
    "author":      "Alice Chen",
    "license":     "MIT",
    "homepage":    "https://cxy-lang.org/cxyml"
  },
  "readme": "# cxyml\n...",
  "dependencies": [
    { "name": "stdlib", "version_constraint": "*", "is_dev": false }
  ]
}
```

The server:
1. Validates the publish token.
2. Runs `git ls-remote <repository> refs/tags/<tag>` to verify the tag and
   commit hash are real and publicly reachable — **no clone required**.
3. Checks the package name is unclaimed or owned by the same repository.
4. Inserts or updates the `packages` row and inserts a new `versions` row.
5. Invalidates the HTML cache for this package: `htmlCache.remove(name)`.
6. Returns the canonical package URL.

If the package name already exists but the repository URL does not match, the
server rejects the request — package names are claimed on a first-come basis.

### 2. Resolving a package during install

```
GET /api/v1/packages/cxyml
→ { name, repository, latest_version, versions: [...] }

GET /api/v1/packages/cxyml/0.2.0
→ { version, tag, commit, checksum, published_at, dependencies: [...] }
```

The CLI uses `commit` and `checksum` to populate `Cxyfile.lock`, ensuring
reproducible builds regardless of what the git tag points to in the future.

### 3. Download tracking

After a successful `git clone`, the CLI posts:

```
POST /api/v1/packages/cxyml/0.2.0/download
```

This is fire-and-forget; the CLI does not wait for or check the response. The
server increments `versions.downloads` and `packages.total_downloads`.

---

## Database Schema

Starting with SQLite. Column types and constraints are written to be
forward-compatible with PostgreSQL (no SQLite-specific syntax in queries).

```sql
-- ─────────────────────────────────────────────
-- Packages — one row per unique package name
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS packages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL UNIQUE,
    description      TEXT,
    author           TEXT,
    license          TEXT,
    repository       TEXT    NOT NULL,
    homepage         TEXT,
    readme           TEXT,           -- raw Markdown from README.md
    total_downloads  INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT    NOT NULL
);

CREATE INDEX idx_packages_name ON packages (name);

-- Full-text search (SQLite FTS5)
CREATE VIRTUAL TABLE IF NOT EXISTS packages_fts USING fts5 (
    name,
    description,
    author,
    content = packages,
    content_rowid = id
);

-- ─────────────────────────────────────────────
-- Versions — one row per published semver tag
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id   INTEGER NOT NULL REFERENCES packages (id),
    version      TEXT    NOT NULL,   -- "1.2.3"
    tag          TEXT,               -- "v1.2.3"
    commit       TEXT    NOT NULL,   -- full git SHA
    checksum     TEXT    NOT NULL,   -- "sha256:<hex>"
    yanked       INTEGER NOT NULL DEFAULT 0,
    downloads    INTEGER NOT NULL DEFAULT 0,
    published_at TEXT    NOT NULL,
    UNIQUE (package_id, version)
);

CREATE INDEX idx_versions_package ON versions (package_id);

-- ─────────────────────────────────────────────
-- Dependencies — from Cxyfile.yaml of a version
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dependencies (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id          INTEGER NOT NULL REFERENCES versions (id),
    name                TEXT    NOT NULL,
    repository          TEXT,
    version_constraint  TEXT    NOT NULL DEFAULT '*',
    is_dev              INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_deps_version ON dependencies (version_id);

-- ─────────────────────────────────────────────
-- Publish tokens — simple bearer token auth
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS publish_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,  -- sha256 of the raw token
    label      TEXT,                     -- human note, e.g. "alice CI"
    created_at TEXT    NOT NULL,
    last_used  TEXT
);
```

### Notes

- `readme` is stored as raw Markdown. The server converts it to HTML at render
  time using a Markdown library (or a lightweight custom renderer). It is
  re-fetched and updated on each new version publish.
- `packages_fts` is kept in sync via triggers on `packages` INSERT/UPDATE.
- When migrating to PostgreSQL, `packages_fts` is replaced with a
  `tsvector` column and a GIN index; no application query changes are needed
  because search goes through the `RegistryDb.search()` method.
- `yanked` versions are excluded from resolution responses but remain visible
  on the web UI with a warning banner.

---

## REST API

Base path: `/api/v1`

All responses are `application/json`. Error responses use:

```json
{ "error": "human-readable message", "code": "SNAKE_CASE_CODE" }
```

---

### Packages

#### `GET /api/v1/packages`

Search / list packages.

| Query param | Type   | Default | Description                        |
|-------------|--------|---------|------------------------------------|
| `q`         | string | —       | Full-text search query             |
| `limit`     | int    | 20      | Max results (capped at 100)        |
| `offset`    | int    | 0       | Pagination offset                  |
| `sort`      | string | `downloads` | `downloads`, `name`, `created` |

Response:

```json
{
  "total": 42,
  "packages": [
    {
      "name": "cxyml",
      "description": "Compile-time HTML templating plugin for Cxy",
      "author": "Alice Chen",
      "license": "MIT",
      "repository": "https://github.com/cxy-lang/cxyml.git",
      "latest_version": "0.2.0",
      "total_downloads": 1820,
      "updated_at": "2025-03-22"
    }
  ]
}
```

---

#### `GET /api/v1/packages/:name`

Full metadata for a package (latest version).

```json
{
  "name": "cxyml",
  "description": "Compile-time HTML templating plugin for Cxy",
  "author": "Alice Chen",
  "license": "MIT",
  "repository": "https://github.com/cxy-lang/cxyml.git",
  "homepage": "https://cxy-lang.org/cxyml",
  "total_downloads": 1820,
  "created_at": "2025-01-10",
  "updated_at": "2025-03-22",
  "latest": {
    "version": "0.2.0",
    "tag": "v0.2.0",
    "commit": "c060158f3a...",
    "checksum": "sha256:a1b2c3...",
    "published_at": "2025-03-22",
    "downloads": 412,
    "dependencies": [
      { "name": "stdlib", "version_constraint": "*", "is_dev": false }
    ]
  },
  "versions": ["0.2.0", "0.1.1", "0.1.0"]
}
```

404 if the package is not found.

---

#### `GET /api/v1/packages/:name/:version`

Metadata for a specific version. Used by the CLI when populating
`Cxyfile.lock`.

```json
{
  "name": "cxyml",
  "version": "0.2.0",
  "tag": "v0.2.0",
  "commit": "c060158f3a...",
  "checksum": "sha256:a1b2c3...",
  "repository": "https://github.com/cxy-lang/cxyml.git",
  "published_at": "2025-03-22",
  "yanked": false,
  "downloads": 412,
  "dependencies": [
    { "name": "stdlib", "version_constraint": "*", "is_dev": false }
  ]
}
```

---

#### `GET /api/v1/packages/:name/versions`

All versions of a package, newest first.

```json
{
  "name": "cxyml",
  "versions": [
    {
      "version": "0.2.0",
      "tag": "v0.2.0",
      "commit": "c060158f3a...",
      "published_at": "2025-03-22",
      "downloads": 412,
      "yanked": false
    },
    {
      "version": "0.1.0",
      "tag": "v0.1.0",
      "commit": "e7303a70...",
      "published_at": "2025-01-10",
      "downloads": 1408,
      "yanked": false
    }
  ]
}
```

---

#### `POST /api/v1/packages`

Register a new package or publish a new version.

**Headers:** `Authorization: Bearer <token>`

**Body:**

```json
{
  "repository": "https://github.com/alice/cxyml.git",
  "tag": "v0.2.0"
}
```

**Response (201 Created):**

```json
{
  "name": "cxyml",
  "version": "0.2.0",
  "url": "https://registry.cxy-lang.org/packages/cxyml"
}
```

**Errors:**
- `401` — missing or invalid token.
- `409` — package name is already claimed by a different repository.
- `422` — tag not found, `Cxyfile.yaml` missing or malformed.

---

#### `POST /api/v1/packages/:name/:version/download`

Increment the download counter. Called by the CLI after a successful install.
Returns `204 No Content`. Intentionally unauthenticated and idempotent enough
for fire-and-forget use.

---

### Health

#### `GET /api/v1/health`

```json
{ "status": "ok", "version": "0.1.0" }
```

---

## Web UI

All pages are server-side rendered via `cxyml::render(...)`. JavaScript is used
only for the publish form's JSON-over-fetch submission (identical pattern to
the `cxyml-demo` new-post form).

### Routes

| Route                         | Page component      | Description                        |
|-------------------------------|---------------------|------------------------------------|
| `GET /`                       | `HomePage`          | Search bar, featured, recent, stats|
| `GET /packages`               | `BrowsePage`        | Paginated list, search, sort       |
| `GET /packages/:name`         | `PackagePage`       | Full package info (latest version) |
| `GET /packages/:name/:version`| `PackagePage`       | Specific version view              |
| `GET /publish`                | `PublishPage`       | Publish form                       |
| `GET /about`                  | `AboutPage`         | Registry info, CLI usage guide     |
| `GET /style.css`              | —                   | `SendFile("static/style.css")`     |

### Page designs

#### Home (`/`)

```
┌─────────────────────────────────────────────────────┐
│  Navbar: [logo]  Packages  Publish  About           │
├─────────────────────────────────────────────────────┤
│                                                     │
│       Search Cxy packages                           │
│       ┌─────────────────────────────────────┐       │
│       │ 🔍  e.g. "json", "http", "crypto"   │       │
│       └─────────────────────────────────────┘       │
│                                                     │
│   📦 1,240 packages   ⬇ 48,000 downloads           │
│                                                     │
│  Recently published        Popular                  │
│  ┌─────────┐ ┌─────────┐  ┌─────────┐ ┌─────────┐   │
│  │ PkgCard │ │ PkgCard │  │ PkgCard │ │ PkgCard │   │
│  └─────────┘ └─────────┘  └─────────┘ └─────────┘   │
└─────────────────────────────────────────────────────┘
```

#### Package page (`/packages/:name`)

```
┌─────────────────────────────────────────────────────┐
│  Navbar                                             │
├─────────────────────────────────────────────────────┤
│  cxyml  v0.2.0   MIT   ⬇ 1,820 downloads           │
│  Compile-time HTML templating plugin for Cxy        │
│  🔗 github.com/cxy-lang/cxyml                       │
├──────────────────────────┬──────────────────────────┤
│                          │  Install                 │
│  README (Markdown →HTML) │  ─────────────────────   │
│                          │  cxy package add         │
│  ...                     │    https://github.com/   │
│                          │    cxy-lang/cxyml.git    │
│                          │                          │
│                          │  Versions                │
│                          │  v0.2.0  2025-03-22  412 │
│                          │  v0.1.0  2025-01-10 1408 │
│                          │                          │
│                          │  Dependencies            │
│                          │  (none)                  │
└──────────────────────────┴──────────────────────────┘
```

### Components

| Component          | Description                                          |
|--------------------|------------------------------------------------------|
| `Navbar`           | Sticky glass navbar with search input                |
| `PackageCard`      | Compact card: name, description, version, downloads  |
| `PackageHeader`    | Name, version badge, license, download count, links  |
| `ReadmeView`       | Rendered Markdown block                              |
| `VersionTable`     | Sorted version list with dates and download counts   |
| `DependencyList`   | Package deps with version constraints                |
| `InstallSnippet`   | Copy-ready `cxy package add` command                 |
| `StatsBanner`      | Registry-wide: total packages, total downloads       |
| `SearchBar`        | Input that submits `GET /packages?q=...`             |
| `PaginationBar`    | Prev / Next with page count                          |

### Markdown rendering

`README.md` is stored as raw Markdown. At render time the server converts it to
HTML using a `Markdown` instance from `@markdown`. To avoid re-rendering on
every request, we use an LRU cache with zero-copy response chunking:

```cxy
import { Markdown } from "@markdown"
import { LRUCache } from "stdlib/collections.cxy"

// server startup (main.cxy):
var md = Markdown()
var htmlCache = LRUCache[String, String](maxSize: 1000)  // ~50MB for popular packages

// HTTP handler:
func handlePackagePage(name: String, res: &Response): !void {
    // Try cache first (zero-copy chunk for cache hits)
    if (var cached = htmlCache.get(name)) {
        // Cxy auto-wraps __string in ResponseChunk union
        res.chunk(cached.__str())
        return
    }
    
    // Cache miss: render markdown
    var pkg = db.getPackage(name)?
    var html = String()
    
    // Render directly into String buffer (zero-copy lexing internally)
    md.toHtml(&html, pkg.readme.__str())
    
    // Store in cache (cache owns the allocation)
    htmlCache.set(name, &&html)
    
    // Stream to response (zero-copy chunk)
    res.chunk(html.__str())
}
```

**Zero-copy at two levels:**
1. **Parsing:** Markdown lexer uses `__string` slices into source (no token allocations)
2. **Caching:** `chunk(__string)` references cached content (no body copy, auto-wrapped in ResponseChunk)

**Cache characteristics:**
- LRU eviction handles power-law traffic distribution (80% of requests hit 20% of packages)
- 1000 packages × ~50KB avg = ~50MB memory footprint
- Invalidation: evict key on package publish
- Cold packages render on-demand (acceptable since infrequent)

No schema changes needed — the database always stores raw Markdown source.

---

## Tech Stack

| Concern           | Solution                                            |
|-------------------|-----------------------------------------------------|
| Language          | Cxy                                                 |
| Templates         | `cxyml` plugin — compile-time SSR                   |
| HTTP server       | `stdlib/http.cxy`                                   |
| Database (v1)     | SQLite via `stdlib/sqlite.cxy`                      |
| Database (future) | PostgreSQL (same query interface, swap driver)      |
| JSON API          | `stdlib/json.cxy` — `parse[T]` / `toJSON`           |
| Markdown → HTML   | `@markdown` — `Markdown` class with zero-copy lexing and caching |
| Git operations    | Shell out to `git` for clone / tag / commit lookup  |
| Auth              | SHA-256 hashed bearer tokens stored in SQLite       |
| Static files      | `SendFile` — zero-copy kernel transfer              |
| Styling           | Plain CSS with custom properties; Inter + Lora fonts|

---

## Project Structure

```
package-manager/
├── Cxyfile.yaml
├── main.cxy                       # HTTP server entry point
├── docs/
│   └── DESIGN.md                  # this document
├── src/
│   ├── models.cxy                 # Package, Version, Dependency, Token structs
│   ├── db.cxy                     # RegistryDb class — all SQL in one place
│   ├── git.cxy                    # Git helper: ls-remote tag verification
│   ├── api/
│   │   └── packages.cxy           # JSON handlers for /api/v1/packages/*
│   ├── components/
│   │   ├── navbar.cxy
│   │   ├── package_card.cxy
│   │   ├── package_header.cxy
│   │   ├── readme_view.cxy
│   │   ├── version_table.cxy
│   │   ├── dependency_list.cxy
│   │   ├── install_snippet.cxy
│   │   └── pagination_bar.cxy
│   └── pages/
│       ├── home_page.cxy
│       ├── home_page.cxyml
│       ├── browse_page.cxy
│       ├── browse_page.cxyml
│       ├── package_page.cxy
│       ├── package_page.cxyml
│       ├── publish_page.cxy
│       ├── about_page.cxy
│       └── not_found_page.cxy
└── static/
    └── style.css
```

### Key classes

**`RegistryDb`** — wraps `Database`, owns all SQL:
```
RegistryDb.open(path)
  .migrate()          schema + FTS triggers
  .searchPackages(q, limit, offset, sort) → Vector[Package]
  .getPackage(name) → Optional[Package]
  .getVersion(packageId, version) → Optional[Version]
  .listVersions(packageId) → Vector[Version]
  .recordDownload(packageId, versionId)
  .publishPackage(meta, versionMeta) → !i64
  .validateToken(hash) → bool
```

**`GitClient`** — shells out to `git` for lightweight remote verification only:
```
GitClient.verifyTag(repo, tag, commit) → !bool
  // runs: git ls-remote <repo> refs/tags/<tag>
  // confirms the resolved commit matches what the CLI reported
```

---

## Future Considerations

### PostgreSQL migration

The `RegistryDb` class is the only place SQL is written. Migrating to
PostgreSQL requires:

1. Swapping `stdlib/sqlite.cxy` for a PostgreSQL driver.
2. Replacing the FTS5 virtual table with a `tsvector` column + GIN index.
3. Replacing `AUTOINCREMENT` with `SERIAL` / `GENERATED ALWAYS AS IDENTITY`.
4. No changes to the HTTP handlers or page components.

All queries are parameterised; no raw string interpolation of user data touches
the database.

### Caching

**Status:** ✅ Design complete (see [Design Review](#design-review--march-2026))

The registry uses a two-level zero-copy caching strategy:

1. **In-process LRU cache** for rendered HTML (1000 packages, ~50MB):
   - `LRUCache[String, String]` stores markdown→HTML conversions
   - `chunk(__string)` enables zero-copy chunking to response (auto-wrapped in ResponseChunk)
   - Invalidated on package publish via `htmlCache.remove(name)`
   - Handles power-law traffic distribution (80/20 rule)

2. **HTTP cache headers** (future):
   - `ETag` + `Cache-Control` on JSON API endpoints
   - Allows CLI to avoid redundant round-trips when package unchanged
   - Computed from package `updated_at` timestamp

### Package scoring / ranking

Beyond raw download counts, a future ranking signal could include:

- Recency of last publish.
- Number of dependent packages (reverse dependency graph).
- README completeness (has description, license, usage section).

### Namespacing / ownership

V1 uses a flat namespace (first publisher claims the name). A future `@scope`
system (similar to npm's `@org/pkg`) could be layered in without breaking
existing package names.

### Webhooks

Allow package authors to register a webhook URL that receives a POST whenever
their package is installed, giving them real-time download data without polling
the registry API.
