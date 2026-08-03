import { CONFORMANCE_CATALOG } from "../data/edge-case-contracts.js";
import {
  canonicalJsonStringify,
  createCapacityPlanReceipt,
  createReportingWindowReceipt,
  RECEIPT_SCHEMA_URL,
  RECEIPT_SCHEMA_VERSION,
  sha256Hex,
  TOOLKIT_VERSION
} from "../lib/analysis-receipt.js";
import { parseStrictJson } from "../lib/strict-json.js";
import { buildReportingWindow } from "./reporting-window.js";
import { calculateCapacityPlan } from "./waitlist-planner.js";

export const RECEIPT_MAX_BYTES = 256 * 1024;
export const SOURCE_MAX_BYTES = Object.freeze({
  baseline: 10 * 1024 * 1024,
  current: 10 * 1024 * 1024,
  actual_metrics: 1024 * 1024,
  actual_quality: 1024 * 1024
});

const RECEIPT_TYPE = "healthcare-reporting-toolkit-analysis-receipt";
const CALCULATION_FIELDS = [
  "assumptions",
  "inputs",
  "limitations",
  "outputs",
  "receipt_type",
  "schema_version",
  "sources",
  "tool",
  "toolkit_version",
  "warnings"
];
const TOP_LEVEL_FIELDS = [
  "$schema",
  ...CALCULATION_FIELDS,
  "calculation_digest",
  "generated_at"
];
const LIMITATIONS = [
  "This receipt records a local calculation and its stated assumptions.",
  "It does not prove source accuracy, authorship, approval, or time of creation."
];
const OUTPUT_LIMIT_WARNING =
  "The aggregate comparison completed, but the detailed change log was not generated because it exceeded a local download safety limit.";

const TOOL_METADATA = {
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

const LEGACY_EXTRACT_ASSUMPTIONS = TOOL_METADATA[
  "extract-change-auditor"
].assumptions.filter((assumption) => assumption.id !== "key-column-names-omitted");
const HISTORICAL_EDGE_CATALOG = Object.freeze({
  catalog_digest:
    "sha256:e441ce7779cc30b0b539a7f201e4928cb2f8303ee5de0fd1aac1f29c17143807",
  catalog_id: "health-data-edge-cases",
  source_release:
    "https://github.com/dfrbagley-cpu/health-data-edge-cases/releases/tag/v0.2.0",
  suite_version: "0.2.0"
});

export class ReceiptValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "ReceiptValidationError";
    this.path = path;
  }
}

export async function inspectAnalysisReceipt(input) {
  const receipt = parseStrictJson(input, { maxBytes: RECEIPT_MAX_BYTES });
  validateAnalysisReceipt(receipt);

  const recalculatedDigest = await recalculateReceiptDigest(receipt);
  const digestMatches = receipt.calculation_digest === recalculatedDigest;
  const replay = await replayReceipt(receipt);

  return {
    receipt,
    structure: {
      status: "valid",
      profile: `${receipt.toolkit_version}/${receipt.schema_version}/${receipt.tool.id}`
    },
    digest: {
      status: digestMatches ? "match" : "mismatch",
      matches: digestMatches,
      recorded: receipt.calculation_digest,
      recalculated: recalculatedDigest,
      excluded_fields: ["$schema", "calculation_digest", "generated_at"]
    },
    replay,
    source_roles: receipt.sources.map((source) => source.role),
    verdict:
      digestMatches && replay.status !== "mismatch"
        ? "internally-consistent"
        : "inconsistent"
  };
}

