import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECEIPT_SCHEMA_URL,
  RECEIPT_SCHEMA_VERSION,
  TOOLKIT_VERSION
} from "../site/js/lib/analysis-receipt.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(projectRoot, "site");
const htmlPath = join(siteRoot, "index.html");
const html = readFileSync(htmlPath, "utf8");
const receiptSchemaPath = join(
  siteRoot,
  "schemas",
  "analysis-receipt.schema.json"
);
const receiptSchema = JSON.parse(readFileSync(receiptSchemaPath, "utf8"));
const packageMetadata = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8")
);
const packageLock = JSON.parse(
  readFileSync(join(projectRoot, "package-lock.json"), "utf8")
);
const citationMetadata = readFileSync(
  join(projectRoot, "CITATION.cff"),
  "utf8"
);
const siteFiles = walk(siteRoot);
const projectFiles = walk(projectRoot);

const checks = [];
function check(name, action) {
  action();
  checks.push(name);
}

check("required public files exist", () => {
  for (const path of [
    htmlPath,
    join(siteRoot, "styles.css"),
    join(siteRoot, "js", "app.js"),
    join(siteRoot, "favicon.svg"),
    join(siteRoot, "social-card.png"),
    receiptSchemaPath,
    join(siteRoot, "contracts", "catalog-v1.json"),
    join(siteRoot, "js", "data", "edge-case-contracts.js"),
    join(siteRoot, "js", "tools", "conformance-checker.js"),
    join(siteRoot, "js", "tools", "extract-auditor-limits.js"),
    join(siteRoot, "js", "workers", "extract-auditor-job.js"),
    join(siteRoot, "js", "workers", "extract-auditor-worker.js"),
    join(siteRoot, "js", "views", "conformance-checker.js"),
    join(projectRoot, "README.md"),
    join(projectRoot, "package-lock.json"),
    join(projectRoot, "SECURITY.md"),
    join(projectRoot, "CONTRIBUTING.md"),
    join(projectRoot, "docs", "CONFORMANCE_CHECKER.md"),
    join(
      projectRoot,
      "tests",
      "browser",
      "extract-auditor.browser.mjs"
    )
  ]) {
    assert.equal(statSync(path).isFile(), true, `Missing ${relative(projectRoot, path)}`);
  }
});

check("HTML declares core accessibility and security metadata", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src 'self'/);
  assert.doesNotMatch(html, /worker-src[^"]*blob:/);
  assert.match(html, /<a class="skip-link" href="#main-content">/);
  assert.match(html, /<main id="main-content"/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 5);
  assert.match(html, /href="#validate" data-route-link="validate"/);
  assert.match(html, /id="checker-form"/);
  assert.match(html, /id="checker-diagnostic-body"/);
  for (const id of [
    "audit-submit",
    "audit-cancel",
    "audit-progress",
    "audit-progress-bar",
    "audit-progress-phase",
    "audit-download-note"
  ]) {
    assert.match(html, new RegExp(`\\sid="${id}"`));
  }
  assert.match(
    html,
    /id="audit-key-columns"[\s\S]*maxlength="10000"/
  );
  assert.match(html, /Five-minute tutorial: fail, diagnose, and correct/);
  assert.match(html, /The detailed CSV can contain operational keys and values/);
});

check("sharing metadata identifies the canonical live site", () => {
  const canonical =
    "https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/";
  assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${canonical}"`));
  assert.match(html, new RegExp(`<meta\\s+property="og:url"\\s+content="${canonical}"`));
  assert.match(html, /property="og:image"[\s\S]*social-card\.png/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);

  const socialCard = readFileSync(join(siteRoot, "social-card.png"));
  assert.equal(
    socialCard.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "Social card must be a PNG"
  );
  assert.equal(socialCard.readUInt32BE(16), 1200, "Social card width must be 1200");
  assert.equal(socialCard.readUInt32BE(20), 630, "Social card height must be 630");
});

