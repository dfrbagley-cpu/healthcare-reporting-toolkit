import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalJsonStringify,
  createCapacityPlanReceipt,
  createConformanceCheckReceipt,
  createExtractAuditReceipt,
  createReportingWindowReceipt,
  RECEIPT_SCHEMA_URL,
  RECEIPT_SCHEMA_VERSION,
  sha256Hex,
  TOOLKIT_VERSION
} from "../site/js/lib/analysis-receipt.js";
import { CONFORMANCE_CATALOG } from "../site/js/data/edge-case-contracts.js";
import { parseCsv } from "../site/js/lib/csv.js";
import { BASELINE_SAMPLE, CURRENT_SAMPLE } from "../site/js/samples.js";
import { auditExtracts } from "../site/js/tools/extract-auditor.js";
import { buildReportingWindow } from "../site/js/tools/reporting-window.js";
import { calculateCapacityPlan } from "../site/js/tools/waitlist-planner.js";

const FIRST_TIME = "2026-07-25T12:00:00.000Z";
const SECOND_TIME = "2026-07-26T12:00:00.000Z";

test("canonical JSON is stable and rejects non-JSON or non-finite values", () => {
  assert.equal(
    canonicalJsonStringify({ z: 1, a: { y: -0, b: true } }),
    '{"a":{"b":true,"y":0},"z":1}'
  );
  assert.throws(
    () => canonicalJsonStringify({ value: Number.POSITIVE_INFINITY }),
    /must be finite/
  );
  assert.throws(
    () => canonicalJsonStringify({ value: Number.NaN }),
    /must be finite/
  );
  assert.throws(
    () => canonicalJsonStringify({ value: undefined }),
    /not JSON-compatible/
  );
});

