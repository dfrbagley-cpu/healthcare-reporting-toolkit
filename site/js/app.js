import {
  parseCsv,
  stringifyCsv
} from "./lib/csv.js";
import {
  formatLongDate,
  parseIsoDate
} from "./lib/date-utils.js";
import {
  canonicalJsonStringify,
  createCapacityPlanReceipt,
  createExtractAuditReceipt,
  createReportingWindowReceipt,
  sha256Hex
} from "./lib/analysis-receipt.js";
import { BASELINE_SAMPLE, CURRENT_SAMPLE } from "./samples.js";
import {
  auditExtracts,
  auditRowsForCsv
} from "./tools/extract-auditor.js";
import { buildReportingWindow } from "./tools/reporting-window.js";
import { calculateCapacityPlan } from "./tools/waitlist-planner.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const ROUTES = new Set(["overview", "windows", "auditor", "capacity"]);
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const windowState = { inputs: null, result: null };
const auditState = {
  baseline: null,
  current: null,
  audit: null,
  settings: null
};
const auditLoadVersions = { baseline: 0, current: 0 };
const capacityState = { result: null };

initializeNavigation();
initializeWindowTool();
initializeAuditTool();
initializeCapacityTool();

function initializeNavigation() {
  const showRoute = () => {
    const requested = window.location.hash.slice(1);
    const route = ROUTES.has(requested) ? requested : "overview";
    document.querySelectorAll("[data-page]").forEach((page) => {
      page.hidden = page.id !== route;
    });
    document.querySelectorAll("[data-route-link]").forEach((link) => {
      if (link.dataset.routeLink === route) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    document.title =
      route === "overview"
        ? "Healthcare Reporting Toolkit"
        : `${document.querySelector(`#${route} h1`).textContent} | Healthcare Reporting Toolkit`;
  };

  window.addEventListener("hashchange", showRoute);
  showRoute();
}

function initializeWindowTool() {
  const form = byId("window-form");
  const typeInput = byId("window-type");
  byId("window-as-of").value = todayIso();

  const updateVisibility = () => {
    const type = typeInput.value;
    byId("window-as-of-group").hidden = type === "custom";
    byId("window-fiscal-group").hidden = false;
    byId("window-rolling-group").hidden = type !== "rolling";
    byId("window-custom-group").hidden = type !== "custom";
  };

  typeInput.addEventListener("change", updateVisibility);
  form.addEventListener("input", invalidateWindowResult);
  updateVisibility();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      clearError("window-error");
      const inputs = {
        type: typeInput.value,
        asOf: byId("window-as-of").value,
        fiscalStartMonth: Number(byId("window-fiscal-month").value),
        rollingDays: Number(byId("window-rolling-days").value),
        customStart: byId("window-custom-start").value,
        customEnd: byId("window-custom-end").value,
        comparisonType: byId("window-comparison").value
      };
      const result = buildReportingWindow(inputs);
      windowState.inputs = inputs;
      windowState.result = result;
      renderWindowResult(result);
    } catch (error) {
      invalidateWindowResult();
      showError("window-error", error);
    }
  });

  byId("window-example").addEventListener("click", () => {
    typeInput.value = "fiscal_ytd";
    byId("window-as-of").value = "2026-06-15";
    byId("window-fiscal-month").value = "4";
    byId("window-comparison").value = "prior_year";
    updateVisibility();
    form.requestSubmit();
  });

  byId("window-copy").addEventListener("click", async () => {
    if (!windowState.result) {
      return;
    }
    const result = windowState.result;
    const text = [
      `${result.typeLabel} (${result.currentFiscalYear})`,
      `Current: ${result.current.start} to ${result.current.end} (${result.current.days} inclusive days)`,
      `${result.comparisonLabel} (${result.comparisonFiscalYear}): ${result.comparison.start} to ${result.comparison.end} (${result.comparison.days} inclusive days)`
    ].join("\n");
    try {
      await copyText(text);
      announce("window-action-status", "Copied");
    } catch {
      announce("window-action-status", "Copy unavailable");
    }
  });

  byId("window-download").addEventListener("click", () => {
    if (!windowState.result) {
      return;
    }
    const result = windowState.result;
    const csv = stringifyCsv(
      [
        {
          period: "current",
          method: result.typeLabel,
          start: result.current.start,
          end: result.current.end,
          inclusive_days: result.current.days,
          fiscal_year: result.currentFiscalYear
        },
        {
          period: "comparison",
          method: result.comparisonLabel,
          start: result.comparison.start,
          end: result.comparison.end,
          inclusive_days: result.comparison.days,
          fiscal_year: result.comparisonFiscalYear
        }
      ],
      ["period", "method", "start", "end", "inclusive_days", "fiscal_year"]
    );
    downloadText("reporting-windows.csv", csv, "text/csv;charset=utf-8");
    announce("window-action-status", "Downloaded");
  });

  byId("window-receipt").addEventListener("click", async () => {
    const result = windowState.result;
    const inputs = windowState.inputs;
    if (!result || !inputs) {
      return;
    }
    await downloadAnalysisReceipt({
      buttonId: "window-receipt",
      filename: "reporting-window-analysis-receipt.json",
      isCurrent: () =>
        windowState.result === result && windowState.inputs === inputs,
      makeReceipt: () => createReportingWindowReceipt({ inputs, result }),
      statusId: "window-action-status"
    });
  });
}