check("analysis-receipt contract and release metadata are synchronized", () => {
  assert.equal(receiptSchema.$id, RECEIPT_SCHEMA_URL);
  assert.equal(
    receiptSchema.properties.schema_version.const,
    RECEIPT_SCHEMA_VERSION
  );
  assert.equal(packageMetadata.version, TOOLKIT_VERSION);
  assert.equal(packageLock.version, TOOLKIT_VERSION);
  assert.equal(packageLock.packages[""].version, TOOLKIT_VERSION);
  const playwrightVersion =
    packageMetadata.devDependencies["playwright-core"];
  assert.match(
    playwrightVersion,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/,
    "Playwright must use an exact semantic version"
  );
  assert.equal(
    packageLock.packages[""].devDependencies["playwright-core"],
    playwrightVersion,
    "The root lockfile dependency must match package.json"
  );
  assert.equal(
    packageLock.packages["node_modules/playwright-core"].version,
    playwrightVersion,
    "The installed Playwright version must match the declared exact version"
  );
  assert.match(html, new RegExp(`>v${TOOLKIT_VERSION.replaceAll(".", "\\.")}<`));
  assert.match(
    citationMetadata,
    new RegExp(`^version: "${TOOLKIT_VERSION.replaceAll(".", "\\.")}"$`, "m")
  );
  for (const id of [
    "window-receipt",
    "audit-receipt",
    "capacity-receipt",
    "checker-receipt",
    "window-action-status",
    "audit-action-status",
    "capacity-action-status",
    "checker-action-status"
  ]) {
    assert.match(html, new RegExp(`\\sid="${id}"`));
  }
  assert.equal(
    receiptSchema.properties.tool.properties.id.enum.length,
    4,
    "Receipt schema must cover exactly the four published tools"
  );
  assert.deepEqual(
    receiptSchema.$defs.sourceFingerprint.properties.role.enum,
    ["baseline", "current", "actual_metrics", "actual_quality"]
  );
});

check("browser and release gates are fail-closed", () => {
  const ci = readFileSync(
    join(projectRoot, ".github", "workflows", "ci.yml"),
    "utf8"
  );
  const release = readFileSync(
    join(projectRoot, ".github", "workflows", "release.yml"),
    "utf8"
  );
  assert.match(ci, /Chrome 100,000-row extract audit/);
  assert.match(ci, /npm ci --ignore-scripts/);
  assert.match(ci, /CHROME_PATH="\$chrome_path" npm run test:browser/);

  const tagLookup = release.indexOf(
    'gh api "repos/$REPOSITORY/git/ref/tags/$TAG"'
  );
  const releaseLookup = release.indexOf(
    'gh api "repos/$REPOSITORY/releases/tags/$TAG"'
  );
  assert.ok(tagLookup >= 0, "Release workflow must verify the tag");
  assert.ok(
    releaseLookup > tagLookup,
    "Existing releases may be accepted only after the tag is verified"
  );
});

check("HTML IDs are unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Duplicate HTML id found");
});

