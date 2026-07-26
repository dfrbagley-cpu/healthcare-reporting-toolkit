import { parseCsv, stringifyCsv } from "../lib/csv.js";

const RESULT_CONTRACTS = {
  metrics: {
    headers: ["period_id", "metric_id", "actual_value"],
    keyFields: ["period_id", "metric_id"]
  },
  quality: {
    headers: ["check_id", "actual_value"],
    keyFields: ["check_id"]
  }
};

export function parseActualResults(input, resultType) {
  const contract = RESULT_CONTRACTS[resultType];
  if (!contract) {
    throw new Error("Choose a supported result type.");
  }
  const parsed = parseCsv(input, {
    trimHeaders: false,
    allowMissingTrailingValues: false
  });
  if (!arraysEqual(parsed.headers, contract.headers)) {
    throw new Error(
      `${resultLabel(resultType)} must have exactly these columns in this order: ${contract.headers.join(",")}.`
    );
  }
  if (parsed.records.length === 0) {
    throw new Error(`${resultLabel(resultType)} must contain at least one data row.`);
  }

  const seen = new Set();
  const rows = parsed.records.map((record, index) => {
    const rowNumber = index + 2;
    const key = contract.keyFields.map((field) => {
      const value = record[field];
      if (value.trim() === "") {
        throw new Error(
          `${resultLabel(resultType)} row ${rowNumber} has a blank ${field}.`
        );
      }
      return value;
    });
    const internalKey = JSON.stringify(key);
    if (seen.has(internalKey)) {
      throw new Error(
        `${resultLabel(resultType)} contains a duplicate result key at row ${rowNumber}.`
      );
    }
    seen.add(internalKey);
    return {
      key,
      value: normalizeIntegerText(
        record.actual_value,
        `${resultLabel(resultType)} row ${rowNumber} actual_value`
      )
    };
  });

  return {
    headers: parsed.headers,
    rows
  };
}

export function compareConformanceResults({
  catalog,
  caseId,
  metrics,
  quality
}) {
  const selectedCase = getCatalogCase(catalog, caseId);
  const metricDiagnostics = compareRows(
    expectedRows(selectedCase, "metrics"),
    metrics.rows,
    "metric"
  );
  const qualityDiagnostics = compareRows(
    expectedRows(selectedCase, "quality"),
    quality.rows,
    "quality"
  );
  const diagnostics = [...metricDiagnostics, ...qualityDiagnostics];
  const expectationCount =
    selectedCase.metrics.length + selectedCase.quality.length;
  const summary = {
    expectationCount,
    matched:
      expectationCount -
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.kind === "missing" || diagnostic.kind === "value"
      ).length,
    mismatchCount: diagnostics.length,
    missing: countKind(diagnostics, "missing"),
    unexpected: countKind(diagnostics, "unexpected"),
    value: countKind(diagnostics, "value")
  };

  return {
    caseId,
    caseTitle: selectedCase.title,
    passed: diagnostics.length === 0,
    summary,
    diagnostics
  };
}

export function diagnosticsForCsv(result) {
  return result.diagnostics.map((diagnostic) => ({
    result_type: diagnostic.resultType,
    period_id:
      diagnostic.resultType === "metric" ? diagnostic.key[0] : "",
    result_id:
      diagnostic.resultType === "metric"
        ? diagnostic.key[1]
        : diagnostic.key[0],
    status: diagnostic.kind,
    expected_value: diagnostic.expected ?? "",
    actual_value: diagnostic.actual ?? ""
  }));
}

export function matchingExampleForCase(catalog, caseId) {
  const selectedCase = getCatalogCase(catalog, caseId);
  return {
    metricsCsv: expectedCsv(selectedCase, "metrics"),
    qualityCsv: expectedCsv(selectedCase, "quality")
  };
}

export function failingExampleForCase(catalog, caseId) {
  const selectedCase = getCatalogCase(catalog, caseId);
  const metrics = selectedCase.metrics.map((row) => ({ ...row }));
  const quality = selectedCase.quality.map((row) => ({ ...row }));
  const targetCollection = metrics.length > 0 ? metrics : quality;
  const target = targetCollection[0];
  target.expected_value = incrementIntegerText(
    normalizeIntegerText(target.expected_value, "Example expected value")
  );
  const changed =
    targetCollection === metrics
      ? {
          resultType: "metric",
          key: [String(target.period_id), String(target.metric_id)]
        }
      : {
          resultType: "quality",
          key: [String(target.check_id)]
        };

  return {
    metricsCsv: rowsToActualCsv(metrics, "metrics"),
    qualityCsv: rowsToActualCsv(quality, "quality"),
    changed
  };
}

export function getCatalogCase(catalog, caseId) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.cases)) {
    throw new Error("The bundled conformance catalog is invalid.");
  }
  const selectedCase = catalog.cases.find((item) => item.id === caseId);
  if (!selectedCase) {
    throw new Error("Choose a bundled edge case.");
  }
  validateCase(selectedCase);
  return selectedCase;
}

