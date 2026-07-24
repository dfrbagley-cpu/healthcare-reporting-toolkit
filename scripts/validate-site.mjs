import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = join(projectRoot, "site");
const htmlPath = join(siteRoot, "index.html");
const html = readFileSync(htmlPath, "utf8");
const siteFiles = walk(siteRoot);
const projectFiles = walk(projectRoot).filter(
  (path) => !path.includes(`${join(projectRoot, ".git")}`)
);

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
    join(projectRoot, "README.md"),
    join(projectRoot, "SECURITY.md"),
    join(projectRoot, "CONTRIBUTING.md")
  ]) {
    assert.equal(statSync(path).isFile(), true, `Missing ${relative(projectRoot, path)}`);
  }
});

check("HTML declares core accessibility and security metadata", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /<a class="skip-link" href="#main-content">/);
  assert.match(html, /<main id="main-content"/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 4);
});

check("HTML IDs are unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Duplicate HTML id found");
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
    /St\.?\s*Joseph(?:'s)?/i,
    /\bSJHH\b/i,
    /\bDovetale\b/i,
    /\bIronworks\b/i,
    /\bAcland\s+Martin\b/i,
    /\bhealth-reporting-engine\b/i
  ];
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bghp_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/
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
    ".txt",
    ".yml"
  ].some((extension) => path.endsWith(extension)) || path.endsWith("NOTICE");
}
