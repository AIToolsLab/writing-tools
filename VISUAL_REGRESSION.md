# Visual Regression Testing Guide

This project uses Playwright to run visual regression tests that capture screenshots and compare them against baseline images.

## Running the tests

1. Navigate to the **Actions** tab in GitHub
2. Select **Playwright Visual Regression Tests** workflow
3. Click **Run workflow** button
4. The workflow will run tests against all browsers (Chromium, Firefox, WebKit)

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

If the UI changes are **intentional** and you want to update the baselines:

1. From the Playwright report, download the actual images for each browser
2. Replace the existing baseline images in `frontend/tests/demo-page-visual.spec.ts-snapshots/`
3. Rename downloaded images to match existing baseline names:
   - `demo-page-chromium-linux.png`
   - `demo-page-firefox-linux.png`
   - `demo-page-webkit-linux.png`
4. Commit and push the updated baseline images
5. Re-run the visual regression test to verify it passes

## Baseline image locations

Current baseline images are stored in:
```
frontend/tests/demo-page-visual.spec.ts-snapshots/
├── demo-page-chromium-linux.png
├── demo-page-firefox-linux.png
└── demo-page-webkit-linux.png
```