export function validateAnalysisReceipt(receipt) {
  assertObject(receipt, "$");
  assertExactKeys(receipt, TOP_LEVEL_FIELDS, "$");
  assertEqual(receipt.$schema, RECEIPT_SCHEMA_URL, "$.$schema");
  assertEqual(receipt.receipt_type, RECEIPT_TYPE, "$.receipt_type");
  assertEqual(
    receipt.schema_version,
    RECEIPT_SCHEMA_VERSION,
    "$.schema_version"
  );
  assertDigest(receipt.calculation_digest, "$.calculation_digest", true);
  assertCanonicalTimestamp(receipt.generated_at, "$.generated_at");
  assertEqualJson(receipt.limitations, LIMITATIONS, "$.limitations");
  assertStringArray(receipt.warnings, "$.warnings");

  assertObject(receipt.tool, "$.tool");
  assertExactKeys(receipt.tool, ["id", "name"], "$.tool");
  const toolId = assertString(receipt.tool.id, "$.tool.id");
  const version = assertString(receipt.toolkit_version, "$.toolkit_version");
  assertSupportedProfile(version, toolId);

  const metadata = TOOL_METADATA[toolId];
  assertEqual(receipt.tool.name, metadata.name, "$.tool.name");
  const assumptions =
    toolId === "extract-change-auditor" && isLegacyExtractVersion(version)
      ? LEGACY_EXTRACT_ASSUMPTIONS
      : metadata.assumptions;
  assertEqualJson(receipt.assumptions, assumptions, "$.assumptions");

  if (toolId === "reporting-window") {
    validateReportingWindowReceipt(receipt);
  } else if (toolId === "extract-change-auditor") {
    validateExtractReceipt(receipt);
  } else if (toolId === "waitlist-capacity-planner") {
    validateCapacityReceipt(receipt);
  } else {
    validateConformanceReceipt(receipt);
  }
  return receipt;
}

export async function recalculateReceiptDigest(receipt) {
  assertObject(receipt, "$");
  const calculationCore = Object.create(null);
  for (const field of CALCULATION_FIELDS) {
    if (!Object.hasOwn(receipt, field)) {
      throw new ReceiptValidationError("$", `missing required member ${field}`);
    }
    calculationCore[field] = receipt[field];
  }
  return `sha256:${await sha256Hex(canonicalJsonStringify(calculationCore))}`;
}

export async function verifyReceiptSource({ receipt, role, input }) {
  validateAnalysisReceipt(receipt);
  const source = receipt.sources.find((candidate) => candidate.role === role);
  if (!source) {
    throw new ReceiptValidationError(
      "$.sources",
      `receipt has no ${JSON.stringify(role)} source fingerprint`
    );
  }
  const maximum = SOURCE_MAX_BYTES[role];
  if (!maximum) {
    throw new ReceiptValidationError("$.sources", "source role is unsupported");
  }
  const bytes = await readSourceBytes(input, maximum);
  const actualSha256 = await sha256Hex(bytes);
  const sha256Matches = actualSha256 === source.sha256;
  const byteCountMatches = bytes.byteLength === source.byte_count;
  return {
    role,
    status: sha256Matches && byteCountMatches ? "match" : "mismatch",
    matches: sha256Matches && byteCountMatches,
    sha256_matches: sha256Matches,
    byte_count_matches: byteCountMatches,
    expected_sha256: source.sha256,
    actual_sha256: actualSha256,
    expected_byte_count: source.byte_count,
    actual_byte_count: bytes.byteLength
  };
}

async function replayReceipt(receipt) {
  if (receipt.tool.id === "reporting-window") {
    const inputs = reportingWindowInputs(receipt.inputs);
    let result;
    try {
      result = buildReportingWindow(inputs);
    } catch (error) {
      throw new ReceiptValidationError("$.inputs", error.message);
    }
    const replayed = await createReportingWindowReceipt({
      inputs,
      result,
      generatedAt: receipt.generated_at
    });
    return compareReplay(receipt, replayed);
  }

  if (receipt.tool.id === "waitlist-capacity-planner") {
    const inputs = capacityInputs(receipt.inputs);
    let result;
    try {
      result = calculateCapacityPlan(inputs);
    } catch (error) {
      throw new ReceiptValidationError("$.inputs", error.message);
    }
    const replayed = await createCapacityPlanReceipt({
      result,
      generatedAt: receipt.generated_at
    });
    return compareReplay(receipt, replayed);
  }

  return {
    status: "not-available",
    matches: null,
    differences: [],
    reason:
      receipt.tool.id === "extract-change-auditor"
        ? "The receipt omits key-column names and source values required to replay an extract comparison."
        : "The receipt omits detailed expected and actual results required to replay a conformance comparison."
  };
}