function renderWindowResult(result) {
  byId("window-empty").hidden = true;
  byId("window-result").hidden = false;
  setText("window-fiscal-label", result.currentFiscalYear);
  setText(
    "window-current-range",
    `${longDate(result.current.start)} – ${longDate(result.current.end)}`
  );
  setText("window-current-days", `${result.current.days} inclusive days`);
  setText("window-comparison-label", result.comparisonLabel);
  setText(
    "window-comparison-range",
    `${longDate(result.comparison.start)} – ${longDate(result.comparison.end)}`
  );
  setText("window-comparison-days", `${result.comparison.days} inclusive days`);
  setText("window-current-start", result.current.start);
  setText("window-current-end", result.current.end);
  setText("window-current-count", formatNumber(result.current.days));
  setText("window-compare-start", result.comparison.start);
  setText("window-compare-end", result.comparison.end);
  setText("window-compare-count", formatNumber(result.comparison.days));

  renderList("window-warnings", result.warnings);
  byId("window-warning-box").hidden = result.warnings.length === 0;
  byId("window-receipt").disabled = false;
  byId("window-result-title").focus();
}

function initializeAuditTool() {
  const form = byId("audit-form");
  const baselineInput = byId("audit-baseline");
  const currentInput = byId("audit-current");
  byId("audit-key-columns").addEventListener("input", invalidateAuditResult);
  byId("audit-trim").addEventListener("change", invalidateAuditResult);

  baselineInput.addEventListener("change", async () => {
    await loadAuditFile(
      baselineInput.files[0],
      "baseline",
      "audit-baseline-name"
    );
  });
  currentInput.addEventListener("change", async () => {
    await loadAuditFile(
      currentInput.files[0],
      "current",
      "audit-current-name"
    );
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      clearError("audit-error");
      if (!auditState.baseline || !auditState.current) {
        throw new Error("Select both a baseline and current CSV file.");
      }
      const keyColumns = byId("audit-key-columns").value.split(",");
      const audit = auditExtracts({
        baseline: auditState.baseline.data,
        current: auditState.current.data,
        keyColumns,
        trimWhitespace: byId("audit-trim").checked
      });
      auditState.audit = audit;
      auditState.settings = {
        trimWhitespace: byId("audit-trim").checked
      };
      renderAuditResult(audit);
    } catch (error) {
      showError("audit-error", error);
    }
  });

  byId("audit-example").addEventListener("click", async () => {
    const baselineVersion = auditLoadVersions.baseline + 1;
    const currentVersion = auditLoadVersions.current + 1;
    auditLoadVersions.baseline = baselineVersion;
    auditLoadVersions.current = currentVersion;
    try {
      clearError("audit-error");
      invalidateAuditResult();
      baselineInput.value = "";
      currentInput.value = "";
      const baselineBytes = new TextEncoder().encode(BASELINE_SAMPLE);
      const currentBytes = new TextEncoder().encode(CURRENT_SAMPLE);
      const [baselineHash, currentHash] = await Promise.all([
        sha256Hex(baselineBytes),
        sha256Hex(currentBytes)
      ]);
      if (
        auditLoadVersions.baseline !== baselineVersion ||
        auditLoadVersions.current !== currentVersion
      ) {
        return;
      }
      const baselineData = parseCsv(BASELINE_SAMPLE);
      const currentData = parseCsv(CURRENT_SAMPLE);
      auditState.baseline = {
        name: "baseline.csv (synthetic)",
        data: baselineData,
        evidence: extractEvidence(
          baselineHash,
          baselineBytes.byteLength,
          baselineData
        )
      };
      auditState.current = {
        name: "current.csv (synthetic)",
        data: currentData,
        evidence: extractEvidence(
          currentHash,
          currentBytes.byteLength,
          currentData
        )
      };
      setText(
        "audit-baseline-name",
        describeExtract(auditState.baseline)
      );
      setText("audit-current-name", describeExtract(auditState.current));
      byId("audit-key-columns").value = "record_id";
      form.requestSubmit();
    } catch (error) {
      if (
        auditLoadVersions.baseline === baselineVersion &&
        auditLoadVersions.current === currentVersion
      ) {
        showError("audit-error", error);
      }
    }
  });

  byId("audit-download").addEventListener("click", () => {
    if (!auditState.audit) {
      return;
    }
    const csv = stringifyCsv(auditRowsForCsv(auditState.audit), [
      "key",
      "status",
      "column",
      "before",
      "after"
    ]);
    downloadText("extract-change-log.csv", csv, "text/csv;charset=utf-8");
    announce("audit-action-status", "Change log downloaded");
  });

  byId("audit-receipt").addEventListener("click", async () => {
    const audit = auditState.audit;
    const baseline = auditState.baseline;
    const current = auditState.current;
    const settings = auditState.settings;
    if (!audit || !baseline?.evidence || !current?.evidence || !settings) {
      return;
    }
    await downloadAnalysisReceipt({
      buttonId: "audit-receipt",
      filename: "extract-audit-analysis-receipt.json",
      isCurrent: () =>
        auditState.audit === audit &&
        auditState.baseline === baseline &&
        auditState.current === current &&
        auditState.settings === settings,
      makeReceipt: () =>
        createExtractAuditReceipt({
          audit,
          baselineEvidence: baseline.evidence,
          currentEvidence: current.evidence,
          trimWhitespace: settings.trimWhitespace
        }),
      statusId: "audit-action-status"
    });
  });
}

