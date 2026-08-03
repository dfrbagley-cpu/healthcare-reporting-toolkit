import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { BASELINE_SAMPLE, CURRENT_SAMPLE } from "../../site/js/samples.js";

const require = createRequire(import.meta.url);
const axeSource = await readFile(
  require.resolve("axe-core/axe.min.js"),
  "utf8"
);

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const siteRoot = join(projectRoot, "site");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "toolkit-browser-test-")
);
const accessibilityViolations = [];
let server;
let browser;
let testFailure;

try {
  server = await startStaticServer(siteRoot);
  browser = await chromium.launch({
    executablePath: await findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(`${server.url}/#overview`, {
    waitUntil: "networkidle"
  });
  await page.addScriptTag({ url: `${server.url}/__test__/axe.min.js` });

  await verifyAccessibility(page, "overview");
  const reportingWindowReceipt = await verifyReportingWindowJourney(page);
  await verifyAccessibility(page, "windows");
  await verifyCapacityJourney(page);
  await verifyAccessibility(page, "capacity");
  await verifyConformanceJourney(page);
  await verifyAccessibility(page, "validate");
  await showRoute(page, "auditor");
  await verifyHundredThousandRows(page);
  await verifyAccessibility(page, "auditor");
  await verifyCancellationAndStaleRunProtection(page);
  await verifyReceiptJourney(page, reportingWindowReceipt);
  await verifyAccessibility(page, "receipts");
  await verifyMobileNavigation(page);
  assert.deepEqual(
    accessibilityViolations,
    [],
    `WCAG 2 A/AA axe violations:\n${JSON.stringify(accessibilityViolations, null, 2)}`
  );
  console.log(
    "Browser-verified all four tool journeys plus receipt inspection, WCAG 2 A/AA axe scans on every route, and the 100,000-row worker audit with bounded output, responsive heartbeat, cancellation, and stale-run protection."
  );
} catch (error) {
  testFailure = error;
}

const cleanupResults = await Promise.allSettled([
  Promise.resolve().then(() => browser?.close()),
  Promise.resolve().then(() => server?.close()),
  Promise.resolve().then(() =>
    rm(temporaryDirectory, { recursive: true, force: true })
  )
]);
if (testFailure) {
  throw testFailure;
}
const cleanupFailures = cleanupResults
  .filter((result) => result.status === "rejected")
  .map((result) => result.reason);
if (cleanupFailures.length > 0) {
  throw new AggregateError(cleanupFailures, "Browser-test cleanup failed.");
}

async function verifyReportingWindowJourney(page) {
  await showRoute(page, "windows");
  await page.locator("#window-example").click();
  await page.locator("#window-result").waitFor({ state: "visible" });

  assert.equal(
    await page.locator("#window-current-start").textContent(),
    "2026-04-01"
  );
  assert.equal(
    await page.locator("#window-current-end").textContent(),
    "2026-06-15"
  );
  assert.equal(
    await page.locator("#window-current-count").textContent(),
    "76"
  );
  assert.equal(
    await page.locator("#window-compare-start").textContent(),
    "2025-04-01"
  );
  assert.equal(
    await page.locator("#window-compare-end").textContent(),
    "2025-06-15"
  );
  assert.equal(
    await page.locator("#window-compare-count").textContent(),
    "76"
  );

  const download = await clickForDownload(page, "#window-download");
  assert.equal(download.suggestedFilename(), "reporting-windows.csv");
  const contents = await saveDownload(download, "reporting-windows.csv");
  assert.match(
    contents,
    /current,Fiscal year to date,2026-04-01,2026-06-15,76,FY 2026\/27/
  );
  assert.match(
    contents,
    /comparison,Like-for-like prior year,2025-04-01,2025-06-15,76,FY 2025\/26/
  );

  const receiptDownload = await clickForDownload(page, "#window-receipt");
  assert.equal(
    receiptDownload.suggestedFilename(),
    "reporting-window-analysis-receipt.json"
  );
  return saveDownload(
    receiptDownload,
    "reporting-window-analysis-receipt.json"
  );
}

async function verifyReceiptJourney(page, reportingWindowReceipt) {
  await showRoute(page, "receipts");
  await page.locator("#receipt-file").setInputFiles({
    name: "reporting-window-analysis-receipt.json",
    mimeType: "application/json",
    buffer: Buffer.from(reportingWindowReceipt)
  });
  await page.locator("#receipt-submit").click();
  await page.locator("#receipt-result").waitFor({ state: "visible" });

  assert.equal(
    await page.locator("#receipt-status").textContent(),
    "Internally consistent"
  );
  assert.equal(
    await page.locator("#receipt-tool").textContent(),
    "Reporting Window Builder"
  );
  assert.equal(await page.locator("#receipt-version").textContent(), "v0.5.0");
  assert.equal(await page.locator("#receipt-digest-status").textContent(), "Match");
  assert.equal(await page.locator("#receipt-replay-status").textContent(), "Matched");
  assert.equal(await page.locator("#receipt-source-panel").isHidden(), true);
  assert.equal(await page.locator("#receipt-check-list li").count(), 3);

  await showRoute(page, "auditor");
  await page.locator("#audit-example").click();
  await page.locator("#audit-result").waitFor({ state: "visible" });
  const extractReceiptDownload = await clickForDownload(
    page,
    "#audit-receipt"
  );
  const extractReceipt = await saveDownload(
    extractReceiptDownload,
    "extract-audit-analysis-receipt.json"
  );

  await showRoute(page, "receipts");
  await page.locator("#receipt-file").setInputFiles({
    name: "extract-audit-analysis-receipt.json",
    mimeType: "application/json",
    buffer: Buffer.from(extractReceipt)
  });
  await page.locator("#receipt-submit").click();
  await page.locator("#receipt-source-panel").waitFor({ state: "visible" });
  await page.locator("#receipt-source-1").setInputFiles({
    name: "baseline-synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(BASELINE_SAMPLE)
  });
  await page.locator("#receipt-source-2").setInputFiles({
    name: "current-synthetic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CURRENT_SAMPLE)
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#receipt-source-result-body .source-match").length === 2
  );

  assert.equal(
    await page.locator("#receipt-status").textContent(),
    "Internally consistent"
  );
  assert.equal(
    await page.locator("#receipt-replay-status").textContent(),
    "Not available"
  );
  assert.equal(
    await page.locator("#receipt-source-result-body tr").count(),
    2
  );
  assert.equal(
    await page.locator("#receipt-source-summary").textContent(),
    "2/2 selected · 2 matched · 0 mismatched"
  );

  await page.locator("#receipt-source-2").setInputFiles({
    name: "wrong-current.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(BASELINE_SAMPLE)
  });
  await page.waitForFunction(
    () => document.querySelector("#receipt-status")?.textContent === "Source mismatch"
  );
  assert.equal(
    await page.locator("#receipt-source-result-body .source-mismatch").count(),
    1
  );
  assert.equal(
    await page.locator("#receipt-source-summary").textContent(),
    "2/2 selected · 1 matched · 1 mismatched"
  );
}

async function verifyCapacityJourney(page) {
  await showRoute(page, "capacity");
  for (const [selector, value] of [
    ["#capacity-backlog", "240"],
    ["#capacity-arrivals", "42"],
    ["#capacity-current", "38"],
    ["#capacity-change-week", "5"],
    ["#capacity-proposed", "50"],
    ["#capacity-horizon", "26"],
    ["#capacity-target-wait", "4"]
  ]) {
    await page.locator(selector).fill(value);
  }
  await page.locator("#capacity-form button[type='submit']").click();

  assert.equal(
    await page.locator("#capacity-status").textContent(),
    "Target met at horizon"
  );
  assert.equal(
    await page.locator("#capacity-plan-backlog").textContent(),
    "80"
  );
  assert.equal(
    await page.locator("#capacity-plan-wait").textContent(),
    "1.6 wk"
  );
  assert.equal(
    await page.locator("#capacity-current-backlog").textContent(),
    "344"
  );
  assert.equal(
    await page.locator("#capacity-required").textContent(),
    "46 / week"
  );
  assert.ok(await page.locator("#capacity-table-body tr").count() >= 5);

  const download = await clickForDownload(page, "#capacity-download");
  assert.equal(download.suggestedFilename(), "waitlist-capacity-projection.csv");
  const contents = await saveDownload(
    download,
    "waitlist-capacity-projection.csv"
  );
  assert.ok(
    contents.startsWith(
      "week,current_capacity,current_backlog,current_wait_proxy_weeks,planned_capacity,planned_backlog,planned_wait_proxy_weeks\r\n"
    )
  );
  assert.match(contents, /\r\n26,38,344,/);
}

async function verifyConformanceJourney(page) {
  await showRoute(page, "validate");
  await page.locator("#checker-matching-example").click();
  await page.locator("#checker-result").waitFor({ state: "visible" });

  assert.equal(
    await page.locator("#checker-status").textContent(),
    "Uploaded results match"
  );
  const expected = Number(
    await page.locator("#checker-expected").textContent()
  );
  const matched = Number(
    await page.locator("#checker-matched").textContent()
  );
  assert.ok(Number.isInteger(expected) && expected > 0);
  assert.equal(matched, expected);
  assert.equal(await page.locator("#checker-missing").textContent(), "0");
  assert.equal(await page.locator("#checker-other").textContent(), "0");
  assert.equal(
    await page.locator("#checker-diagnostic-body").textContent(),
    "No result differences found."
  );

  const download = await clickForDownload(page, "#checker-download");
  assert.equal(
    download.suggestedFilename(),
    "reporting-results-diagnostics.csv"
  );
  const contents = await saveDownload(
    download,
    "reporting-results-diagnostics.csv"
  );
  assert.equal(
    contents,
    "result_type,period_id,result_id,status,expected_value,actual_value\r\n"
  );
}

async function verifyAccessibility(page, route) {
  await showRoute(page, route);
  const violations = await page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa"]
      },
      resultTypes: ["violations"]
    });
    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(" "))
    }));
  });
  accessibilityViolations.push(
    ...violations.map((violation) => ({ route, ...violation }))
  );
}