function compareReplay(receipt, replayed) {
  const differences = [];
  collectDifferences(receipt.outputs, replayed.outputs, "$.outputs", differences);
  collectDifferences(receipt.warnings, replayed.warnings, "$.warnings", differences);
  return {
    status: differences.length === 0 ? "match" : "mismatch",
    matches: differences.length === 0,
    differences,
    reason:
      differences.length === 0
        ? "Recorded outputs and warnings match deterministic replay."
        : "Recorded outputs or warnings differ from deterministic replay."
  };
}

function validateReportingWindowReceipt(receipt) {
  assertArrayLength(receipt.sources, 0, "$.sources");
  const inputs = receipt.inputs;
  assertObject(inputs, "$.inputs");
  const periodType = assertEnum(
    inputs.period_type,
    ["fiscal_ytd", "fiscal_qtd", "rolling", "custom"],
    "$.inputs.period_type"
  );
  const expectedKeys = ["comparison_type", "fiscal_start_month", "period_type"];
  if (periodType === "custom") {
    expectedKeys.push("custom_end", "custom_start");
  } else {
    expectedKeys.push("as_of");
  }
  if (periodType === "rolling") {
    expectedKeys.push("rolling_days");
  }
  assertExactKeys(inputs, expectedKeys, "$.inputs");
  assertEnum(
    inputs.comparison_type,
    ["prior_year", "previous_period"],
    "$.inputs.comparison_type"
  );
  assertIntegerBetween(
    inputs.fiscal_start_month,
    1,
    12,
    "$.inputs.fiscal_start_month"
  );
  if (periodType === "custom") {
    assertIsoDate(inputs.custom_start, "$.inputs.custom_start");
    assertIsoDate(inputs.custom_end, "$.inputs.custom_end");
  } else {
    assertIsoDate(inputs.as_of, "$.inputs.as_of");
  }
  if (periodType === "rolling") {
    assertIntegerBetween(inputs.rolling_days, 1, 3_660, "$.inputs.rolling_days");
  }

  assertObject(receipt.outputs, "$.outputs");
  assertExactKeys(
    receipt.outputs,
    ["comparison_period", "current_period"],
    "$.outputs"
  );
  validatePeriod(receipt.outputs.comparison_period, "$.outputs.comparison_period");
  validatePeriod(receipt.outputs.current_period, "$.outputs.current_period");
}

function validatePeriod(period, path) {
  assertObject(period, path);
  assertExactKeys(period, ["end", "fiscal_year", "inclusive_days", "start"], path);
  assertIsoDate(period.start, `${path}.start`);
  assertIsoDate(period.end, `${path}.end`);
  assertNonEmptyString(period.fiscal_year, `${path}.fiscal_year`);
  assertPositiveInteger(period.inclusive_days, `${path}.inclusive_days`);
}

