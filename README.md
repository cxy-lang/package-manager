# Cxy Package Registry

A package registry server for the Cxy programming language. This server provides a REST API for publishing, searching, and managing Cxy packages.

## Overview

The Cxy Package Registry acts as a catalog for Cxy packages. It:

- Stores package metadata from `Cxyfile.yaml`
- Tracks version history via git tags
- Records download statistics
- Provides a JSON REST API for the `cxy` CLI tool
- Enables package discovery and search

Packages are git-repository based — the registry stores metadata only, not binaries.

## Building

```bash
cxy package build
```

## Running

### Basic Usage

```bash
./app --jwt-secret "your-secret-key-here"
```

### Configuration Options

The server can be configured via command-line flags or environment variables:

| Flag | Short | Environment Variable | Default | Description |
|------|-------|---------------------|---------|-------------|
| `--port` | `-p` | `PORT` | `8080` | Port to listen on |
| `--db-path` | `-d` | `DB_PATH` | `registry.db` | Path to SQLite database file |
| `--registry-url` | `-r` | `REGISTRY_URL` | `http://localhost:8080` | Public URL of the registry |
| `--jwt-secret` | `-s` | `JWT_SECRET` | *(required)* | JWT secret for token signing |

### Examples

**Using command-line flags:**
```bash
./app --port 3000 --db-path /var/lib/registry.db --jwt-secret "my-secret"
```

**Using environment variables:**
```bash
export PORT=3000
export DB_PATH=/var/lib/registry.db
export JWT_SECRET="my-secret"
./app
```

## Admin Interface

The registry includes a web-based admin interface for managing tokens and packages.

### Accessing the Admin Panel

Navigate to `/admin/login` in your browser (e.g., `http://localhost:8080/admin/login`).

### First-Time Setup

On first startup, an admin token is automatically generated and printed to the console:

```
=====================================
BOOTSTRAP: Admin token generated (save this securely!)
=====================================

eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

Use this token to access admin endpoints:
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

This token expires in 1 year
=====================================
```

**Important:** Save this token securely! It will only be displayed once.

### Admin Features

- **Dashboard** - View registry statistics and recent activity
- **Token Management** - Create JWT tokens for package publishers
  - Publish scope: Can publish packages
  - Admin scope: Full access including token creation
- **Package Management** - Browse packages, yank/unyank versions

### Retrieving Lost Token

If you lose the admin token, retrieve it from the database:

```bash
sqlite3 registry.db "SELECT token FROM admin_token WHERE id = 1"
```

For more details, see [docs/ADMIN.md](docs/ADMIN.md).

## API Usage

**Using environment variables (continued):**
```bash
</text>

export PORT=3000
export DB_PATH=/var/lib/registry.db
export JWT_SECRET=my-secret-key
export REGISTRY_URL=https://registry.example.com
./app
```

**Mixed approach:**
```bash
export JWT_SECRET=my-secret-key
./app --port 3000 --db-path /var/lib/registry.db
```

## API Endpoints

### Health Check

- `GET /api/v1/health` - Server health status

### Packages

- `GET /api/v1/packages` - List/search packages
  - Query params: `q` (search), `limit`, `offset`, `sort`
- `GET /api/v1/packages/{name}` - Get package details
- `GET /api/v1/packages/{name}/versions` - List all versions
- `GET /api/v1/packages/{name}/{version}` - Get specific version
- `POST /api/v1/packages` - Publish a package (requires auth)
- `POST /api/v1/packages/{name}/{version}/download` - Record download

### Admin

- `POST /api/v1/admin/tokens` - Create authentication token (requires admin auth)

## Testing

```bash
cxy package test
```

## Quick Test

After starting the server:

```bash
# Health check
curl http://localhost:8080/api/v1/health

# List packages
curl http://localhost:8080/api/v1/packages

# Search packages
curl "http://localhost:8080/api/v1/packages?q=http&limit=10"
```

## Database

The server uses SQLite for storage. The database is automatically initialized on first run. The schema includes:

- `packages` - Package metadata
- `versions` - Version information
- `dependencies` - Package dependencies
- Full-text search support via SQLite FTS5

## Security

- The JWT secret **must** be kept secure
- Use a strong, randomly generated secret in production
- Consider using environment variables to avoid exposing secrets in command history

## Development

The project structure:

```
src/
├── api/
│   ├── handlers.cxy      # API endpoint handlers
│   ├── middleware.cxy    # Authentication and context middleware
│   ├── admin.cxy         # Admin token generation
│   └── response.cxy      # Response helpers
├── db/
│   ├── schema.cxy        # Database schema
│   └── sqlite_repository.cxy  # SQLite implementation
├── models.cxy            # Data models
└── repository.cxy        # Repository interface

main.cxy                  # Server entry point
```

## License

See LICENSE file for details.