async function verifyMobileNavigation(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "overview",
    "windows",
    "auditor",
    "capacity",
    "validate",
    "receipts"
  ]) {
    await showRoute(page, route);
    const activeLink = page.locator(`[data-route-link='${route}']`);
    const box = await activeLink.boundingBox();
    assert.ok(box, `Mobile navigation link for ${route} must be visible`);
    assert.ok(
      box.x >= 0 && box.x + box.width <= 390,
      `Mobile navigation link for ${route} must remain inside the viewport`
    );
  }
  await verifyAccessibility(page, "receipts");
}

async function showRoute(page, route) {
  await page.evaluate((nextRoute) => {
    window.location.hash = nextRoute;
  }, route);
  const routePage = page.locator(`#${route}`);
  await routePage.waitFor({ state: "visible" });
  assert.equal(await routePage.getAttribute("hidden"), null);
  assert.equal(
    await page
      .locator(`[data-route-link='${route}']`)
      .getAttribute("aria-current"),
    "page"
  );
}

function clickForDownload(page, selector) {
  return Promise.all([
    page.waitForEvent("download"),
    page.locator(selector).click()
  ]).then(([download]) => download);
}

async function saveDownload(download, filename) {
  const path = join(temporaryDirectory, filename);
  await download.saveAs(path);
  return readFile(path, "utf8");
}