function validateExtractReceipt(receipt) {
  const legacy = isLegacyExtractVersion(receipt.toolkit_version);
  const inputs = receipt.inputs;
  assertObject(inputs, "$.inputs");
  assertExactKeys(
    inputs,
    legacy
      ? [
          "comparison_mode",
          "key_column_count",
          "key_definition_digest",
          "trim_surrounding_whitespace"
        ]
      : [
          "comparison_mode",
          "key_column_count",
          "trim_surrounding_whitespace"
        ],
    "$.inputs"
  );
  assertEqual(
    inputs.comparison_mode,
    "shared-non-key-columns-as-text",
    "$.inputs.comparison_mode"
  );
  assertPositiveInteger(inputs.key_column_count, "$.inputs.key_column_count");
  assertBoolean(
    inputs.trim_surrounding_whitespace,
    "$.inputs.trim_surrounding_whitespace"
  );
  if (legacy) {
    assertDigest(inputs.key_definition_digest, "$.inputs.key_definition_digest", true);
  }

  const [baseline, current] = validateSources(receipt.sources, [
    "baseline",
    "current"
  ]);
  const outputs = receipt.outputs;
  assertObject(outputs, "$.outputs");
  assertExactKeys(
    outputs,
    ["key_integrity", "record_summary", "schema_summary"],
    "$.outputs"
  );
  const keyIntegrity = outputs.key_integrity;
  assertObject(keyIntegrity, "$.outputs.key_integrity");
  assertExactKeys(
    keyIntegrity,
    ["ambiguous_key_value_count", "blank_key_row_count"],
    "$.outputs.key_integrity"
  );
  for (const field of ["ambiguous_key_value_count", "blank_key_row_count"]) {
    assertNonNegativeInteger(keyIntegrity[field], `$.outputs.key_integrity.${field}`);
  }

  const summary = outputs.record_summary;
  assertObject(summary, "$.outputs.record_summary");
  assertExactKeys(
    summary,
    [
      "added",
      "baseline_rows",
      "changed",
      "changed_cells",
      "current_rows",
      "removed",
      "unchanged"
    ],
    "$.outputs.record_summary"
  );
  for (const field of Object.keys(summary)) {
    assertNonNegativeInteger(summary[field], `$.outputs.record_summary.${field}`);
  }

  const schema = outputs.schema_summary;
  assertObject(schema, "$.outputs.schema_summary");
  assertExactKeys(
    schema,
    [
      "added_column_count",
      "compared_column_count",
      "removed_column_count",
      "type_shift_count"
    ],
    "$.outputs.schema_summary"
  );
  for (const field of Object.keys(schema)) {
    assertNonNegativeInteger(schema[field], `$.outputs.schema_summary.${field}`);
  }

  assertInvariant(
    summary.baseline_rows === baseline.row_count,
    "$.outputs.record_summary.baseline_rows",
    "must equal the baseline source row count"
  );
  assertInvariant(
    summary.current_rows === current.row_count,
    "$.outputs.record_summary.current_rows",
    "must equal the current source row count"
  );
  assertInvariant(
    baseline.column_count ===
      schema.removed_column_count +
        schema.compared_column_count +
        inputs.key_column_count,
    "$.outputs.schema_summary",
    "baseline column counts are inconsistent"
  );
  assertInvariant(
    current.column_count ===
      schema.added_column_count +
        schema.compared_column_count +
        inputs.key_column_count,
    "$.outputs.schema_summary",
    "current column counts are inconsistent"
  );
  assertInvariant(
    schema.type_shift_count <= schema.compared_column_count,
    "$.outputs.schema_summary.type_shift_count",
    "cannot exceed compared column count"
  );
  assertInvariant(
    bigintSum(summary.added, summary.changed, summary.unchanged) <=
      BigInt(summary.current_rows),
    "$.outputs.record_summary",
    "current-side record counts exceed current rows"
  );
  assertInvariant(
    bigintSum(summary.removed, summary.changed, summary.unchanged) <=
      BigInt(summary.baseline_rows),
    "$.outputs.record_summary",
    "baseline-side record counts exceed baseline rows"
  );
  assertInvariant(
    BigInt(keyIntegrity.blank_key_row_count) <=
      bigintSum(summary.baseline_rows, summary.current_rows),
    "$.outputs.key_integrity.blank_key_row_count",
    "cannot exceed total source rows"
  );
  assertInvariant(
    summary.changed === 0
      ? summary.changed_cells === 0
      : summary.changed_cells >= summary.changed &&
          BigInt(summary.changed_cells) <=
            BigInt(summary.changed) * BigInt(schema.compared_column_count),
    "$.outputs.record_summary.changed_cells",
    "is inconsistent with changed records and compared columns"
  );

  const expectedWarnings = [];
  if (keyIntegrity.ambiguous_key_value_count > 0) {
    expectedWarnings.push(
      `${keyIntegrity.ambiguous_key_value_count} duplicated key value(s) were excluded from record-level comparison.`
    );
  }
  if (keyIntegrity.blank_key_row_count > 0) {
    expectedWarnings.push(
      `${keyIntegrity.blank_key_row_count} row(s) with blank key fields were excluded from record-level comparison.`
    );
  }
  if (schema.compared_column_count === 0) {
    expectedWarnings.push(
      "The extracts share no non-key columns, so only added and removed records were compared."
    );
  }
  if (!legacy && receipt.warnings.at(-1) === OUTPUT_LIMIT_WARNING) {
    expectedWarnings.push(OUTPUT_LIMIT_WARNING);
  }
  assertEqualJson(receipt.warnings, expectedWarnings, "$.warnings");
}