async function loadAuditFile(file, stateKey, nameElementId) {
  const loadVersion = auditLoadVersions[stateKey] + 1;
  auditLoadVersions[stateKey] = loadVersion;
  invalidateAuditResult();
  auditState[stateKey] = null;
  if (!file) {
    setText(nameElementId, "No file selected");
    return;
  }
  setText(nameElementId, "Loading file…");
  try {
    clearError("audit-error");
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`${file.name} is larger than the 10 MB limit.`);
    }
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (auditLoadVersions[stateKey] !== loadVersion) {
      return;
    }
    const data = parseCsv(text);
    if (data.records.length > MAX_RECORDS) {
      throw new Error(`${file.name} contains more than 100,000 data rows.`);
    }
    const hash = await sha256Hex(bytes);
    if (auditLoadVersions[stateKey] !== loadVersion) {
      return;
    }
    auditState[stateKey] = {
      name: file.name,
      data,
      evidence: extractEvidence(hash, bytes.byteLength, data)
    };
    setText(nameElementId, describeExtract(auditState[stateKey]));
  } catch (error) {
    if (auditLoadVersions[stateKey] !== loadVersion) {
      return;
    }
    auditState[stateKey] = null;
    setText(nameElementId, "Could not load file");
    showError("audit-error", error);
  }
}