test("SHA-256 fingerprints match a known vector", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("reporting-window receipts are versioned and calculation-stable", async () => {
  const inputs = {
    type: "fiscal_ytd",
    asOf: "2026-06-15",
    fiscalStartMonth: 4,
    rollingDays: 90,
    customStart: "",
    customEnd: "",
    comparisonType: "prior_year"
  };
  const result = buildReportingWindow(inputs);
  const first = await createReportingWindowReceipt({
    inputs,
    result,
    generatedAt: FIRST_TIME
  });
  const second = await createReportingWindowReceipt({
    inputs,
    result,
    generatedAt: SECOND_TIME
  });

  assert.equal(first.$schema, RECEIPT_SCHEMA_URL);
  assert.equal(first.schema_version, RECEIPT_SCHEMA_VERSION);
  assert.equal(first.toolkit_version, TOOLKIT_VERSION);
  assert.equal(first.tool.id, "reporting-window");
  assert.equal(first.outputs.current_period.start, "2026-04-01");
  assert.equal(first.calculation_digest, second.calculation_digest);
  assert.notEqual(first.generated_at, second.generated_at);
  assert.match(first.calculation_digest, /^sha256:[0-9a-f]{64}$/);
});

test("extract receipts expose fingerprints and aggregates without source details", async () => {
  const audit = auditExtracts({
    baseline: parseCsv(BASELINE_SAMPLE),
    current: parseCsv(CURRENT_SAMPLE),
    keyColumns: ["record_id"],
    trimWhitespace: true
  });
  audit.keyColumns = ["PRIVATE_KEY_COLUMN"];
  audit.addedColumns = ["PRIVATE_ADDED_COLUMN"];
  audit.removedColumns = ["PRIVATE_REMOVED_COLUMN"];
  audit.typeChanges = [
    {
      column: "PRIVATE_TYPE_COLUMN",
      before: "text",
      after: "integer"
    }
  ];
  audit.rowDiffs = [
    {
      key: "PRIVATE-ROW-001",
      status: "changed",
      changedColumns: ["PRIVATE_VALUE_COLUMN"],
      changes: [
        {
          column: "PRIVATE_VALUE_COLUMN",
          before: "PRIVATE-BEFORE",
          after: "PRIVATE-AFTER"
        }
      ]
    }
  ];
  audit.warnings = ["PRIVATE-WARNING"];

  const receipt = await createExtractAuditReceipt({
    audit,
    baselineEvidence: {
      sha256: "a".repeat(64),
      byteCount: 125,
      rowCount: 4,
      columnCount: 6,
      filename: "PRIVATE-BASELINE.csv"
    },
    currentEvidence: {
      sha256: "b".repeat(64),
      byteCount: 140,
      rowCount: 4,
      columnCount: 6,
      filename: "PRIVATE-CURRENT.csv"
    },
    trimWhitespace: true,
    generatedAt: FIRST_TIME
  });
  const serialized = canonicalJsonStringify(receipt);

  assert.equal(receipt.sources[0].sha256, "a".repeat(64));
  assert.equal(receipt.outputs.record_summary.changed, 2);
  assert.equal(receipt.inputs.key_column_count, 1);
  assert.match(
    receipt.inputs.key_definition_digest,
    /^sha256:[0-9a-f]{64}$/
  );
  for (const privateValue of [
    "PRIVATE_KEY_COLUMN",
    "PRIVATE_ADDED_COLUMN",
    "PRIVATE_REMOVED_COLUMN",
    "PRIVATE_TYPE_COLUMN",
    "PRIVATE-ROW-001",
    "PRIVATE_VALUE_COLUMN",
    "PRIVATE-BEFORE",
    "PRIVATE-AFTER",
    "PRIVATE-WARNING",
    "PRIVATE-BASELINE.csv",
    "PRIVATE-CURRENT.csv"
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
});

test("extract receipt digest changes with source bytes or hidden key definition", async () => {
  const audit = auditExtracts({
    baseline: parseCsv(BASELINE_SAMPLE),
    current: parseCsv(CURRENT_SAMPLE),
    keyColumns: ["record_id"],
    trimWhitespace: true
  });
  const common = {
    audit,
    baselineEvidence: {
      sha256: "a".repeat(64),
      byteCount: 125,
      rowCount: 4,
      columnCount: 6
    },
    currentEvidence: {
      sha256: "b".repeat(64),
      byteCount: 140,
      rowCount: 4,
      columnCount: 6
    },
    trimWhitespace: true,
    generatedAt: FIRST_TIME
  };

  const original = await createExtractAuditReceipt(common);
  const changedSource = await createExtractAuditReceipt({
    ...common,
    currentEvidence: {
      ...common.currentEvidence,
      sha256: "c".repeat(64)
    }
  });
  const changedKey = await createExtractAuditReceipt({
    ...common,
    audit: {
      ...audit,
      keyColumns: ["another_private_key"]
    }
  });

  assert.notEqual(
    original.calculation_digest,
    changedSource.calculation_digest
  );
  assert.notEqual(original.calculation_digest, changedKey.calculation_digest);
  assert.equal(
    canonicalJsonStringify(changedKey).includes("another_private_key"),
    false
  );
});

test("capacity receipts represent an infinite wait proxy without non-finite JSON", async () => {
  const result = calculateCapacityPlan({
    initialBacklog: 10,
    weeklyArrivals: 2,
    weeklyCapacity: 0,
    changeWeek: 1,
    proposedCapacity: 0,
    horizonWeeks: 2,
    targetWaitWeeks: 1
  });
  const receipt = await createCapacityPlanReceipt({
    result,
    generatedAt: FIRST_TIME
  });
  const serialized = canonicalJsonStringify(receipt, { pretty: true });

  assert.deepEqual(receipt.outputs.proposed_plan.final_wait_proxy, {
    status: "not-finite",
    weeks: null
  });
  assert.equal(serialized.includes("Infinity"), false);
  assert.equal(receipt.warnings.length, 2);
});

test("conformance receipts keep provenance and aggregates but omit diagnostics", async () => {
  const result = {
    caseId: "unmapped-program-retention",
    passed: false,
    summary: {
      expectationCount: 13,
      matched: 10,
      mismatchCount: 3,
      missing: 1,
      unexpected: 1,
      value: 1
    },
    diagnostics: [
      {
        resultType: "metric",
        kind: "value",
        key: ["PRIVATE-PERIOD", "PRIVATE-METRIC"],
        expected: "PRIVATE-EXPECTED",
        actual: "PRIVATE-ACTUAL"
      }
    ]
  };
  const common = {
    result,
    catalog: CONFORMANCE_CATALOG,
    metricsEvidence: {
      sha256: "c".repeat(64),
      byteCount: 200,
      rowCount: 7,
      columnCount: 3,
      filename: "PRIVATE-METRICS.csv"
    },
    qualityEvidence: {
      sha256: "d".repeat(64),
      byteCount: 150,
      rowCount: 6,
      columnCount: 2,
      filename: "PRIVATE-QUALITY.csv"
    },
    generatedAt: FIRST_TIME
  };
  const receipt = await createConformanceCheckReceipt(common);
  const serialized = canonicalJsonStringify(receipt);

  assert.equal(receipt.tool.id, "reporting-results-checker");
  assert.equal(receipt.inputs.case_id, "unmapped-program-retention");
  assert.equal(
    receipt.inputs.contract_catalog.catalog_digest,
    CONFORMANCE_CATALOG.catalog_digest
  );
  assert.deepEqual(
    receipt.sources.map((source) => source.role),
    ["actual_metrics", "actual_quality"]
  );
  assert.deepEqual(receipt.outputs.summary, {
    expectation_count: 13,
    matched: 10,
    mismatch_count: 3,
    missing: 1,
    unexpected: 1,
    value: 1
  });
  for (const privateValue of [
    "PRIVATE-PERIOD",
    "PRIVATE-METRIC",
    "PRIVATE-EXPECTED",
    "PRIVATE-ACTUAL",
    "PRIVATE-METRICS.csv",
    "PRIVATE-QUALITY.csv"
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }

  const changedSource = await createConformanceCheckReceipt({
    ...common,
    metricsEvidence: {
      ...common.metricsEvidence,
      sha256: "e".repeat(64)
    }
  });
  const changedCatalog = await createConformanceCheckReceipt({
    ...common,
    catalog: {
      ...CONFORMANCE_CATALOG,
      catalog_digest: `sha256:${"f".repeat(64)}`
    }
  });
  assert.notEqual(receipt.calculation_digest, changedSource.calculation_digest);
  assert.notEqual(receipt.calculation_digest, changedCatalog.calculation_digest);
});