function validateCapacityReceipt(receipt) {
  assertArrayLength(receipt.sources, 0, "$.sources");
  const inputs = receipt.inputs;
  assertObject(inputs, "$.inputs");
  assertExactKeys(
    inputs,
    [
      "capacity_change_week",
      "current_capacity_per_week",
      "current_waitlist",
      "planning_horizon_weeks",
      "proposed_capacity_per_week",
      "target_wait_proxy_weeks",
      "weekly_arrivals"
    ],
    "$.inputs"
  );
  for (const field of [
    "current_capacity_per_week",
    "current_waitlist",
    "proposed_capacity_per_week",
    "target_wait_proxy_weeks",
    "weekly_arrivals"
  ]) {
    assertCapacityNumber(inputs[field], `$.inputs.${field}`);
  }
  assertIntegerBetween(
    inputs.planning_horizon_weeks,
    1,
    104,
    "$.inputs.planning_horizon_weeks"
  );
  assertIntegerBetween(
    inputs.capacity_change_week,
    1,
    inputs.planning_horizon_weeks,
    "$.inputs.capacity_change_week"
  );

  const outputs = receipt.outputs;
  assertObject(outputs, "$.outputs");
  assertExactKeys(outputs, ["no_change", "proposed_plan", "recommendation"], "$.outputs");
  validateCapacityOutcome(outputs.no_change, "$.outputs.no_change", false);
  validateCapacityOutcome(outputs.proposed_plan, "$.outputs.proposed_plan", true);

  const recommendation = outputs.recommendation;
  assertObject(recommendation, "$.outputs.recommendation");
  assertExactKeys(
    recommendation,
    [
      "required_capacity_per_week",
      "required_whole_capacity_per_week",
      "sustainable_capacity_floor"
    ],
    "$.outputs.recommendation"
  );
  assertNonNegativeNumber(
    recommendation.required_capacity_per_week,
    "$.outputs.recommendation.required_capacity_per_week"
  );
  assertNonNegativeInteger(
    recommendation.required_whole_capacity_per_week,
    "$.outputs.recommendation.required_whole_capacity_per_week"
  );
  assertNonNegativeNumber(
    recommendation.sustainable_capacity_floor,
    "$.outputs.recommendation.sustainable_capacity_floor"
  );
}

function validateCapacityOutcome(outcome, path, planned) {
  assertObject(outcome, path);
  const fields = ["final_backlog", "final_wait_proxy"];
  if (planned) {
    fields.push(
      "meets_target_at_horizon",
      "on_track",
      "sustainable_under_model",
      "sustained_target_week"
    );
  }
  assertExactKeys(outcome, fields, path);
  assertNonNegativeNumber(outcome.final_backlog, `${path}.final_backlog`);
  validateFiniteMeasure(outcome.final_wait_proxy, `${path}.final_wait_proxy`);
  if (planned) {
    for (const field of [
      "meets_target_at_horizon",
      "on_track",
      "sustainable_under_model"
    ]) {
      assertBoolean(outcome[field], `${path}.${field}`);
    }
    if (outcome.sustained_target_week !== null) {
      assertPositiveInteger(
        outcome.sustained_target_week,
        `${path}.sustained_target_week`
      );
    }
  }
}

