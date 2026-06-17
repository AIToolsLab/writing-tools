# Visual Regression Testing Guide

This project uses Playwright to run visual regression tests that capture screenshots and compare them against baseline images. Currently, we have tests set up only for the demo page of the application.

The tests run as part of the **Frontend Tests** workflow (`.github/workflows/frontend-tests.yml`), in the `e2e` job. Only the Chromium project is enabled in `frontend/playwright.config.ts`, so there is a single baseline:

```
frontend/tests/demo-page-visual.spec.ts-snapshots/
└── demo-page-chromium-linux.png
```

## Understanding test results

- **✅ Pass**: No visual changes detected - your PR is ready for merge
- **❌ Fail**: Visual differences detected - review the changes

## Reviewing visual differences

When tests fail:

1. Go to the failed workflow run
2. Download the **playwright-report** artifact
3. Extract the artifact and open `index.html` in a browser
4. Review the visual comparison showing:
   - Expected (baseline) image
   - Actual (current) image
   - Diff highlighting the changes

## Updating baseline images

Baselines are only pixel-stable when rendered in CI's pinned Playwright container, so don't regenerate them on your own machine. If the UI changes are **intentional**, use the regeneration job:

1. Navigate to the **Actions** tab in GitHub and select the **Frontend Tests** workflow
2. Click **Run workflow**, choose your branch, and check **Regenerate Playwright visual snapshots**
3. The `update-snapshots` job re-renders the baselines in the same container the tests use and commits them back to your branch

Or from the CLI:

```sh
gh workflow run frontend-tests.yml --ref <branch> -f update-snapshots=true
```

Alternatively, you can download the actual image from a failed run's playwright-report artifact, rename it to `demo-page-chromium-linux.png`, and commit it in place of the baseline.
