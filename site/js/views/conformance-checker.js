import { CONFORMANCE_CATALOG } from "../data/edge-case-contracts.js";
import {
  canonicalJsonStringify,
  createConformanceCheckReceipt,
  sha256Hex
} from "../lib/analysis-receipt.js";
import { stringifyCsv } from "../lib/csv.js";
import {
  compareConformanceResults,
  diagnosticsForCsv,
  failingExampleForCase,
  getCatalogCase,
  matchingExampleForCase,
  parseActualResults
} from "../tools/conformance-checker.js";

const MAX_RESULT_FILE_BYTES = 1024 * 1024;
const MAX_RESULT_ROWS = 10_000;
const state = {
  metrics: null,
  quality: null,
  result: null
};
const loadVersions = { metrics: 0, quality: 0 };

export function initializeConformanceChecker() {
  const form = byId("checker-form");
  const caseInput = byId("checker-case");
  const metricsInput = byId("checker-metrics");
  const qualityInput = byId("checker-quality");

  for (const edgeCase of CONFORMANCE_CATALOG.cases) {
    const option = document.createElement("option");
    option.value = edgeCase.id;
    option.textContent = edgeCase.title;
    caseInput.append(option);
  }
  caseInput.value = CONFORMANCE_CATALOG.cases[0].id;
  renderCaseContext();
  setText(
    "checker-catalog-version",
    `v${CONFORMANCE_CATALOG.suite_version} · ${CONFORMANCE_CATALOG.cases.length} synthetic cases`
  );
  setText(
    "checker-catalog-digest",
    shortDigest(CONFORMANCE_CATALOG.catalog_digest)
  );

  caseInput.addEventListener("change", () => {
    resetLoadedResults();
    renderCaseContext();
  });
  metricsInput.addEventListener("change", async () => {
    await loadResultFile(metricsInput.files[0], "metrics");
  });
  qualityInput.addEventListener("change", async () => {
    await loadResultFile(qualityInput.files[0], "quality");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      clearError();
      if (!state.metrics || !state.quality) {
        throw new Error(
          "Select both actual_metrics.csv and actual_quality.csv."
        );
      }
      const result = compareConformanceResults({
        catalog: CONFORMANCE_CATALOG,
        caseId: caseInput.value,
        metrics: state.metrics.data,
        quality: state.quality.data
      });
      state.result = result;
      renderResult(result);
    } catch (error) {
      invalidateResult();
      showError(error);
    }
  });

  byId("checker-matching-example").addEventListener("click", async () => {
    await loadExample("matching");
  });
  byId("checker-failing-example").addEventListener("click", async () => {
    await loadExample("failing");
  });
  byId("checker-download").addEventListener("click", () => {
    if (!state.result) {
      return;
    }
    const csv = stringifyCsv(diagnosticsForCsv(state.result), [
      "result_type",
      "period_id",
      "result_id",
      "status",
      "expected_value",
      "actual_value"
    ]);
    downloadText(
      "reporting-results-diagnostics.csv",
      csv,
      "text/csv;charset=utf-8"
    );
    announce("checker-action-status", "Diagnostics downloaded");
  });
  byId("checker-receipt").addEventListener("click", async () => {
    const result = state.result;
    const metrics = state.metrics;
    const quality = state.quality;
    if (!result || !metrics || !quality) {
      return;
    }
    const button = byId("checker-receipt");
    button.disabled = true;
    setText("checker-action-status", "Preparing receipt…");
    try {
      const receipt = await createConformanceCheckReceipt({
        result,
        catalog: CONFORMANCE_CATALOG,
        metricsEvidence: metrics.evidence,
        qualityEvidence: quality.evidence
      });
      if (
        state.result !== result ||
        state.metrics !== metrics ||
        state.quality !== quality
      ) {
        return;
      }
      downloadText(
        "reporting-results-analysis-receipt.json",
        canonicalJsonStringify(receipt, { pretty: true }),
        "application/json;charset=utf-8"
      );
      announce("checker-action-status", "Analysis receipt downloaded");
    } catch {
      if (
        state.result === result &&
        state.metrics === metrics &&
        state.quality === quality
      ) {
        announce("checker-action-status", "Analysis receipt unavailable");
      }
    } finally {
      if (state.result === result) {
        button.disabled = false;
      }
    }
  });
}