function renderAuditResult(audit) {
  byId("audit-empty").hidden = true;
  byId("audit-result").hidden = false;
  setText(
    "audit-context",
    `${formatNumber(audit.summary.baselineRows)} → ${formatNumber(audit.summary.currentRows)} rows`
  );
  setText("audit-added", formatNumber(audit.summary.added));
  setText("audit-removed", formatNumber(audit.summary.removed));
  setText("audit-changed", formatNumber(audit.summary.changed));
  setText("audit-cells", formatNumber(audit.summary.changedCells));
  setText(
    "audit-added-columns",
    audit.addedColumns.length ? audit.addedColumns.join(", ") : "None"
  );
  setText(
    "audit-removed-columns",
    audit.removedColumns.length ? audit.removedColumns.join(", ") : "None"
  );
  setText(
    "audit-type-changes",
    audit.typeChanges.length
      ? audit.typeChanges
          .map(
            (change) =>
              `${change.column}: ${change.before} → ${change.after}`
          )
          .join("; ")
      : "None detected"
  );
  setText("audit-duplicates", formatNumber(audit.summary.ambiguousKeys));
  setText(
    "audit-missing-keys",
    formatNumber(
      audit.summary.missingBaselineKeys + audit.summary.missingCurrentKeys
    )
  );
  setText("audit-unchanged", formatNumber(audit.summary.unchanged));
  renderList("audit-warnings", audit.warnings);
  byId("audit-warning-box").hidden = audit.warnings.length === 0;
  byId("audit-receipt").disabled = false;

  const differences = audit.rowDiffs.filter(
    (difference) => difference.status !== "unchanged"
  );
  const preview = differences.slice(0, 100);
  const body = byId("audit-diff-body");
  body.replaceChildren();

  if (preview.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No material record differences found.";
    row.append(cell);
    body.append(row);
  } else {
    for (const difference of preview) {
      body.append(buildDifferenceRow(difference));
    }
  }

  setText(
    "audit-preview-count",
    differences.length > preview.length
      ? `Showing first ${preview.length} of ${differences.length} material differences`
      : `Showing ${differences.length} material difference${differences.length === 1 ? "" : "s"}`
  );
  byId("audit-result-title").focus();
}

function buildDifferenceRow(difference) {
  const row = document.createElement("tr");
  const key = document.createElement("td");
  key.textContent = difference.key;

  const status = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `status-label status-${difference.status}`;
  badge.textContent = difference.status;
  status.append(badge);

  const fields = document.createElement("td");
  fields.textContent =
    difference.changedColumns.length > 0
      ? difference.changedColumns.join(", ")
      : "—";

  const detail = document.createElement("td");
  if (difference.status === "changed") {
    const summaries = difference.changes.slice(0, 3).map(
      (change) =>
        `${change.column}: ${displayValue(change.before)} → ${displayValue(change.after)}`
    );
    if (difference.changes.length > 3) {
      summaries.push(`+${difference.changes.length - 3} more`);
    }
    detail.textContent = summaries.join("; ");
  } else {
    detail.textContent =
      difference.status === "added"
        ? "Present only in current extract"
        : "Present only in baseline extract";
  }

  row.append(key, status, fields, detail);
  return row;
}