function validateFiniteMeasure(measure, path) {
  assertObject(measure, path);
  assertExactKeys(measure, ["status", "weeks"], path);
  assertEnum(measure.status, ["finite", "not-finite"], `${path}.status`);
  if (measure.status === "finite") {
    assertNonNegativeNumber(measure.weeks, `${path}.weeks`);
  } else {
    assertEqual(measure.weeks, null, `${path}.weeks`);
  }
}

function validateConformanceReceipt(receipt) {
  const [metrics, quality] = validateSources(receipt.sources, [
    "actual_metrics",
    "actual_quality"
  ]);
  assertInvariant(
    metrics.column_count === 3,
    "$.sources[0].column_count",
    "actual_metrics must contain three columns"
  );
  assertInvariant(
    quality.column_count === 2,
    "$.sources[1].column_count",
    "actual_quality must contain two columns"
  );

  const inputs = receipt.inputs;
  assertObject(inputs, "$.inputs");
  assertExactKeys(inputs, ["case_id", "contract_catalog"], "$.inputs");
  const caseId = assertNonEmptyString(inputs.case_id, "$.inputs.case_id");
  const selectedCase = CONFORMANCE_CATALOG.cases.find(
    (candidate) => candidate.id === caseId
  );
  assertInvariant(Boolean(selectedCase), "$.inputs.case_id", "is not a supported case ID");

  const catalog = inputs.contract_catalog;
  assertObject(catalog, "$.inputs.contract_catalog");
  assertExactKeys(
    catalog,
    ["catalog_digest", "catalog_id", "source_release", "suite_version"],
    "$.inputs.contract_catalog"
  );
  const expectedCatalog = ["0.3.0", "0.4.0"].includes(
    receipt.toolkit_version
  )
    ? HISTORICAL_EDGE_CATALOG
    : CONFORMANCE_CATALOG;
  for (const field of [
    "catalog_digest",
    "catalog_id",
    "source_release",
    "suite_version"
  ]) {
    assertEqual(
      catalog[field],
      expectedCatalog[field],
      `$.inputs.contract_catalog.${field}`
    );
  }

  const outputs = receipt.outputs;
  assertObject(outputs, "$.outputs");
  assertExactKeys(outputs, ["passed", "summary"], "$.outputs");
  assertBoolean(outputs.passed, "$.outputs.passed");
  const summary = outputs.summary;
  assertObject(summary, "$.outputs.summary");
  assertExactKeys(
    summary,
    [
      "expectation_count",
      "matched",
      "mismatch_count",
      "missing",
      "unexpected",
      "value"
    ],
    "$.outputs.summary"
  );
  for (const field of Object.keys(summary)) {
    assertNonNegativeInteger(summary[field], `$.outputs.summary.${field}`);
  }
  assertInvariant(
    summary.mismatch_count ===
      summary.missing + summary.unexpected + summary.value,
    "$.outputs.summary.mismatch_count",
    "must equal missing, unexpected, and incorrect-value counts"
  );
  assertInvariant(
    summary.expectation_count === summary.matched + summary.missing + summary.value,
    "$.outputs.summary.expectation_count",
    "must equal matched, missing, and incorrect-value counts"
  );
  assertInvariant(
    outputs.passed === (summary.mismatch_count === 0),
    "$.outputs.passed",
    "must be true exactly when there are no mismatches"
  );
  assertInvariant(
    summary.expectation_count ===
      selectedCase.metrics.length + selectedCase.quality.length,
    "$.outputs.summary.expectation_count",
    "does not match the selected case"
  );
  assertEqualJson(
    receipt.warnings,
    outputs.passed
      ? []
      : [
          `${summary.mismatch_count} result difference(s) require review for the selected synthetic case.`
        ],
    "$.warnings"
  );
}