async function loadResultFile(file, resultType) {
  const version = loadVersions[resultType] + 1;
  loadVersions[resultType] = version;
  invalidateResult();
  state[resultType] = null;
  setText(fileNameId(resultType), file ? "Loading file…" : "No file selected");
  if (!file) {
    return;
  }

  try {
    clearError();
    if (file.size > MAX_RESULT_FILE_BYTES) {
      throw new Error(`${file.name} is larger than the 1 MB limit.`);
    }
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (loadVersions[resultType] !== version) {
      return;
    }
    const data = parseActualResults(text, resultType);
    if (data.rows.length > MAX_RESULT_ROWS) {
      throw new Error(`${file.name} contains more than 10,000 data rows.`);
    }
    const hash = await sha256Hex(bytes);
    if (loadVersions[resultType] !== version) {
      return;
    }
    state[resultType] = {
      data,
      evidence: resultEvidence(hash, bytes.byteLength, data)
    };
    setText(
      fileNameId(resultType),
      `${file.name} · ${formatNumber(data.rows.length)} rows`
    );
  } catch (error) {
    if (loadVersions[resultType] !== version) {
      return;
    }
    state[resultType] = null;
    setText(fileNameId(resultType), "Could not load file");
    showError(error);
  }
}

async function loadExample(kind) {
  const metricsVersion = loadVersions.metrics + 1;
  const qualityVersion = loadVersions.quality + 1;
  loadVersions.metrics = metricsVersion;
  loadVersions.quality = qualityVersion;
  invalidateResult();
  byId("checker-metrics").value = "";
  byId("checker-quality").value = "";

  try {
    clearError();
    const makeExample =
      kind === "matching" ? matchingExampleForCase : failingExampleForCase;
    const example = makeExample(
      CONFORMANCE_CATALOG,
      byId("checker-case").value
    );
    const metricsBytes = new TextEncoder().encode(example.metricsCsv);
    const qualityBytes = new TextEncoder().encode(example.qualityCsv);
    const metricsData = parseActualResults(example.metricsCsv, "metrics");
    const qualityData = parseActualResults(example.qualityCsv, "quality");
    const [metricsHash, qualityHash] = await Promise.all([
      sha256Hex(metricsBytes),
      sha256Hex(qualityBytes)
    ]);
    if (
      loadVersions.metrics !== metricsVersion ||
      loadVersions.quality !== qualityVersion
    ) {
      return;
    }
    state.metrics = {
      data: metricsData,
      evidence: resultEvidence(
        metricsHash,
        metricsBytes.byteLength,
        metricsData
      )
    };
    state.quality = {
      data: qualityData,
      evidence: resultEvidence(
        qualityHash,
        qualityBytes.byteLength,
        qualityData
      )
    };
    setText(
      "checker-metrics-name",
      `Synthetic ${kind === "matching" ? "matching" : "mismatch"} example · ${metricsData.rows.length} rows`
    );
    setText(
      "checker-quality-name",
      `Synthetic ${kind === "matching" ? "matching" : "mismatch"} example · ${qualityData.rows.length} rows`
    );
    byId("checker-form").requestSubmit();
  } catch (error) {
    showError(error);
  }
}

function renderCaseContext() {
  const selectedCase = getCatalogCase(
    CONFORMANCE_CATALOG,
    byId("checker-case").value
  );
  setText("checker-case-title", selectedCase.title);
  setText("checker-case-principle", selectedCase.principle);
  setText("checker-case-failure", selectedCase.naive_failure);
  setText("checker-case-resolution", selectedCase.expected_resolution);
  setText(
    "checker-expectation-context",
    `${selectedCase.metrics.length + selectedCase.quality.length} expected results`
  );
}