function initializeCapacityTool() {
  const form = byId("capacity-form");
  const defaults = {
    "capacity-backlog": "240",
    "capacity-arrivals": "42",
    "capacity-current": "38",
    "capacity-change-week": "5",
    "capacity-proposed": "50",
    "capacity-horizon": "26",
    "capacity-target-wait": "4"
  };

  const run = (focusResult = false) => {
    try {
      clearError("capacity-error");
      const result = calculateCapacityPlan({
        initialBacklog: byId("capacity-backlog").value,
        weeklyArrivals: byId("capacity-arrivals").value,
        weeklyCapacity: byId("capacity-current").value,
        changeWeek: byId("capacity-change-week").value,
        proposedCapacity: byId("capacity-proposed").value,
        horizonWeeks: byId("capacity-horizon").value,
        targetWaitWeeks: byId("capacity-target-wait").value
      });
      capacityState.result = result;
      renderCapacityResult(result, focusResult);
    } catch (error) {
      invalidateCapacityResult();
      showError("capacity-error", error);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run(true);
  });
  form.addEventListener("input", invalidateCapacityResult);
  byId("capacity-reset").addEventListener("click", () => {
    for (const [id, value] of Object.entries(defaults)) {
      byId(id).value = value;
    }
    run(true);
  });
  byId("capacity-horizon").addEventListener("input", () => {
    byId("capacity-change-week").max = byId("capacity-horizon").value || "104";
  });
  byId("capacity-download").addEventListener("click", () => {
    if (!capacityState.result) {
      return;
    }
    const result = capacityState.result;
    const rows = result.current.weeks.map((currentWeek, index) => {
      const plannedWeek = result.planned.weeks[index];
      return {
        week: currentWeek.week,
        current_capacity: currentWeek.capacity,
        current_backlog: roundNumber(currentWeek.backlog),
        current_wait_proxy_weeks: finiteOrBlank(currentWeek.waitWeeks),
        planned_capacity: plannedWeek.capacity,
        planned_backlog: roundNumber(plannedWeek.backlog),
        planned_wait_proxy_weeks: finiteOrBlank(plannedWeek.waitWeeks)
      };
    });
    const csv = stringifyCsv(rows, [
      "week",
      "current_capacity",
      "current_backlog",
      "current_wait_proxy_weeks",
      "planned_capacity",
      "planned_backlog",
      "planned_wait_proxy_weeks"
    ]);
    downloadText("waitlist-capacity-projection.csv", csv, "text/csv;charset=utf-8");
    announce("capacity-action-status", "Projection downloaded");
  });
  byId("capacity-receipt").addEventListener("click", async () => {
    const result = capacityState.result;
    if (!result) {
      return;
    }
    await downloadAnalysisReceipt({
      buttonId: "capacity-receipt",
      filename: "waitlist-capacity-analysis-receipt.json",
      isCurrent: () => capacityState.result === result,
      makeReceipt: () => createCapacityPlanReceipt({ result }),
      statusId: "capacity-action-status"
    });
  });

  run();
}

function renderCapacityResult(result, focusResult = false) {
  const finalCurrent = result.current.weeks.at(-1);
  const finalPlanned = result.planned.weeks.at(-1);
  setText("capacity-plan-backlog", formatNumber(finalPlanned.backlog, 1));
  setText(
    "capacity-plan-backlog-note",
    `at week ${result.inputs.horizonWeeks}`
  );
  setText("capacity-plan-wait", formatWait(finalPlanned.waitWeeks));
  setText("capacity-current-backlog", formatNumber(finalCurrent.backlog, 1));
  setText(
    "capacity-required",
    `${formatNumber(result.requiredWholeCapacity)} / week`
  );
  setText(
    "capacity-required-note",
    `from week ${result.inputs.changeWeek} to meet and sustain the target by week ${result.inputs.horizonWeeks}`
  );

  const status = byId("capacity-status");
  status.classList.toggle("on-track", result.onTrack);
  status.classList.toggle("off-track", !result.onTrack);
  status.textContent = result.onTrack
    ? "Target met at horizon"
    : result.meetsTargetAtHorizon
      ? "Temporary target"
      : "Target missed";

  if (result.onTrack && result.targetWeek !== null) {
    setText(
      "capacity-target-note",
      `At or below the ${formatNumber(result.inputs.targetWaitWeeks, 1)}-week proxy from week ${result.targetWeek} through week ${result.inputs.horizonWeeks}; proposed capacity is at least average arrivals.`
    );
  } else if (result.meetsTargetAtHorizon) {
    setText(
      "capacity-target-note",
      `The target is met at week ${result.inputs.horizonWeeks}, but proposed capacity is below average arrivals, so backlog grows again under this model.`
    );
  } else {
    const gap = Math.max(
      0,
      result.requiredWholeCapacity - result.inputs.proposedCapacity
    );
    setText(
      "capacity-target-note",
      gap > 0
        ? `The plan is about ${formatNumber(gap, 1)} completion${gap === 1 ? "" : "s"} per week below the target requirement.`
        : "The target is not met at the selected horizon."
    );
  }

  drawCapacityChart(result);
  renderCapacityTable(result);
  byId("capacity-download").disabled = false;
  byId("capacity-receipt").disabled = false;
  if (focusResult) {
    byId("capacity-result-title").focus();
  }
}

