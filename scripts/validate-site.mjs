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
const styles = readFileSync(join(siteRoot, "styles.css"), "utf8");
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
const changelog = readFileSync(join(projectRoot, "CHANGELOG.md"), "utf8");
const deploymentGuide = readFileSync(
  join(projectRoot, "INTERNAL_DEPLOYMENT.md"),
  "utf8"
);
const publicationPolicy = readFileSync(
  join(projectRoot, "PUBLICATION_POLICY.md"),
  "utf8"
);
const RELEASE_DATE = "2026-09-07";
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
    join(siteRoot, "js", "tools", "receipt-inspector.js"),
    join(siteRoot, "js", "lib", "strict-json.js"),
    join(siteRoot, "js", "workers", "extract-auditor-job.js"),
    join(siteRoot, "js", "workers", "extract-auditor-worker.js"),
    join(siteRoot, "js", "views", "conformance-checker.js"),
    join(projectRoot, "README.md"),
    join(projectRoot, "INTERNAL_DEPLOYMENT.md"),
    join(projectRoot, "PUBLICATION_POLICY.md"),
    join(projectRoot, "package-lock.json"),
    join(projectRoot, "SECURITY.md"),
    join(projectRoot, "CONTRIBUTING.md"),
    join(projectRoot, ".github", "ISSUE_TEMPLATE", "config.yml"),
    join(projectRoot, ".github", "ISSUE_TEMPLATE", "report-a-problem.yml"),
    join(projectRoot, ".github", "ISSUE_TEMPLATE", "share-a-workflow.yml"),
    join(projectRoot, "docs", "CONFORMANCE_CHECKER.md"),
    join(projectRoot, "docs", "RECEIPT_INSPECTOR.md"),
    join(projectRoot, "scripts", "build-operational-release.mjs"),
    join(projectRoot, "scripts", "lib", "deterministic-zip.mjs"),
    join(projectRoot, "tests", "operational-release.test.js"),
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
  assert.equal((html.match(/<h1\b/g) ?? []).length, 6);
  assert.match(html, /href="#validate" data-route-link="validate"/);
  assert.match(html, /href="#receipts" data-route-link="receipts"/);
  assert.match(html, /id="checker-form"/);
  assert.match(html, /id="checker-diagnostic-body"/);
  for (const id of [
    "audit-submit",
    "audit-cancel",
    "audit-clear",
    "audit-clear-status",
    "audit-progress",
    "audit-progress-bar",
    "audit-progress-phase",
    "audit-download-note",
    "receipt-form",
    "receipt-file",
    "receipt-submit",
    "receipt-example",
    "receipt-reset",
    "receipt-source-1",
    "receipt-source-2",
    "receipt-error",
    "receipt-status",
    "receipt-result",
    "receipt-digest-status",
    "receipt-replay-status",
    "receipt-source-result-body"
  ]) {
    assert.match(html, new RegExp(`\\sid="${id}"`));
  }
  assert.match(
    html,
    /id="audit-key-columns"[\s\S]*maxlength="10000"/
  );
  assert.match(html, /Five-minute tutorial: fail, diagnose, and correct/);
  assert.match(html, /The detailed CSV can contain operational keys and values/);
  assert.match(html, /Internal consistency is not proof of identity/);
  assert.match(html, /Strict JSON only · 256 KB maximum/);
  assert.match(
    html,
    /Catch changed records and schema drift before they reach a healthcare report\./
  );
  assert.match(
    html,
    /class="button button-primary" href="#auditor">Try the synthetic extract audit/
  );
  assert.match(html, /issues\/new\/choose/);
  assert.match(html, /never include PHI, employer-confidential/i);
});