function renderResult(result) {
  byId("checker-empty").hidden = true;
  byId("checker-result").hidden = false;
  setText("checker-expected", formatNumber(result.summary.expectationCount));
  setText("checker-matched", formatNumber(result.summary.matched));
  setText("checker-missing", formatNumber(result.summary.missing));
  setText(
    "checker-other",
    formatNumber(result.summary.unexpected + result.summary.value)
  );

  const status = byId("checker-status");
  status.classList.toggle("on-track", result.passed);
  status.classList.toggle("off-track", !result.passed);
  status.textContent = result.passed
    ? "Uploaded results match"
    : `${result.summary.mismatchCount} difference${result.summary.mismatchCount === 1 ? "" : "s"} found`;
  setText(
    "checker-result-note",
    result.passed
      ? "Every expected key and exact integer value matches this synthetic case, with no unexpected keys."
      : "Review the exact differences below. A mismatch identifies what differs; it does not prove the underlying cause."
  );

  const body = byId("checker-diagnostic-body");
  body.replaceChildren();
  if (result.diagnostics.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No result differences found.";
    row.append(cell);
    body.append(row);
  } else {
    for (const diagnostic of result.diagnostics.slice(0, 100)) {
      body.append(diagnosticRow(diagnostic));
    }
  }
  setText(
    "checker-diagnostic-count",
    result.diagnostics.length > 100
      ? `Showing first 100 of ${result.diagnostics.length} differences`
      : `Showing ${result.diagnostics.length} difference${result.diagnostics.length === 1 ? "" : "s"}`
  );
  byId("checker-download").disabled = false;
  byId("checker-receipt").disabled = false;
  byId("checker-result-title").focus();
}

function diagnosticRow(diagnostic) {
  const row = document.createElement("tr");
  const values = [
    diagnostic.resultType === "metric" ? "Metric" : "Quality",
    diagnostic.key.join(" / "),
    diagnostic.kind === "value" ? "Wrong value" : capitalize(diagnostic.kind),
    diagnostic.expected ?? "—",
    diagnostic.actual ?? "—"
  ];
  values.forEach((value, index) => {
    const cell = document.createElement("td");
    if (index === 2) {
      const badge = document.createElement("span");
      badge.className = `status-label status-${diagnostic.kind}`;
      badge.textContent = value;
      cell.append(badge);
    } else {
      cell.textContent = value;
    }
    row.append(cell);
  });
  return row;
}

function invalidateResult() {
  state.result = null;
  clearError();
  byId("checker-result").hidden = true;
  byId("checker-empty").hidden = false;
  const status = byId("checker-status");
  status.classList.remove("on-track", "off-track");
  status.textContent = "Awaiting results";
  byId("checker-download").disabled = true;
  byId("checker-receipt").disabled = true;
  setText("checker-action-status", "");
}

function resetLoadedResults() {
  loadVersions.metrics += 1;
  loadVersions.quality += 1;
  state.metrics = null;
  state.quality = null;
  byId("checker-metrics").value = "";
  byId("checker-quality").value = "";
  setText("checker-metrics-name", "No file selected");
  setText("checker-quality-name", "No file selected");
  invalidateResult();
}

function resultEvidence(sha256, byteCount, data) {
  return {
    sha256,
    byteCount,
    rowCount: data.rows.length,
    columnCount: data.headers.length
  };
}

function fileNameId(resultType) {
  return resultType === "metrics"
    ? "checker-metrics-name"
    : "checker-quality-name";
}

function shortDigest(value) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function showError(error) {
  const element = byId("checker-error");
  element.textContent =
    error instanceof Error ? error.message : "Something went wrong.";
  element.hidden = false;
}

function clearError() {
  const element = byId("checker-error");
  element.textContent = "";
  element.hidden = true;
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing interface element: ${id}`);
  }
  return element;
}

function setText(id, value) {
  byId(id).textContent = String(value);
}

function announce(id, message) {
  setText(id, message);
  window.setTimeout(() => {
    if (byId(id).textContent === message) {
      setText(id, "");
    }
  }, 2_500);
}

function downloadText(filename, text, contentType) {
  const blob = new Blob([text], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-CA").format(value);
}

function capitalize(value) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
