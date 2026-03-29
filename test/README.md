# Integration Tests

Integration tests for the Cxy Package Registry server using the `stdlib/fetch` HTTP client.

## Overview

These tests verify the REST API endpoints by making real HTTP requests to a running server instance. Tests are organized by feature area:

- **Health Check** - Server status and version
- **Package Listing** - Search, pagination, sorting
- **Package Details** - Individual package retrieval
- **Versions** - Version listing and retrieval
- **Downloads** - Download tracking
- **Publishing** - Package publication (requires auth)
- **Admin** - Token management (requires auth)
- **End-to-End** - Complete workflows
- **Error Handling** - Edge cases and validation

## Prerequisites

1. **Server must be running** on `http://localhost:8080`
2. **JWT secret configured** for admin token bootstrapping
3. **Clean database** (optional, for consistent results)

## Running Tests

### 1. Start the Server

```bash
# Terminal 1: Start the registry server
cd package-manager
cxy package build
export JWT_SECRET="test-secret-for-integration-tests"
./app --port 8080
```

Save the admin token printed on first run - you'll need it for authenticated tests.

### 2. Run Tests

```bash
# Terminal 2: Run integration tests
cxy package test test/integration.cxy
```

Or run specific tests by name:

```bash
cxy package test test/integration.cxy --filter "Health"
cxy package test test/integration.cxy --filter "Publish"
```

## Test Structure

### Shared Test Helpers

Tests use a shared `test { }` block with common utilities:

```cxy
test {
    var session = Session.create(BASE_URL)
    var adminToken = ""

    func get(path: __string): !Response { }
    func post(path: __string, body: string): !Response { }
    func postWithAuth(path: __string, body: string, token: __string): !Response { }
    func assertOk(resp: &Response): void { }
    func assertStatus(resp: &Response, expected: u16): void { }
}
```

### Individual Tests

Each test is self-contained:

```cxy
test "Package - get non-existent package returns 404" {
    var resp = get("/api/v1/packages/non-existent-package")
    assertStatus(&resp, Status.NotFound)
}
```

## Authentication

Some tests require authentication but are currently designed to fail gracefully:

- **Publish Package** - Requires `publish` or `admin` token
- **Create Admin Token** - Requires `admin` token

To run authenticated tests:

1. Start the server and save the bootstrap admin token
2. Set the `ADMIN_TOKEN` environment variable:
   ```bash
   export ADMIN_TOKEN="eyJhbGciOi..."
   ```
3. Run tests:
   ```bash
   cxy package test test/integration.cxy
   ```

Alternatively, get the token directly from the database:
```bash
export ADMIN_TOKEN=$(sqlite3 registry.db "SELECT token FROM admin_token WHERE id = 1")
cxy package test test/integration.cxy
```

## Adding New Tests

Follow the existing pattern:

```cxy
test "Feature - specific behavior description" {
    // Arrange
    var input = prepareTestData()

    // Act
    var resp = get("/api/v1/endpoint")

    // Assert
    assertOk(&resp)
    assertContains(resp.body().__str(), "expected")
}
```

### Best Practices

1. **Descriptive names** - `"Feature - specific behavior"`
2. **Test one thing** - Each test should verify a single behavior
3. **Clean assertions** - Use helper functions like `assertOk()`, `assertStatus()`
4. **No side effects** - Tests should be order-independent
5. **Handle errors** - Use `catch` blocks where appropriate

## Test Categories

### ✅ No Authentication Required

- Health checks
- Package listing and search
- Package details retrieval
- Version listing
- Download tracking (POST allowed without auth)

### 🔒 Authentication Required

- Publishing packages (`POST /api/v1/packages`)
- Creating tokens (`POST /api/v1/admin/tokens`)

## Troubleshooting

### Server not running

```
Error: Connection refused
```

**Solution:** Start the server first (see Prerequisites)

### Port already in use

```
Error: Address already in use
```

**Solution:** Stop any existing server instance or change the port

### Tests fail with 401 Unauthorized

**Solution:** Some tests require authentication - this is expected behavior. Set the `ADMIN_TOKEN` environment variable with a valid token to run those tests:
```bash
export ADMIN_TOKEN="your-token-here"
cxy package test test/integration.cxy
```

### Database conflicts

If tests create data that conflicts with existing packages:

```bash
# Stop server and delete database
rm registry.db
# Restart server for clean slate
```

## Expected Results

Most tests should pass without authentication. Tests that require auth will fail with `401 Unauthorized` - this is expected.

**Passing tests:** ~30-35 (all non-authenticated endpoints)
**Failing tests:** ~5-8 (authenticated endpoints without valid token)

## Integration with CI/CD

For automated testing:

```bash
#!/bin/bash
# Start server in background
export JWT_SECRET="ci-test-secret"
./app --port 8080 &
SERVER_PID=$!

# Wait for server to be ready
sleep 2

# Run tests
cxy package test test/integration.cxy

# Capture exit code
TEST_RESULT=$?

# Stop server
kill $SERVER_PID

# Exit with test result
exit $TEST_RESULT
```

## Contributing

When adding new API endpoints:

1. Add corresponding integration tests
2. Test both success and failure cases
3. Verify error messages are user-friendly
4. Check authentication requirements
5. Ensure tests are idempotent

## References

- [Cxy Test Framework](https://docs.cxy-lang.org/testing)
- [stdlib/fetch Documentation](https://docs.cxy-lang.org/stdlib/fetch)
- [API Documentation](../README.md#api-endpoints)