check("overview full-bleed layout avoids scrollbar-sensitive viewport math", () => {
  const heroRules = [...styles.matchAll(/\.hero\s*\{([^}]*)\}/gs)].map(
    (match) => match[1]
  );
  assert.ok(heroRules.length > 0, "Expected at least one .hero rule");
  for (const rule of heroRules) {
    assert.doesNotMatch(
      rule,
      /\b100vw\b/,
      "Hero layout must use its containing block rather than scrollbar-sensitive 100vw"
    );
  }
  assert.match(styles, /\.page\.overview-page\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.hero\s*\{[^}]*margin-inline:\s*0/s);
  assert.doesNotMatch(
    styles,
    /(?:^|\n)\s*(?:html|body)\s*\{[^}]*overflow-x:\s*(?:hidden|clip)/gs,
    "Horizontal overflow must be fixed in layout rather than hidden globally"
  );
});

check("disabled button text meets WCAG AA contrast", () => {
  const rule = styles.match(/\.button:disabled\s*\{([^}]*)\}/s)?.[1];
  assert.ok(rule, "Expected a shared .button:disabled rule");

  const foregroundVariable = rule.match(
    /(?:^|;)\s*color:\s*var\((--[\w-]+)\)\s*;/
  )?.[1];
  const background = rule.match(
    /(?:^|;)\s*background:\s*(#[\da-f]{6})\s*;/i
  )?.[1];
  const variables = Object.fromEntries(
    [...styles.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(
      ([, name, value]) => [name, value]
    )
  );
  const foreground = variables[foregroundVariable];

  assert.ok(foreground, "Disabled button text must resolve to a hex color variable");
  assert.ok(background, "Disabled button background must be a six-digit hex color");
  assert.ok(
    contrastRatio(foreground, background) >= 4.5,
    `Disabled button contrast must be at least 4.5:1; got ${contrastRatio(
      foreground,
      background
    ).toFixed(3)}:1`
  );
});

check("sharing metadata identifies the canonical live site", () => {
  const canonical =
    "https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/";
  assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${canonical}"`));
  assert.match(html, new RegExp(`<meta\\s+property="og:url"\\s+content="${canonical}"`));
  assert.match(html, /property="og:image"[\s\S]*social-card\.png/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(
    html,
    /property="og:title" content="Catch CSV extract changes before they reach a report"/
  );

  const socialCard = readFileSync(join(siteRoot, "social-card.png"));
  assert.equal(
    socialCard.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "Social card must be a PNG"
  );
  assert.equal(socialCard.readUInt32BE(16), 1200, "Social card width must be 1200");
  assert.equal(socialCard.readUInt32BE(20), 630, "Social card height must be 630");
});

check("feedback forms enforce the public-data boundary", () => {
  const issueTemplateRoot = join(projectRoot, ".github", "ISSUE_TEMPLATE");
  const forms = ["report-a-problem.yml", "share-a-workflow.yml"].map(
    (filename) => readFileSync(join(issueTemplateRoot, filename), "utf8")
  );
  for (const form of forms) {
    assert.match(form, /no PHI/i);
    assert.match(form, /no employer-confidential/i);
    assert.match(form, /no licensed reporting-standard content/i);
    assert.match(form, /vendor-proprietary schemas or specifications/i);
    assert.match(form, /synthetic and independently created/i);
    assert.doesNotMatch(form, /^labels:/m);
  }
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
  const axeVersion = packageMetadata.devDependencies["axe-core"];
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
  assert.match(
    axeVersion,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/,
    "axe-core must use an exact semantic version"
  );
  assert.equal(
    packageLock.packages[""].devDependencies["axe-core"],
    axeVersion,
    "The root lockfile axe-core dependency must match package.json"
  );
  assert.equal(
    packageLock.packages["node_modules/axe-core"].version,
    axeVersion,
    "The installed axe-core version must match the declared exact version"
  );
  assert.match(html, new RegExp(`>v${TOOLKIT_VERSION.replaceAll(".", "\\.")}<`));
  assert.match(
    citationMetadata,
    new RegExp(`^version: "${TOOLKIT_VERSION.replaceAll(".", "\\.")}"$`, "m")
  );
  assert.match(
    citationMetadata,
    new RegExp(`^date-released: "${RELEASE_DATE}"$`, "m")
  );
  assert.match(
    changelog,
    new RegExp(
      `^## \\[${TOOLKIT_VERSION.replaceAll(".", "\\.")}\\] - ${RELEASE_DATE}$`,
      "m"
    )
  );
  assert.match(
    changelog,
    new RegExp(
      `^\\[${TOOLKIT_VERSION.replaceAll(".", "\\.")}\\]: https://github\\.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v${TOOLKIT_VERSION.replaceAll(".", "\\.")}$`,
      "m"
    )
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
  for (const id of ["checker-clear", "checker-clear-status"]) {
    assert.match(html, new RegExp(`\\sid="${id}"`));
  }
  assert.equal(
    packageMetadata.scripts["package:release"],
    "node scripts/build-operational-release.mjs"
  );
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
  const releaseBuilder = readFileSync(
    join(projectRoot, "scripts", "build-operational-release.mjs"),
    "utf8"
  );
  const pages = readFileSync(
    join(projectRoot, ".github", "workflows", "pages.yml"),
    "utf8"
  );
  const browserTest = readFileSync(
    join(projectRoot, "tests", "browser", "extract-auditor.browser.mjs"),
    "utf8"
  );
  assert.match(ci, /Chrome 100,000-row extract audit/);
  assert.match(ci, /npm ci --ignore-scripts/);
  assert.match(ci, /CHROME_PATH="\$chrome_path" npm run test:browser/);
  assert.match(ci, /Require a version bump for deployable site changes/);
  assert.match(ci, /gh api --paginate/);
  assert.match(ci, /git ls-remote --exit-code --tags origin/);
  assert.match(ci, /elif \[\[ "\$tag_status" -ne 2 \]\]/);
  assert.match(ci, /release-provenance\.json/);
  assert.match(ci, /Published provenance and \$tag resolve to different commits/);
  assert.match(
    ci,
    /Published release target and provenance resolve to different commits/
  );
  assert.match(ci, /git diff --quiet "\$anchor_commit" HEAD -- site/);
  assert.match(browserTest, /verifyReceiptJourney\(page, reportingWindowReceipt\)/);
  assert.match(browserTest, /verifyAccessibility\(page, "receipts"\)/);
  assert.match(pages, /workflow_run:/);
  assert.match(pages, /workflows: \["Quality gates"\]/);
  assert.match(pages, /branches: \[main\]/);
  assert.match(pages, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(pages, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(pages, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(
    pages,
    /group: github-pages-\$\{\{ github\.event\.workflow_run\.event \}\}-\$\{\{ github\.event\.workflow_run\.head_branch \}\}/
  );
  assert.match(pages, /concurrency:[\s\S]*?queue: max[\s\S]*?jobs:/);
  assert.match(pages, /TESTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(pages, /test "\$current_sha" = "\$TESTED_SHA"/);

  assert.match(release, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(release, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(release, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(
    release,
    /group: validated-release-\$\{\{ github\.event\.workflow_run\.event \}\}-\$\{\{ github\.event\.workflow_run\.head_branch \}\}/
  );
  assert.match(release, /concurrency:[\s\S]*?queue: max[\s\S]*?jobs:/);
  assert.match(release, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(release, /test "\$\(git rev-parse HEAD\)" = "\$VALIDATED_SHA"/);
  assert.match(release, /git diff --quiet "\$tag" "\$VALIDATED_SHA" -- site/);
  assert.match(release, /gh api --paginate/);
  assert.match(
    release,
    /gh api "repos\/\$REPOSITORY\/commits\/\$release_target" --jq '\.sha'/
  );
  assert.match(release, /"\$release_target_sha" == "\$tag_sha"/);
  assert.match(release, /"\$release_target_sha" == "\$VALIDATED_SHA"/);
  assert.match(release, /npm run package:release --/);
  assert.match(release, /--repository-url "\$GITHUB_SERVER_URL\/\$REPOSITORY"/);
  assert.match(release, /git worktree add --detach "\$tagged_source" "\$tag_sha"/);
  assert.match(
    release,
    /cmp "\$expected_directory\/\$name" "\$destination\/\$name"/
  );
  assert.match(
    release,
    /expected="\$\(printf '%s\\n' SHA256SUMS "\$provenance_name" "\$zip_name" \| sort\)"/
  );
  assert.match(release, /sha256sum --check SHA256SUMS/);
  const releaseLines = release.split("\n");
  const assetDirectoryLines = releaseLines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        line ===
        "          ASSET_DIR: ${{ runner.temp }}/operational-release-assets"
    );
  assert.equal(
    assetDirectoryLines.length,
    2,
    "Each release step that uses ASSET_DIR must define it explicitly"
  );
  for (const { index } of assetDirectoryLines) {
    assert.equal(
      releaseLines[index - 1],
      "        env:",
      "runner.temp is available in step env, not job env"
    );
  }
  assert.match(releaseBuilder, /verifySourceCommit\(root, commit\)/);
  assert.match(releaseBuilder, /\["rev-parse", "HEAD"\]/);
  assert.match(releaseBuilder, /"diff", "--quiet", commit/);
  assert.match(releaseBuilder, /"ls-files",\s*"--others"/s);

  const publishedVerification = release.indexOf(
    '"$RUNNER_TEMP/published-assets" "$tag_sha" "$expected_assets"'
  );
  const publishedNoop = release.indexOf(
    "Published release $tag and its three assets are verified; nothing to do."
  );
  const draftCreation = release.indexOf("-F draft=true");
  const assetUpload = release.indexOf('gh release upload "$tag"');
  const uploadedVerification = release.indexOf(
    '"$RUNNER_TEMP/uploaded-assets" "$VALIDATED_SHA" "$ASSET_DIR"'
  );
  const publishRelease = release.indexOf("-F draft=false");
  const finalVerification = release.lastIndexOf(
    '"$RUNNER_TEMP/published-assets" "$VALIDATED_SHA" "$ASSET_DIR"'
  );
  assert.ok(
    publishedVerification >= 0 && publishedNoop > publishedVerification,
    "An existing published release may no-op only after all assets are verified"
  );
  assert.ok(
    draftCreation >= 0 && assetUpload > draftCreation,
    "A new release must remain a draft while assets are uploaded"
  );
  assert.ok(
    uploadedVerification > assetUpload && publishRelease > uploadedVerification,
    "Uploaded assets must be verified before the release is published"
  );
  assert.ok(
    finalVerification > publishRelease,
    "Published assets must receive a final provenance and checksum verification"
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

check("generic publication safety scan is clean", () => {
  const unsafePatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    new RegExp(`\\b${["gh", "p_"].join("")}[A-Za-z0-9]{20,}\\b`),
    new RegExp(`\\b${["github_", "pat_"].join("")}[A-Za-z0-9_]{20,}\\b`),
    new RegExp(`\\b${["s", "k-"].join("")}[A-Za-z0-9]{20,}\\b`),
    new RegExp(["@gmail", "[.]com\\b"].join(""), "i"),
    /\/(?:workspace|root)\//,
    /\/(?:Users|home)\/[A-Za-z0-9._-]+\//,
    /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\/i,
    /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s]+/i,
    /\b(?:Server|Data Source)=[^;\r\n]+;[^\r\n]*(?:Password|Pwd)=/i
  ];
  for (const file of projectFiles.filter(isTextFile)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of unsafePatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relative(projectRoot, file)} violates the publication boundary`
      );
    }
  }
});

check("public release and deployment policy are explicit", () => {
  assert.match(publicationPolicy, /separate,\s*private configuration/i);
  assert.match(publicationPolicy, /Do not commit that configuration/i);
  assert.match(deploymentGuide, /file:\/\/\//);
  assert.match(deploymentGuide, /frame-ancestors 'none'/);
  assert.match(deploymentGuide, /Clear selected data/);
  assert.match(deploymentGuide, /rollback/i);
  assert.match(deploymentGuide, /SHA256SUMS/);
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

function contrastRatio(foreground, background) {
  const [lighter, darker] = [foreground, background]
    .map(relativeLuminance)
    .sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hexColor) {
  const channels = hexColor
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
