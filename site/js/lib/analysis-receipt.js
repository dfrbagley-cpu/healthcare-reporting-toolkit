export const TOOLKIT_VERSION = "0.4.0";
export const RECEIPT_SCHEMA_VERSION = "1.0.0";
export const RECEIPT_SCHEMA_URL =
  "https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/schemas/analysis-receipt.schema.json";

const RECEIPT_TYPE = "healthcare-reporting-toolkit-analysis-receipt";
const RECEIPT_LIMITATIONS = [
  "This receipt records a local calculation and its stated assumptions.",
  "It does not prove source accuracy, authorship, approval, or time of creation."
];

const TOOL_CATALOG = {
  "reporting-window": {
    name: "Reporting Window Builder",
    assumptions: [
      {
        id: "calendar-dates-utc",
        statement: "Calendar calculations use UTC dates to avoid daylight-saving shifts."
      },
      {
        id: "inclusive-date-boundaries",
        statement: "Reported day counts include both the start and end date."
      },
      {
        id: "prior-year-calendar-alignment",
        statement: "Prior-year comparisons subtract one calendar year and clamp February 29 when needed."
      },
      {
        id: "no-local-calendar-adjustments",
        statement: "The calculation does not adjust for holidays, weekdays, 4-4-5 calendars, or local exclusions."
      }
    ]
  },
  "extract-change-auditor": {
    name: "Extract Change Auditor",
    assumptions: [
      {
        id: "local-browser-processing",
        statement: "Selected extracts are processed locally by the browser."
      },
      {
        id: "utf8-comma-delimited",
        statement: "Inputs are interpreted as UTF-8 comma-delimited CSV."
      },
      {
        id: "shared-columns-text-comparison",
        statement: "Only shared non-key columns are compared at record level, and values are compared as text."
      },
      {
        id: "ambiguous-keys-excluded",
        statement: "Rows with blank key fields and duplicated key values are excluded rather than guessed."
      },
      {
        id: "key-column-names-omitted",
        statement: "The receipt records the number of key columns but omits their names; preserve that configuration separately for exact reproduction."
      },
      {
        id: "type-inference-screening-only",
        statement: "Inferred type shifts are screening signals, not a formal schema."
      }
    ]
  },
  "waitlist-capacity-planner": {
    name: "Waitlist Capacity Planner",
    assumptions: [
      {
        id: "constant-average-weekly-flow",
        statement: "Average weekly arrivals and configured capacity are constant within each model segment."
      },
      {
        id: "fluid-queue-approximation",
        statement: "The model is a deterministic fluid-queue approximation, not a patient-level simulation."
      },
      {
        id: "wait-proxy-backlog-divided-by-capacity",
        statement: "The wait proxy is backlog divided by that week's service capacity."
      },
      {
        id: "no-seasonality-or-priority-classes",
        statement: "The model does not include seasonality, cancellations, priority classes, or capacity variation."
      },
      {
        id: "sustainable-floor-at-average-arrivals",
        statement: "Recommended sustainable capacity is never below average weekly arrivals."
      }
    ]
  },
  "reporting-results-checker": {
    name: "Reporting Results Checker",
    assumptions: [
      {
        id: "local-browser-processing",
        statement: "Selected result exports are processed locally by the browser."
      },
      {
        id: "pinned-synthetic-contract",
        statement: "Results are compared only with the selected case in the bundled, versioned synthetic contract catalog."
      },
      {
        id: "complete-key-set-required",
        statement: "A pass requires every expected key and exact integer value, with no unexpected keys."
      },
      {
        id: "no-pipeline-execution",
        statement: "The checker evaluates exported results and does not execute or inspect the reporting pipeline that produced them."
      }
    ]
  }
};

export async function createReportingWindowReceipt({
  inputs,
  result,
  generatedAt
}) {
  const normalizedInputs = {
    comparison_type: result.comparisonType,
    fiscal_start_month: integerAtLeast(
      inputs.fiscalStartMonth,
      1,
      "Fiscal start month"
    ),
    period_type: result.type
  };

  if (result.type === "custom") {
    normalizedInputs.custom_end = String(inputs.customEnd);
    normalizedInputs.custom_start = String(inputs.customStart);
  } else {
    normalizedInputs.as_of = String(inputs.asOf);
  }
  if (result.type === "rolling") {
    normalizedInputs.rolling_days = integerAtLeast(
      inputs.rollingDays,
      1,
      "Rolling days"
    );
  }

  return createReceipt({
    toolId: "reporting-window",
    generatedAt,
    inputs: normalizedInputs,
    outputs: {
      comparison_period: {
        fiscal_year: result.comparisonFiscalYear,
        inclusive_days: result.comparison.days,
        end: result.comparison.end,
        start: result.comparison.start
      },
      current_period: {
        fiscal_year: result.currentFiscalYear,
        inclusive_days: result.current.days,
        end: result.current.end,
        start: result.current.start
      }
    },
    sources: [],
    warnings: result.warnings
  });
}