function validateSources(sources, roles) {
  assertArrayLength(sources, roles.length, "$.sources");
  return roles.map((role, index) => {
    const path = `$.sources[${index}]`;
    const source = sources[index];
    assertObject(source, path);
    assertExactKeys(
      source,
      ["byte_count", "column_count", "role", "row_count", "sha256"],
      path
    );
    assertEqual(source.role, role, `${path}.role`);
    assertDigest(source.sha256, `${path}.sha256`, false);
    assertNonNegativeInteger(source.byte_count, `${path}.byte_count`);
    assertNonNegativeInteger(source.column_count, `${path}.column_count`);
    assertNonNegativeInteger(source.row_count, `${path}.row_count`);
    assertInvariant(
      source.byte_count <= SOURCE_MAX_BYTES[role],
      `${path}.byte_count`,
      `exceeds the ${formatBytes(SOURCE_MAX_BYTES[role])} role limit`
    );
    return source;
  });
}

function assertSupportedProfile(version, toolId) {
  const versions = new Set(["0.2.0", "0.3.0", "0.4.0", TOOLKIT_VERSION]);
  if (!versions.has(version)) {
    throw new ReceiptValidationError(
      "$.toolkit_version",
      `unsupported toolkit release ${JSON.stringify(version)}`
    );
  }
  if (!Object.hasOwn(TOOL_METADATA, toolId)) {
    throw new ReceiptValidationError("$.tool.id", "unsupported receipt tool");
  }
  if (version === "0.2.0" && toolId === "reporting-results-checker") {
    throw new ReceiptValidationError(
      "$.tool.id",
      "the reporting-results receipt did not exist in toolkit 0.2.0"
    );
  }
}

function reportingWindowInputs(inputs) {
  return {
    type: inputs.period_type,
    comparisonType: inputs.comparison_type,
    fiscalStartMonth: inputs.fiscal_start_month,
    asOf: inputs.as_of ?? "",
    customStart: inputs.custom_start ?? "",
    customEnd: inputs.custom_end ?? "",
    rollingDays: inputs.rolling_days ?? 90
  };
}

function capacityInputs(inputs) {
  return {
    initialBacklog: inputs.current_waitlist,
    weeklyArrivals: inputs.weekly_arrivals,
    weeklyCapacity: inputs.current_capacity_per_week,
    proposedCapacity: inputs.proposed_capacity_per_week,
    targetWaitWeeks: inputs.target_wait_proxy_weeks,
    horizonWeeks: inputs.planning_horizon_weeks,
    changeWeek: inputs.capacity_change_week
  };
}

async function readSourceBytes(input, maximum) {
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    if (input.size > maximum) {
      throw new ReceiptValidationError(
        "source",
        `file is larger than the ${formatBytes(maximum)} limit`
      );
    }
    return new Uint8Array(await input.arrayBuffer());
  }
  if (typeof input === "string") {
    const bytes = new TextEncoder().encode(input);
    assertSourceSize(bytes.byteLength, maximum);
    return bytes;
  }
  let bytes;
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new TypeError("Source input must be a file, text, or bytes.");
  }
  assertSourceSize(bytes.byteLength, maximum);
  return bytes;
}

function assertSourceSize(size, maximum) {
  if (size > maximum) {
    throw new ReceiptValidationError(
      "source",
      `file is larger than the ${formatBytes(maximum)} limit`
    );
  }
}

function collectDifferences(recorded, replayed, path, differences) {
  if (differences.length >= 20) {
    return;
  }
  if (valuesEqual(recorded, replayed)) {
    return;
  }
  if (Array.isArray(recorded) && Array.isArray(replayed)) {
    const length = Math.max(recorded.length, replayed.length);
    for (let index = 0; index < length && differences.length < 20; index += 1) {
      collectDifferences(recorded[index], replayed[index], `${path}[${index}]`, differences);
    }
    return;
  }
  if (isObject(recorded) && isObject(replayed)) {
    const keys = [...new Set([...Object.keys(recorded), ...Object.keys(replayed)])].sort();
    for (const key of keys) {
      if (differences.length >= 20) {
        break;
      }
      collectDifferences(
        recorded[key],
        replayed[key],
        `${path}.${key}`,
        differences
      );
    }
    return;
  }
  differences.push({
    path,
    recorded: summarizeValue(recorded),
    replayed: summarizeValue(replayed)
  });
}

function valuesEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      valuesEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => valuesEqual(left[key], right[key]))
    );
  }
  return false;
}

function summarizeValue(value) {
  if (value === undefined) {
    return "(missing)";
  }
  const text = canonicalJsonStringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

function assertObject(value, path) {
  if (!isObject(value)) {
    throw new ReceiptValidationError(path, "must be an object");
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, path) {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const unexpected = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) {
      details.push(`missing ${missing.join(", ")}`);
    }
    if (unexpected.length > 0) {
      details.push(`unexpected ${unexpected.join(", ")}`);
    }
    throw new ReceiptValidationError(path, details.join("; "));
  }
}

function assertEqual(value, expected, path) {
  if (value !== expected) {
    throw new ReceiptValidationError(path, `must equal ${JSON.stringify(expected)}`);
  }
  return value;
}

function assertEqualJson(value, expected, path) {
  if (canonicalJsonStringify(value) !== canonicalJsonStringify(expected)) {
    throw new ReceiptValidationError(path, "does not match the supported release profile");
  }
}

function assertString(value, path) {
  if (typeof value !== "string") {
    throw new ReceiptValidationError(path, "must be text");
  }
  return value;
}

function assertNonEmptyString(value, path) {
  assertString(value, path);
  if (value.length === 0) {
    throw new ReceiptValidationError(path, "must not be empty");
  }
  return value;
}

function assertStringArray(value, path) {
  if (!Array.isArray(value)) {
    throw new ReceiptValidationError(path, "must be an array");
  }
  value.forEach((item, index) => assertString(item, `${path}[${index}]`));
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new ReceiptValidationError(path, "must be true or false");
  }
}

function assertEnum(value, choices, path) {
  if (!choices.includes(value)) {
    throw new ReceiptValidationError(path, `must be one of ${choices.join(", ")}`);
  }
  return value;
}

function assertNonNegativeNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ReceiptValidationError(path, "must be a finite number of zero or greater");
  }
}

function assertCapacityNumber(value, path) {
  assertNonNegativeNumber(value, path);
  if (!Number.isSafeInteger(Math.trunc(value))) {
    throw new ReceiptValidationError(path, "is too large to calculate safely");
  }
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReceiptValidationError(path, "must be a non-negative safe integer");
  }
}

function assertPositiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ReceiptValidationError(path, "must be a positive safe integer");
  }
}

function assertIntegerBetween(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ReceiptValidationError(
      path,
      `must be a whole number from ${minimum} to ${maximum}`
    );
  }
}

function assertArrayLength(value, length, path) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new ReceiptValidationError(path, `must contain exactly ${length} item(s)`);
  }
}

function assertDigest(value, path, prefixed) {
  const pattern = prefixed
    ? /^sha256:[0-9a-f]{64}$/
    : /^[0-9a-f]{64}$/;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ReceiptValidationError(
      path,
      prefixed
        ? "must be a lowercase sha256: digest"
        : "must be a lowercase SHA-256 value"
    );
  }
}

function assertIsoDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ReceiptValidationError(path, "must be an ISO calendar date");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ReceiptValidationError(path, "must be a valid ISO calendar date");
  }
}

function assertCanonicalTimestamp(value, path) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new ReceiptValidationError(path, "must be a canonical UTC date-time");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ReceiptValidationError(path, "must be a valid canonical UTC date-time");
  }
}

function assertInvariant(condition, path, message) {
  if (!condition) {
    throw new ReceiptValidationError(path, message);
  }
}

function isLegacyExtractVersion(version) {
  return version === "0.2.0" || version === "0.3.0";
}

function bigintSum(...values) {
  return values.reduce((total, value) => total + BigInt(value), 0n);
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${bytes / (1024 * 1024)} MB`
    : `${bytes / 1024} KB`;
}