check("every JavaScript element reference resolves to an HTML ID", () => {
  const ids = new Set(
    [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  );
  for (const file of siteFiles.filter((path) => path.endsWith(".js"))) {
    const source = readFileSync(file, "utf8");
    const referencedIds = [
      ...source.matchAll(/\bbyId\("([^"]+)"\)/g)
    ].map((match) => match[1]);
    for (const id of referencedIds) {
      assert.equal(
        ids.has(id),
        true,
        `${relative(projectRoot, file)} references missing HTML id #${id}`
      );
    }
  }
});

check("every labelled control resolves to an element", () => {
  const ids = new Set(
    [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  );
  const labelTargets = [...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(
    (match) => match[1]
  );
  for (const target of labelTargets) {
    assert.equal(ids.has(target), true, `Label target #${target} does not exist`);
  }

  const controls = [
    ...html.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"[^>]*>/g)
  ].map((match) => match[1]);
  for (const control of controls) {
    assert.equal(
      labelTargets.includes(control),
      true,
      `Form control #${control} has no label`
    );
  }
});

check("local scripts, styles, and module imports resolve", () => {
  const localAssets = [
    ...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)
  ]
    .map((match) => match[1])
    .filter((value) => !value.startsWith("http"));
  for (const asset of localAssets) {
    const target = resolve(siteRoot, asset);
    assert.equal(
      target.startsWith(siteRoot) && statSync(target).isFile(),
      true,
      `Missing local asset ${asset}`
    );
  }

  for (const file of siteFiles.filter((path) => path.endsWith(".js"))) {
    const source = readFileSync(file, "utf8");
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)
    ].map((match) => match[1]);
    for (const specifier of imports.filter((value) => value.startsWith("."))) {
      const target = normalize(resolve(dirname(file), specifier));
      assert.equal(
        target.startsWith(siteRoot) && statSync(target).isFile(),
        true,
        `Missing module ${specifier} imported by ${relative(projectRoot, file)}`
      );
    }
  }

  const appSource = readFileSync(join(siteRoot, "js", "app.js"), "utf8");
  const workerUrls = [
    ...appSource.matchAll(
      /new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
    )
  ].map((match) => match[1]);
  assert.deepEqual(workerUrls, ["./workers/extract-auditor-worker.js"]);
  for (const workerUrl of workerUrls) {
    const target = resolve(join(siteRoot, "js"), workerUrl);
    assert.equal(
      target.startsWith(siteRoot) && statSync(target).isFile(),
      true,
      `Missing worker asset ${workerUrl}`
    );
  }
});

check("browser JavaScript has valid syntax", () => {
  for (const file of siteFiles.filter((path) => path.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8"
    });
    assert.equal(
      result.status,
      0,
      `${relative(projectRoot, file)} failed syntax check: ${result.stderr}`
    );
  }
});

check("published application contains no network primitives", () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/
  ];
  for (const file of siteFiles.filter((path) => path.endsWith(".js"))) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relative(projectRoot, file)} contains a network primitive`
      );
    }
  }
});

check("external links use HTTPS and opener protection", () => {
  const anchors = [...html.matchAll(/<a\b[\s\S]*?<\/a>/g)].map(
    (match) => match[0]
  );
  for (const anchor of anchors.filter((value) => /href="https:\/\//.test(value))) {
    assert.match(anchor, /rel="noopener noreferrer"/);
  }
  assert.doesNotMatch(html, /href="http:\/\//);
});

check("repository boundary scan is clean", () => {
  const forbiddenTerms = [
    new RegExp(["St", "\\.?\\s*Joseph(?:'s)?"].join(""), "i"),
    new RegExp(`\\b${["SJ", "HH"].join("")}\\b`, "i"),
    new RegExp(`\\b${["Dove", "tale"].join("")}\\b`, "i"),
    new RegExp(`\\b${["Iron", "works"].join("")}\\b`, "i"),
    new RegExp(`\\b${["Acland", "\\s+Martin"].join("")}\\b`, "i"),
    new RegExp(`\\b${["health-reporting-", "engine"].join("")}\\b`, "i")
  ];
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    new RegExp(`\\b${["gh", "p_"].join("")}[A-Za-z0-9]{20,}\\b`),
    new RegExp(`\\b${["github_", "pat_"].join("")}[A-Za-z0-9_]{20,}\\b`),
    new RegExp(`\\b${["s", "k-"].join("")}[A-Za-z0-9]{20,}\\b`),
    new RegExp(["@gmail", "[.]com\\b"].join(""), "i"),
    new RegExp(["/(?:work", "space|ro", "ot)/"].join(""))
  ];
  for (const file of projectFiles.filter(isTextFile)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of [...forbiddenTerms, ...secretPatterns]) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relative(projectRoot, file)} violates the publication boundary`
      );
    }
  }
});

console.log(`Validated ${checks.length} site and publication checks:`);
for (const name of checks) {
  console.log(`- ${name}`);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (
      directory === projectRoot &&
      entry.isDirectory() &&
      [".git", "node_modules", "playwright-report", "test-results"].includes(
        entry.name
      )
    ) {
      return [];
    }
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function isTextFile(path) {
  return [
    ".cff",
    ".csv",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".svg",
    ".txt",
    ".yml"
  ].some((extension) => path.endsWith(extension)) || path.endsWith("NOTICE");
}