export async function createExtractAuditReceipt({
  audit,
  baselineEvidence,
  currentEvidence,
  trimWhitespace,
  generatedAt
}) {
  const warnings = [];
  if (audit.summary.ambiguousKeys > 0) {
    warnings.push(
      `${audit.summary.ambiguousKeys} duplicated key value(s) were excluded from record-level comparison.`
    );
  }
  const blankKeyRows =
    audit.summary.missingBaselineKeys + audit.summary.missingCurrentKeys;
  if (blankKeyRows > 0) {
    warnings.push(
      `${blankKeyRows} row(s) with blank key fields were excluded from record-level comparison.`
    );
  }
  if (audit.comparedColumns.length === 0) {
    warnings.push(
      "The extracts share no non-key columns, so only added and removed records were compared."
    );
  }
  if (audit.changeLog?.available === false) {
    warnings.push(
      "The aggregate comparison completed, but the detailed change log was not generated because it exceeded a local download safety limit."
    );
  }

  return createReceipt({
    toolId: "extract-change-auditor",
    generatedAt,
    inputs: {
      comparison_mode: "shared-non-key-columns-as-text",
      key_column_count: audit.keyColumns.length,
      trim_surrounding_whitespace: Boolean(trimWhitespace)
    },
    outputs: {
      key_integrity: {
        ambiguous_key_value_count: audit.summary.ambiguousKeys,
        blank_key_row_count: blankKeyRows
      },
      record_summary: {
        added: audit.summary.added,
        baseline_rows: audit.summary.baselineRows,
        changed: audit.summary.changed,
        changed_cells: audit.summary.changedCells,
        current_rows: audit.summary.currentRows,
        removed: audit.summary.removed,
        unchanged: audit.summary.unchanged
      },
      schema_summary: {
        added_column_count: audit.addedColumns.length,
        compared_column_count: audit.comparedColumns.length,
        removed_column_count: audit.removedColumns.length,
        type_shift_count: audit.typeChanges.length
      }
    },
    sources: [
      sourceFingerprint("baseline", baselineEvidence),
      sourceFingerprint("current", currentEvidence)
    ],
    warnings
  });
}

export async function createCapacityPlanReceipt({ result, generatedAt }) {
  const finalCurrent = result.current.weeks.at(-1);
  const finalPlanned = result.planned.weeks.at(-1);
  const warnings = [];
  if (!result.meetsTargetAtHorizon) {
    warnings.push(
      "The proposed plan does not meet the selected wait-proxy target at the planning horizon."
    );
  }
  if (!result.sustainableUnderModel) {
    warnings.push(
      "Proposed capacity is below average weekly arrivals, so the plan is not sustainable under this model."
    );
  }

  return createReceipt({
    toolId: "waitlist-capacity-planner",
    generatedAt,
    inputs: {
      capacity_change_week: result.inputs.changeWeek,
      current_capacity_per_week: result.inputs.weeklyCapacity,
      current_waitlist: result.inputs.initialBacklog,
      planning_horizon_weeks: result.inputs.horizonWeeks,
      proposed_capacity_per_week: result.inputs.proposedCapacity,
      target_wait_proxy_weeks: result.inputs.targetWaitWeeks,
      weekly_arrivals: result.inputs.weeklyArrivals
    },
    outputs: {
      no_change: {
        final_backlog: finalCurrent.backlog,
        final_wait_proxy: finiteMeasure(finalCurrent.waitWeeks)
      },
      proposed_plan: {
        final_backlog: finalPlanned.backlog,
        final_wait_proxy: finiteMeasure(finalPlanned.waitWeeks),
        meets_target_at_horizon: result.meetsTargetAtHorizon,
        on_track: result.onTrack,
        sustainable_under_model: result.sustainableUnderModel,
        sustained_target_week: result.targetWeek
      },
      recommendation: {
        required_capacity_per_week: result.requiredPostChangeCapacity,
        required_whole_capacity_per_week: result.requiredWholeCapacity,
        sustainable_capacity_floor: result.sustainableCapacityFloor
      }
    },
    sources: [],
    warnings
  });
}

