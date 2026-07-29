import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(projectRoot, "dist");
const productionEnv = loadEnv("production", projectRoot, "VITE_");
const expectedBackendUrl = productionEnv.VITE_BACKEND_URL?.trim() ?? "";
const searchableExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"]);

function fail(message) {
  throw new Error(`Pages artifact verification failed: ${message}`);
}

function validateBackendUrl(raw) {
  if (!raw) fail("VITE_BACKEND_URL is missing from .env.production.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`VITE_BACKEND_URL is not a valid absolute URL: ${raw}`);
  }
  if (parsed.protocol !== "https:") {
    fail(`VITE_BACKEND_URL must use HTTPS, received: ${raw}`);
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

validateBackendUrl(expectedBackendUrl);

const indexPath = join(distRoot, "index.html");
if (!(await stat(indexPath).catch(() => null))?.isFile()) {
  fail("dist/index.html is missing.");
}

const files = await filesBelow(distRoot);
const environmentFiles = files.filter((path) => {
  const name = path.slice(distRoot.length + 1).split(/[\\/]/).at(-1) ?? "";
  return name === ".env" || name.startsWith(".env.");
});
if (environmentFiles.length > 0) {
  fail(`environment files were published: ${environmentFiles.join(", ")}`);
}

let compiledText = "";
for (const path of files) {
  if (!searchableExtensions.has(extname(path).toLowerCase())) continue;
  compiledText += await readFile(path, "utf8");
}

if (!compiledText.includes(expectedBackendUrl)) {
  fail(`the compiled output does not contain ${expectedBackendUrl}.`);
}

console.log(`Pages artifact verified for ${expectedBackendUrl}.`);