async function verifyHundredThousandRows(page) {
  const baseline = buildExtract({
    rowCount: 100_000,
    valueFor: (index) => (index === 0 ? "=BEFORE" : "before")
  });
  const current = buildExtract({
    rowCount: 100_000,
    valueFor: (index) => (index === 0 ? "+AFTER" : "after")
  });

  await page.locator("#audit-baseline").setInputFiles({
    name: "baseline-100k.csv",
    mimeType: "text/csv",
    buffer: baseline
  });
  await page.locator("#audit-current").setInputFiles({
    name: "current-100k.csv",
    mimeType: "text/csv",
    buffer: current
  });
  await page.evaluate(() => {
    window.__auditHeartbeat = 0;
    window.__auditProgressPhases = [];
    window.__auditHeartbeatTimer = window.setInterval(() => {
      window.__auditHeartbeat += 1;
    }, 10);
    const phase = document.querySelector("#audit-progress-phase");
    const observer = new MutationObserver(() => {
      if (
        phase.textContent &&
        !window.__auditProgressPhases.includes(phase.textContent)
      ) {
        window.__auditProgressPhases.push(phase.textContent);
      }
    });
    observer.observe(phase, {
      childList: true,
      characterData: true,
      subtree: true
    });
    document.querySelector("#audit-form").addEventListener(
      "submit",
      () => {
        window.__auditSubmitHeartbeat = window.__auditHeartbeat;
      },
      { capture: true, once: true }
    );
    window.__auditProgressObserver = observer;
  });

  await page.locator("#audit-submit").click();
  await page.locator("#audit-progress").waitFor({ state: "visible" });
  await page.locator("#audit-result").waitFor({
    state: "visible",
    timeout: 60_000
  });
  const heartbeat = await page.evaluate(() => {
    window.clearInterval(window.__auditHeartbeatTimer);
    window.__auditProgressObserver.disconnect();
    return {
      submittedAt: window.__auditSubmitHeartbeat,
      completedAt: window.__auditHeartbeat
    };
  });

  assert.equal(
    Number.isInteger(heartbeat.submittedAt),
    true,
    "Heartbeat baseline must be captured by the actual form submit event"
  );
  assert.ok(
    heartbeat.completedAt - heartbeat.submittedAt >= 5,
    `Main-thread heartbeat advanced only ${
      heartbeat.completedAt - heartbeat.submittedAt
    } times after form submission`
  );
  assert.equal(
    await page.locator("#audit-context").textContent(),
    "100,000 → 100,000 rows"
  );
  assert.equal(await page.locator("#audit-changed").textContent(), "100,000");
  assert.equal(await page.locator("#audit-cells").textContent(), "100,000");
  assert.equal(
    await page.locator("#audit-diff-body tr").count(),
    100,
    "Preview must remain capped at 100 rows"
  );
  assert.match(
    await page.locator("#audit-preview-count").textContent(),
    /first 100 of 100,000 material differences/
  );
  assert.equal(await page.locator("#audit-download").isEnabled(), true);
  assert.ok(
    (await page.evaluate(() => window.__auditProgressPhases)).some(
      (phase) => phase === "Comparing records"
    )
  );

  const downloadEvent = page.waitForEvent("download");
  await page.locator("#audit-download").click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), "extract-change-log.csv");
  const downloadPath = join(temporaryDirectory, "extract-change-log.csv");
  await download.saveAs(downloadPath);
  const downloadText = await readFile(downloadPath, "utf8");
  assert.ok(downloadText.startsWith("key,status,column,before,after\r\n"));
  assert.match(
    downloadText,
    /R-000000,changed,value,'=BEFORE,'\+AFTER/
  );
  assert.equal(
    downloadText.split("\r\n").length - 1,
    100_001,
    "Download must contain a header and every changed cell"
  );
}

