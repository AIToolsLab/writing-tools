import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Migration: legacy webpack app (ported then deleted), Playwright specs (own
    // runner), build output, and leftover webpack configs are linted by their own
    // tooling, not the Next eslint config.
    "legacy/**",
    "tests/**",
    "dist/**",
    "webpack.config.js",
    "webpack.google-docs.config.js",
  ]),
]);

export default eslintConfig;
