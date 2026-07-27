import assert from "node:assert/strict";
import { createServer } from "node:http";
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

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const siteRoot = join(projectRoot, "site");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "toolkit-browser-test-")
);
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
  await page.goto(`${server.url}/#auditor`, {
    waitUntil: "networkidle"
  });

  await verifyHundredThousandRows(page);
  await verifyCancellationAndStaleRunProtection(page);
  console.log(
    "Browser-verified 100,000-row worker audit, bounded preview, formula-safe download, responsive heartbeat, cancellation, and stale-run protection."
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