async function verifyCancellationAndStaleRunProtection(page) {
  const baseline = buildWideExtract({ current: false });
  const current = buildWideExtract({ current: true });

  await page.locator("#audit-baseline").setInputFiles({
    name: "baseline-cancel.csv",
    mimeType: "text/csv",
    buffer: baseline
  });
  await page.locator("#audit-current").setInputFiles({
    name: "current-cancel.csv",
    mimeType: "text/csv",
    buffer: current
  });
  await page.locator("#audit-submit").click();
  await page.locator("#audit-cancel").waitFor({ state: "visible" });
  await page.locator("#audit-cancel").click();

  await page.locator("#audit-empty").waitFor({ state: "visible" });
  assert.equal(await page.locator("#audit-result").isHidden(), true);
  assert.match(
    await page.locator("#audit-action-status").textContent(),
    /Comparison cancelled/
  );

  await page.locator("#audit-example").click();
  await page.locator("#audit-result").waitFor({
    state: "visible",
    timeout: 30_000
  });
  assert.equal(await page.locator("#audit-changed").textContent(), "2");
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator("#audit-context").textContent(),
    "4 → 4 rows",
    "A terminated older worker must not overwrite the newer result"
  );
}

function buildExtract({ rowCount, valueFor }) {
  const rows = ["record_id,value"];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push(
      `R-${String(index).padStart(6, "0")},${valueFor(index)}`
    );
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

function buildWideExtract({ current }) {
  const valueColumns = Array.from(
    { length: 19 },
    (_, index) => `value_${index + 1}`
  );
  const rows = [["record_id", ...valueColumns].join(",")];
  const value = current ? "B" : "A";
  for (let index = 0; index < 100_000; index += 1) {
    rows.push(
      [
        `R-${String(index).padStart(6, "0")}`,
        ...valueColumns.map(() => value)
      ].join(",")
    );
  }
  return Buffer.from(`${rows.join("\n")}\n`);
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    chromium.executablePath()
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next explicit browser path.
    }
  }
  throw new Error(
    `Chrome or Chromium was not found. Checked: ${candidates.join(", ")}`
  );
}

async function startStaticServer(root) {
  const mimeTypes = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"]
  ]);
  const server = createServer(async (request, response) => {
    try {
      const requestedPath = new URL(
        request.url,
        "http://127.0.0.1"
      ).pathname;
      if (requestedPath === "/__test__/axe.min.js") {
        response.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "text/javascript; charset=utf-8"
        });
        response.end(axeSource);
        return;
      }
      const relativePath =
        requestedPath === "/" ? "index.html" : requestedPath.slice(1);
      const target = resolve(root, decodeURIComponent(relativePath));
      if (!target.startsWith(`${root}/`) && target !== join(root, "index.html")) {
        response.writeHead(404).end();
        return;
      }
      if (!(await stat(target)).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const contents = await readFile(target);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type":
          mimeTypes.get(extname(target)) ?? "application/octet-stream"
      });
      response.end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, rejectPromise) => {
        server.close((error) =>
          error ? rejectPromise(error) : resolvePromise()
        );
      })
  };
}
