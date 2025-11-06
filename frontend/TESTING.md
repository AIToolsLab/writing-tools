# Vite Build Regression Tests

This directory contains regression tests for the Vite build configuration to prevent issues that were caught during code review.

## Test Suites

### 1. Build Output Tests (`test-build-output.mjs`)

Tests the production build output to ensure:
- ✅ HTML files are at `dist/` root (not `dist/src/`)
- ✅ No HTML files remain in subdirectories
- ✅ Asset paths in HTML use absolute paths (`/assets/...`)
- ✅ Static files from `public/` are copied to `dist/` root
- ✅ Assets directory structure is correct
- ✅ `manifest.xml` exists and is properly transformed

**Run:** `npm run test:build`

**When to run:** After any changes to `vite.config.ts` or build process

### 2. Dev Server Tests (`test-dev-server.mjs`)

Tests the development server to ensure:
- ✅ HTML entry points are accessible at root paths
- ✅ Static files from `public/` are served correctly
- ✅ Asset files are accessible at `/assets/`
- ✅ Non-existent paths return 404
- ✅ Files that should NOT exist (like `/src/taskpane.html`) return 404

**Run:** `npm run test:dev-server`

**Prerequisites:** Dev server must be running (`npm run dev-server`)

### 3. Combined Test (`test:vite`)

Runs a full build and tests the output.

**Run:** `npm run test:vite`

## Issues These Tests Prevent

### Issue 1: HTML Files in Wrong Location
**Problem:** HTML files were output to `dist/src/` instead of `dist/` root, causing 404s.

**Test:** Build Output Test #1, #2

**How:** Verifies all HTML files exist at dist root and no HTML files exist in subdirectories.

### Issue 2: Broken Asset Paths
**Problem:** When HTML files were manually moved, relative asset paths broke (e.g., `../assets/...` became incorrect).

**Test:** Build Output Test #3

**How:** Parses HTML files to verify asset paths use absolute paths (`/assets/...`).

### Issue 3: Static Files Not Copied
**Problem:** Before using `publicDir`, static files weren't copied correctly.

**Test:** Build Output Test #4

**How:** Verifies all static files from `public/` exist in `dist/`.

### Issue 4: Dev Server Path Issues
**Problem:** Dev server wasn't serving files at expected paths.

**Test:** Dev Server Tests #1-4

**How:** Makes HTTP requests to verify all endpoints return correct status codes.

## CI Integration

Add to your CI pipeline:

```yaml
- name: Build and Test
  run: |
    cd frontend
    npm install
    npm run test:vite
```

## Local Development

Before committing changes to Vite config:

```bash
# Build and test
npm run test:vite

# Or test individually
npm run build
npm run test:build

# For dev server tests (in separate terminal)
npm run dev-server
npm run test:dev-server
```

## Adding New Tests

When adding new entry points or changing the build structure:

1. Add new test cases to `test-build-output.mjs` or `test-dev-server.mjs`
2. Run tests to verify they fail without your changes
3. Implement your changes
4. Verify tests pass
5. Commit both changes and updated tests