function drawCapacityChart(result) {
  const svg = byId("capacity-chart");
  svg.replaceChildren();
  const width = 720;
  const height = 300;
  const margin = { top: 22, right: 20, bottom: 42, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const horizon = result.inputs.horizonWeeks;
  const maximum = Math.max(
    1,
    result.current.peakBacklog,
    result.planned.peakBacklog,
    result.targetFinalBacklog
  );
  const yMaximum = niceCeiling(maximum);
  const x = (week) => margin.left + (week / horizon) * plotWidth;
  const y = (backlog) =>
    margin.top + plotHeight - (backlog / yMaximum) * plotHeight;

  svg.append(
    svgElement("title", {}, "Projected waitlist by week"),
    svgElement(
      "desc",
      {},
      "Line chart comparing backlog under unchanged capacity with the proposed capacity plan."
    )
  );

  for (let index = 0; index <= 4; index += 1) {
    const value = (yMaximum / 4) * index;
    const yPosition = y(value);
    svg.append(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: yPosition,
        y2: yPosition,
        stroke: "#dce5e3",
        "stroke-width": "1"
      }),
      svgElement(
        "text",
        {
          x: margin.left - 9,
          y: yPosition + 4,
          fill: "#61757d",
          "font-size": "11",
          "text-anchor": "end"
        },
        formatNumber(value)
      )
    );
  }

  const xTicks = uniqueNumbers([
    0,
    Math.round(horizon / 4),
    Math.round(horizon / 2),
    Math.round((horizon * 3) / 4),
    horizon
  ]);
  for (const week of xTicks) {
    svg.append(
      svgElement(
        "text",
        {
          x: x(week),
          y: height - 16,
          fill: "#61757d",
          "font-size": "11",
          "text-anchor": "middle"
        },
        `W${week}`
      )
    );
  }

  const targetY = y(Math.min(result.targetFinalBacklog, yMaximum));
  svg.append(
    svgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: targetY,
      y2: targetY,
      stroke: "#74848a",
      "stroke-width": "1.5",
      "stroke-dasharray": "6 5"
    })
  );

  const changeX = x(result.inputs.changeWeek);
  svg.append(
    svgElement("line", {
      x1: changeX,
      x2: changeX,
      y1: margin.top,
      y2: height - margin.bottom,
      stroke: "#a8b7b8",
      "stroke-width": "1",
      "stroke-dasharray": "3 4"
    }),
    svgElement(
      "text",
      {
        x: changeX + 5,
        y: margin.top + 10,
        fill: "#61757d",
        "font-size": "10"
      },
      "capacity change"
    )
  );

  svg.append(
    svgElement("path", {
      d: linePath(result.current.weeks, x, y),
      fill: "none",
      stroke: "#b45309",
      "stroke-width": "3",
      "stroke-dasharray": "9 6",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    }),
    svgElement("path", {
      d: linePath(result.planned.weeks, x, y),
      fill: "none",
      stroke: "#0f766e",
      "stroke-width": "3.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    })
  );

  const finalCurrent = result.current.weeks.at(-1);
  const finalPlanned = result.planned.weeks.at(-1);
  svg.append(
    svgElement("circle", {
      cx: x(horizon),
      cy: y(finalCurrent.backlog),
      r: "4",
      fill: "#b45309"
    }),
    svgElement("circle", {
      cx: x(horizon),
      cy: y(finalPlanned.backlog),
      r: "4.5",
      fill: "#0f766e"
    })
  );
}

function renderCapacityTable(result) {
  const horizon = result.inputs.horizonWeeks;
  const weeks = uniqueNumbers([
    0,
    Math.max(0, result.inputs.changeWeek - 1),
    result.inputs.changeWeek,
    Math.round(horizon / 4),
    Math.round(horizon / 2),
    Math.round((horizon * 3) / 4),
    horizon
  ])
    .filter((week) => week <= horizon)
    .sort((left, right) => left - right);

  const body = byId("capacity-table-body");
  body.replaceChildren();
  for (const week of weeks) {
    const current = result.current.weeks[week];
    const planned = result.planned.weeks[week];
    const row = document.createElement("tr");
    for (const value of [
      week,
      formatNumber(current.backlog, 1),
      formatNumber(planned.backlog, 1),
      formatWait(planned.waitWeeks)
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
}

function svgElement(name, attributes, text) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, value);
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function linePath(weeks, x, y) {
  return weeks
    .map(
      (week, index) =>
        `${index === 0 ? "M" : "L"} ${x(week.week).toFixed(2)} ${y(week.backlog).toFixed(2)}`
    )
    .join(" ");
}

function niceCeiling(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function uniqueNumbers(values) {
  return [...new Set(values)];
}

function describeExtract(extract) {
  return `${extract.name} · ${formatNumber(extract.data.records.length)} rows · ${formatNumber(extract.data.headers.length)} columns`;
}

function extractEvidence(sha256, byteCount, data) {
  return {
    sha256,
    byteCount,
    rowCount: data.records.length,
    columnCount: data.headers.length
  };
}

function longDate(isoDate) {
  return formatLongDate(parseIsoDate(isoDate));
}

function displayValue(value) {
  const text = String(value ?? "");
  if (text === "") {
    return "(blank)";
  }
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

function setText(id, value) {
  byId(id).textContent = String(value);
}

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing interface element: ${id}`);
  }
  return element;
}

function showError(id, error) {
  const element = byId(id);
  element.textContent =
    error instanceof Error ? error.message : "Something went wrong.";
  element.hidden = false;
}

function clearError(id) {
  const element = byId(id);
  element.textContent = "";
  element.hidden = true;
}

function renderList(id, items) {
  const list = byId(id);
  list.replaceChildren();
  for (const item of items) {
    const listItem = document.createElement("li");
    listItem.textContent = item;
    list.append(listItem);
  }
}

function invalidateWindowResult() {
  windowState.inputs = null;
  windowState.result = null;
  clearError("window-error");
  byId("window-result").hidden = true;
  byId("window-empty").hidden = false;
  byId("window-receipt").disabled = true;
  setText("window-fiscal-label", "Awaiting inputs");
  setText("window-action-status", "");
}

function invalidateAuditResult() {
  auditState.audit = null;
  auditState.settings = null;
  clearError("audit-error");
  byId("audit-result").hidden = true;
  byId("audit-empty").hidden = false;
  byId("audit-receipt").disabled = true;
  setText("audit-context", "Awaiting extracts");
  setText("audit-action-status", "");
}

function invalidateCapacityResult() {
  capacityState.result = null;
  clearError("capacity-error");
  const status = byId("capacity-status");
  status.classList.remove("on-track", "off-track");
  status.textContent = "Inputs changed";
  for (const id of [
    "capacity-plan-backlog",
    "capacity-plan-wait",
    "capacity-current-backlog",
    "capacity-required"
  ]) {
    setText(id, "—");
  }
  setText("capacity-plan-backlog-note", "run the scenario");
  setText("capacity-required-note", "run the scenario");
  setText("capacity-target-note", "Run the scenario to update the result.");
  byId("capacity-download").disabled = true;
  byId("capacity-receipt").disabled = true;
  setText("capacity-action-status", "");
  byId("capacity-chart").replaceChildren();
  byId("capacity-table-body").replaceChildren();
}

async function downloadAnalysisReceipt({
  buttonId,
  filename,
  isCurrent,
  makeReceipt,
  statusId
}) {
  const button = byId(buttonId);
  button.disabled = true;
  setText(statusId, "Preparing receipt…");
  try {
    const receipt = await makeReceipt();
    if (!isCurrent()) {
      return;
    }
    downloadText(
      filename,
      canonicalJsonStringify(receipt, { pretty: true }),
      "application/json;charset=utf-8"
    );
    announce(statusId, "Analysis receipt downloaded");
  } catch {
    if (isCurrent()) {
      announce(statusId, "Analysis receipt unavailable");
    }
  } finally {
    if (isCurrent()) {
      button.disabled = false;
    }
  }
}

function announce(id, message) {
  setText(id, message);
  window.setTimeout(() => {
    if (byId(id).textContent === message) {
      setText(id, "");
    }
  }, 2_500);
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-CA", {
    maximumFractionDigits
  }).format(value);
}

function formatWait(value) {
  return Number.isFinite(value)
    ? `${formatNumber(value, 1)} wk`
    : "Not finite";
}

function roundNumber(value) {
  return Math.round(value * 100) / 100;
}

function finiteOrBlank(value) {
  return Number.isFinite(value) ? roundNumber(value) : "";
}

function todayIso() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0")
  ].join("-");
}

async function copyText(text) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await navigator.clipboard.writeText(text);
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