export async function createConformanceCheckReceipt({
  result,
  catalog,
  metricsEvidence,
  qualityEvidence,
  generatedAt
}) {
  if (!result || typeof result !== "object") {
    throw new Error("Conformance result is required.");
  }
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Conformance catalog is required.");
  }
  const digest = String(catalog.catalog_digest ?? "");
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error("Catalog digest must be a SHA-256 value.");
  }
  const summary = result.summary ?? {};
  const mismatchCount = nonNegativeInteger(
    summary.mismatchCount,
    "Mismatch count"
  );
  const warnings = result.passed
    ? []
    : [
        `${mismatchCount} result difference(s) require review for the selected synthetic case.`
      ];

  return createReceipt({
    toolId: "reporting-results-checker",
    generatedAt,
    inputs: {
      case_id: String(result.caseId),
      contract_catalog: {
        catalog_digest: digest,
        catalog_id: String(catalog.catalog_id),
        source_release: String(catalog.source_release),
        suite_version: String(catalog.suite_version)
      }
    },
    outputs: {
      passed: Boolean(result.passed),
      summary: {
        expectation_count: nonNegativeInteger(
          summary.expectationCount,
          "Expectation count"
        ),
        matched: nonNegativeInteger(summary.matched, "Matched count"),
        mismatch_count: mismatchCount,
        missing: nonNegativeInteger(summary.missing, "Missing count"),
        unexpected: nonNegativeInteger(
          summary.unexpected,
          "Unexpected count"
        ),
        value: nonNegativeInteger(summary.value, "Incorrect value count")
      }
    },
    sources: [
      sourceFingerprint("actual_metrics", metricsEvidence),
      sourceFingerprint("actual_quality", qualityEvidence)
    ],
    warnings
  });
}

export function canonicalJsonStringify(value, { pretty = false } = {}) {
  const normalized = normalizeJsonValue(value, "$", new WeakSet());
  return `${JSON.stringify(normalized, null, pretty ? 2 : 0)}${pretty ? "\n" : ""}`;
}

export async function sha256Hex(value) {
  const bytes = toBytes(value);
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("SHA-256 is unavailable in this environment.");
  }
  const digest = await cryptoApi.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createReceipt({
  toolId,
  generatedAt = new Date().toISOString(),
  inputs,
  outputs,
  sources,
  warnings
}) {
  const tool = TOOL_CATALOG[toolId];
  if (!tool) {
    throw new Error("Choose a supported receipt tool.");
  }
  const normalizedTimestamp = normalizeTimestamp(generatedAt);
  const normalizedWarnings = warningList(warnings);

  const calculationCore = {
    assumptions: tool.assumptions,
    inputs,
    limitations: RECEIPT_LIMITATIONS,
    outputs,
    receipt_type: RECEIPT_TYPE,
    schema_version: RECEIPT_SCHEMA_VERSION,
    sources,
    tool: {
      id: toolId,
      name: tool.name
    },
    toolkit_version: TOOLKIT_VERSION,
    warnings: normalizedWarnings
  };
  const calculationDigest = await sha256Hex(
    canonicalJsonStringify(calculationCore)
  );

  return normalizeJsonValue(
    {
      $schema: RECEIPT_SCHEMA_URL,
      ...calculationCore,
      calculation_digest: `sha256:${calculationDigest}`,
      generated_at: normalizedTimestamp
    },
    "$",
    new WeakSet()
  );
}

function sourceFingerprint(role, evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error(`${role} source evidence is required.`);
  }
  const sha256 = String(evidence.sha256 ?? "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`${role} source SHA-256 must contain 64 hexadecimal characters.`);
  }
  return {
    role,
    sha256,
    byte_count: nonNegativeInteger(evidence.byteCount, `${role} byte count`),
    column_count: nonNegativeInteger(
      evidence.columnCount,
      `${role} column count`
    ),
    row_count: nonNegativeInteger(evidence.rowCount, `${role} row count`)
  };
}

function finiteMeasure(value) {
  if (Number.isFinite(value)) {
    return {
      status: "finite",
      weeks: value
    };
  }
  if (value === Number.POSITIVE_INFINITY) {
    return {
      status: "not-finite",
      weeks: null
    };
  }
  throw new Error("Wait-proxy output must be finite or positive infinity.");
}

function normalizeTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Receipt generation time must be a valid date-time.");
  }
  return parsed.toISOString();
}

function warningList(value) {
  if (!Array.isArray(value)) {
    throw new Error("Receipt warnings must be an array.");
  }
  return value.map((warning) => {
    if (typeof warning !== "string") {
      throw new Error("Every receipt warning must be text.");
    }
    return warning;
  });
}

function integerAtLeast(value, minimum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${label} must be a whole number of at least ${minimum}.`);
  }
  return number;
}

function nonNegativeInteger(value, label) {
  return integerAtLeast(value, 0, label);
}

function toBytes(value) {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("SHA-256 input must be text or bytes.");
}

function normalizeJsonValue(value, path, ancestors) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Receipt value at ${path} must be finite.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new Error(`Receipt value at ${path} is not JSON-compatible.`);
  }
  if (ancestors.has(value)) {
    throw new Error(`Receipt value at ${path} contains a circular reference.`);
  }

  ancestors.add(value);
  let normalized;
  if (Array.isArray(value)) {
    normalized = Array.from(value, (item, index) =>
      normalizeJsonValue(item, `${path}[${index}]`, ancestors)
    );
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      ancestors.delete(value);
      throw new Error(`Receipt value at ${path} must be a plain object.`);
    }
    normalized = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeJsonValue(
        value[key],
        `${path}.${key}`,
        ancestors
      );
    }
  }
  ancestors.delete(value);
  return normalized;
}