function validateCase(selectedCase) {
  for (const field of [
    "id",
    "title",
    "principle",
    "naive_failure",
    "expected_resolution"
  ]) {
    if (typeof selectedCase[field] !== "string" || !selectedCase[field].trim()) {
      throw new Error(`The bundled case is missing ${field}.`);
    }
  }
  if (selectedCase.synthetic_data_only !== true) {
    throw new Error("Only explicitly synthetic bundled cases are supported.");
  }
  for (const resultType of ["metrics", "quality"]) {
    if (
      !Array.isArray(selectedCase[resultType]) ||
      selectedCase[resultType].length === 0
    ) {
      throw new Error(`The bundled case has no expected ${resultType}.`);
    }
    const seen = new Set();
    for (const row of expectedRows(selectedCase, resultType)) {
      const internalKey = JSON.stringify(row.key);
      if (row.key.some((value) => value.trim() === "")) {
        throw new Error(`The bundled case contains a blank ${resultType} key.`);
      }
      if (seen.has(internalKey)) {
        throw new Error(`The bundled case contains a duplicate ${resultType} key.`);
      }
      seen.add(internalKey);
      normalizeIntegerText(row.value, `Bundled ${resultType} expected value`);
    }
  }
}

function expectedRows(selectedCase, resultType) {
  if (resultType === "metrics") {
    return selectedCase.metrics.map((row) => ({
      key: [String(row.period_id), String(row.metric_id)],
      value: normalizeIntegerText(
        row.expected_value,
        "Bundled metric expected value"
      )
    }));
  }
  return selectedCase.quality.map((row) => ({
    key: [String(row.check_id)],
    value: normalizeIntegerText(
      row.expected_value,
      "Bundled quality expected value"
    )
  }));
}

function compareRows(expected, actual, resultType) {
  const expectedByKey = new Map(
    expected.map((row) => [JSON.stringify(row.key), row])
  );
  const actualByKey = new Map(
    actual.map((row) => [JSON.stringify(row.key), row])
  );
  const diagnostics = [];

  for (const internalKey of sortedDifference(expectedByKey, actualByKey)) {
    const row = expectedByKey.get(internalKey);
    diagnostics.push({
      resultType,
      kind: "missing",
      key: row.key,
      expected: row.value,
      actual: null
    });
  }
  for (const internalKey of sortedDifference(actualByKey, expectedByKey)) {
    const row = actualByKey.get(internalKey);
    diagnostics.push({
      resultType,
      kind: "unexpected",
      key: row.key,
      expected: null,
      actual: row.value
    });
  }
  for (const internalKey of sortedIntersection(expectedByKey, actualByKey)) {
    const expectedRow = expectedByKey.get(internalKey);
    const actualRow = actualByKey.get(internalKey);
    if (expectedRow.value !== actualRow.value) {
      diagnostics.push({
        resultType,
        kind: "value",
        key: expectedRow.key,
        expected: expectedRow.value,
        actual: actualRow.value
      });
    }
  }
  return diagnostics;
}

function sortedDifference(left, right) {
  return [...left.keys()]
    .filter((key) => !right.has(key))
    .sort(compareInternalKeys);
}

function sortedIntersection(left, right) {
  return [...left.keys()]
    .filter((key) => right.has(key))
    .sort(compareInternalKeys);
}

function compareInternalKeys(left, right) {
  const leftParts = JSON.parse(left);
  const rightParts = JSON.parse(right);
  const width = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < width; index += 1) {
    const comparison = String(leftParts[index] ?? "").localeCompare(
      String(rightParts[index] ?? ""),
      "en"
    );
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function expectedCsv(selectedCase, resultType) {
  return rowsToActualCsv(selectedCase[resultType], resultType);
}

function rowsToActualCsv(rows, resultType) {
  if (resultType === "metrics") {
    return stringifyCsv(
      rows.map((row) => ({
        period_id: row.period_id,
        metric_id: row.metric_id,
        actual_value: normalizeIntegerText(
          row.expected_value,
          "Example metric value"
        )
      })),
      RESULT_CONTRACTS.metrics.headers
    );
  }
  return stringifyCsv(
    rows.map((row) => ({
      check_id: row.check_id,
      actual_value: normalizeIntegerText(
        row.expected_value,
        "Example quality value"
      )
    })),
    RESULT_CONTRACTS.quality.headers
  );
}

function normalizeIntegerText(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[+-]?\d+$/.test(text)) {
    throw new Error(`${label} must be an integer without decimals or exponents.`);
  }
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "");
  if (/^0+$/.test(unsigned)) {
    return "0";
  }
  return `${negative ? "-" : ""}${unsigned}`;
}

function incrementIntegerText(value) {
  return (BigInt(value) + 1n).toString();
}

function countKind(diagnostics, kind) {
  return diagnostics.filter((diagnostic) => diagnostic.kind === kind).length;
}

function resultLabel(resultType) {
  return resultType === "metrics"
    ? "actual_metrics.csv"
    : "actual_quality.csv";
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
