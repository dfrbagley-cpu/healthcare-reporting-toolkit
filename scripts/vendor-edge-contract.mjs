import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localCatalogPath = resolve(
  projectRoot,
  "site",
  "contracts",
  "catalog-v1.json"
);
const generatedModulePath = resolve(
  projectRoot,
  "site",
  "js",
  "data",
  "edge-case-contracts.js"
);
const [mode, sourceArgument] = process.argv.slice(2);

if (!["--vendor", "--check"].includes(mode) || !sourceArgument) {
  throw new Error(
    "Usage: node scripts/vendor-edge-contract.mjs (--vendor|--check) <catalog-v1.json>"
  );
}

const sourcePath = resolve(process.cwd(), sourceArgument);
const sourceBytes = readFileSync(sourcePath);
const sourceText = sourceBytes.toString("utf8");
const catalog = JSON.parse(sourceText);
verifyCatalog(catalog);
const expectedModule = renderModule(catalog);

if (mode === "--vendor") {
  mkdirSync(dirname(localCatalogPath), { recursive: true });
  mkdirSync(dirname(generatedModulePath), { recursive: true });
  writeFileSync(localCatalogPath, sourceBytes);
  writeFileSync(generatedModulePath, expectedModule, "utf8");
  console.log(
    `Vendored ${catalog.catalog_id} ${catalog.suite_version} (${catalog.catalog_digest}).`
  );
} else {
  assert.deepEqual(
    readFileSync(localCatalogPath),
    sourceBytes,
    "Vendored catalog is not byte-identical to the pinned source catalog."
  );
  assert.equal(
    readFileSync(generatedModulePath, "utf8"),
    expectedModule,
    "Generated browser contract module is stale."
  );
  console.log(
    `Verified ${catalog.catalog_id} ${catalog.suite_version} (${catalog.catalog_digest}).`
  );
}

function verifyCatalog(catalog) {
  assert.equal(catalog.schema_version, "1.0.0");
  assert.equal(catalog.catalog_id, "health-data-edge-cases");
  assert.equal(catalog.suite_version, "0.2.0");
  assert.equal(
    catalog.source_release,
    "https://github.com/dfrbagley-cpu/health-data-edge-cases/releases/tag/v0.2.0"
  );
  assert.ok(Array.isArray(catalog.cases) && catalog.cases.length > 0);
  assert.match(catalog.catalog_digest, /^sha256:[0-9a-f]{64}$/);

  const { catalog_digest: claimedDigest, ...payload } = catalog;
  const actualDigest = `sha256:${createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex")}`;
  assert.equal(
    actualDigest,
    claimedDigest,
    "Catalog digest does not match its canonical payload."
  );
}

function renderModule(catalog) {
  return [
    "// Generated from the byte-identical vendored edge-case contract catalog.",
    "// Do not edit by hand; run scripts/vendor-edge-contract.mjs.",
    `export const CONFORMANCE_CATALOG = Object.freeze(${JSON.stringify(catalog, null, 2)});`,
    ""
  ].join("\n");
}

function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}
