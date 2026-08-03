import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalJsonStringify,
  createCapacityPlanReceipt,
  createConformanceCheckReceipt,
  createExtractAuditReceipt,
  createReportingWindowReceipt,
  sha256Hex,
  TOOLKIT_VERSION
} from "../site/js/lib/analysis-receipt.js";
import { CONFORMANCE_CATALOG } from "../site/js/data/edge-case-contracts.js";
import { parseCsv } from "../site/js/lib/csv.js";
import { BASELINE_SAMPLE, CURRENT_SAMPLE } from "../site/js/samples.js";
import { auditExtracts } from "../site/js/tools/extract-auditor.js";
import {
  inspectAnalysisReceipt,
  recalculateReceiptDigest,
  RECEIPT_MAX_BYTES,
  ReceiptValidationError,
  validateAnalysisReceipt,
  verifyReceiptSource
} from "../site/js/tools/receipt-inspector.js";
import { buildReportingWindow } from "../site/js/tools/reporting-window.js";
import { calculateCapacityPlan } from "../site/js/tools/waitlist-planner.js";

const GENERATED_AT = "2026-07-25T12:00:00.000Z";

test("inspects and exactly replays a current reporting-window receipt", async () => {
  const receipt = await reportingWindowReceipt();
  const inspection = await inspectAnalysisReceipt(serialize(receipt));

  assert.equal(inspection.structure.status, "valid");
  assert.equal(inspection.digest.status, "match");
  assert.equal(inspection.replay.status, "match");
  assert.deepEqual(inspection.replay.differences, []);
  assert.equal(inspection.verdict, "internally-consistent");
  assert.deepEqual(inspection.source_roles, []);
  assert.deepEqual(inspection.digest.excluded_fields, [
    "$schema",
    "calculation_digest",
    "generated_at"
  ]);
});

test("replays every reporting-window period and comparison path", async () => {
  const examples = [
    {
      type: "fiscal_ytd",
      asOf: "2026-06-15",
      comparisonType: "prior_year"
    },
    {
      type: "fiscal_qtd",
      asOf: "2024-02-29",
      comparisonType: "prior_year"
    },
    {
      type: "rolling",
      asOf: "2026-06-15",
      rollingDays: 90,
      comparisonType: "previous_period"
    },
    {
      type: "custom",
      customStart: "2026-01-15",
      customEnd: "2026-03-03",
      comparisonType: "previous_period"
    }
  ];

  for (const example of examples) {
    const receipt = await reportingWindowReceipt(example);
    const inspection = await inspectAnalysisReceipt(serialize(receipt));
    assert.equal(inspection.replay.status, "match", example.type);
  }
});

test("distinguishes stale-digest alteration from recomputed self-consistent alteration", async () => {
  const stale = clone(await reportingWindowReceipt());
  stale.outputs.current_period.inclusive_days += 1;
  const staleInspection = await inspectAnalysisReceipt(serialize(stale));
  assert.equal(staleInspection.digest.status, "mismatch");
  assert.equal(staleInspection.replay.status, "mismatch");
  assert.equal(staleInspection.verdict, "inconsistent");

  const recomputed = clone(stale);
  recomputed.calculation_digest = await recalculateReceiptDigest(recomputed);
  const recomputedInspection = await inspectAnalysisReceipt(serialize(recomputed));
  assert.equal(recomputedInspection.digest.status, "match");
  assert.equal(recomputedInspection.replay.status, "mismatch");
  assert.equal(recomputedInspection.verdict, "inconsistent");
  assert.deepEqual(recomputedInspection.replay.differences[0], {
    path: "$.outputs.current_period.inclusive_days",
    recorded: "77",
    replayed: "76"
  });
});

test("validates and exactly replays normal and non-finite capacity receipts", async () => {
  const normal = await capacityReceipt({
    initialBacklog: 240,
    weeklyArrivals: 42,
    weeklyCapacity: 38,
    changeWeek: 5,
    proposedCapacity: 50,
    horizonWeeks: 26,
    targetWaitWeeks: 4
  });
  const zeroCapacity = await capacityReceipt({
    initialBacklog: 10,
    weeklyArrivals: 2,
    weeklyCapacity: 0,
    changeWeek: 1,
    proposedCapacity: 0,
    horizonWeeks: 2,
    targetWaitWeeks: 1
  });

  for (const receipt of [normal, zeroCapacity]) {
    const inspection = await inspectAnalysisReceipt(serialize(receipt));
    assert.equal(inspection.digest.status, "match");
    assert.equal(inspection.replay.status, "match");
  }
  assert.deepEqual(zeroCapacity.outputs.proposed_plan.final_wait_proxy, {
    status: "not-finite",
    weeks: null
  });
});

test("a recomputed capacity-output alteration still fails deterministic replay", async () => {
  const receipt = clone(await capacityReceipt());
  receipt.outputs.recommendation.required_whole_capacity_per_week += 1;
  receipt.calculation_digest = await recalculateReceiptDigest(receipt);

  const inspection = await inspectAnalysisReceipt(serialize(receipt));
  assert.equal(inspection.digest.status, "match");
  assert.equal(inspection.replay.status, "mismatch");
  assert.match(
    inspection.replay.differences[0].path,
    /required_whole_capacity_per_week/
  );
});

test("extract receipts validate aggregate invariants without claiming replay", async () => {
  const { receipt } = await extractReceipt();
  const inspection = await inspectAnalysisReceipt(serialize(receipt));

  assert.equal(inspection.digest.status, "match");
  assert.equal(inspection.replay.status, "not-available");
  assert.match(inspection.replay.reason, /omits key-column names/);
  assert.deepEqual(inspection.source_roles, ["baseline", "current"]);
  assert.equal(inspection.verdict, "internally-consistent");
});

test("accepts the authentic legacy v0.2/v0.3 extract receipt profile", async () => {
  const { receipt: current } = await extractReceipt();
  for (const version of ["0.2.0", "0.3.0"]) {
    const legacy = clone(current);
    legacy.toolkit_version = version;
    legacy.assumptions = legacy.assumptions.filter(
      (assumption) => assumption.id !== "key-column-names-omitted"
    );
    legacy.inputs.key_definition_digest = `sha256:${await sha256Hex(
      canonicalJsonStringify(["record_id"])
    )}`;
    legacy.calculation_digest = await recalculateReceiptDigest(legacy);

    const inspection = await inspectAnalysisReceipt(serialize(legacy));
    assert.equal(inspection.structure.status, "valid");
    assert.equal(inspection.digest.status, "match");
  }
});

test("accepts released v0.2 reporting and capacity profiles but rejects a v0.2 conformance claim", async () => {
  for (const current of [
    await reportingWindowReceipt(),
    await capacityReceipt()
  ]) {
    const historical = clone(current);
    historical.toolkit_version = "0.2.0";
    historical.calculation_digest = await recalculateReceiptDigest(historical);
    const inspection = await inspectAnalysisReceipt(serialize(historical));
    assert.equal(inspection.digest.status, "match");
    assert.equal(inspection.replay.status, "match");
  }

  const { receipt: conformance } = await conformanceReceipt();
  conformance.toolkit_version = "0.2.0";
  conformance.calculation_digest = await recalculateReceiptDigest(conformance);
  await assert.rejects(
    inspectAnalysisReceipt(serialize(conformance)),
    /did not exist in toolkit 0\.2\.0/
  );
});

test("extract profile rejects inconsistent aggregate and source metadata", async () => {
  const { receipt: original } = await extractReceipt();
  const mutations = [
    (receipt) => {
      receipt.outputs.record_summary.baseline_rows += 1;
    },
    (receipt) => {
      receipt.outputs.schema_summary.compared_column_count += 1;
    },
    (receipt) => {
      receipt.outputs.record_summary.changed_cells = 0;
    },
    (receipt) => {
      receipt.sources.reverse();
    }
  ];

  for (const mutate of mutations) {
    const receipt = clone(original);
    mutate(receipt);
    receipt.calculation_digest = await recalculateReceiptDigest(receipt);
    await assert.rejects(
      inspectAnalysisReceipt(serialize(receipt)),
      ReceiptValidationError
    );
  }
});

test("verifies exact extract source bytes without returning source content", async () => {
  const { receipt, baselineBytes, currentBytes } = await extractReceipt();
  const baseline = await verifyReceiptSource({
    receipt,
    role: "baseline",
    input: baselineBytes
  });
  const current = await verifyReceiptSource({
    receipt,
    role: "current",
    input: new Blob([currentBytes])
  });
  const wrong = await verifyReceiptSource({
    receipt,
    role: "baseline",
    input: currentBytes
  });

  assert.equal(baseline.status, "match");
  assert.equal(current.status, "match");
  assert.equal(wrong.status, "mismatch");
  assert.equal(Object.hasOwn(baseline, "input"), false);
  assert.equal(serialize(baseline).includes(BASELINE_SAMPLE), false);
  await assert.rejects(
    verifyReceiptSource({ receipt, role: "actual_metrics", input: baselineBytes }),
    /has no.*source fingerprint/
  );
});

test("conformance receipt validates catalog, summary, and source roles without replay", async () => {
  const { receipt } = await conformanceReceipt();
  const inspection = await inspectAnalysisReceipt(serialize(receipt));

  assert.equal(inspection.digest.status, "match");
  assert.equal(inspection.replay.status, "not-available");
  assert.match(inspection.replay.reason, /omits detailed expected and actual/);
  assert.deepEqual(inspection.source_roles, ["actual_metrics", "actual_quality"]);
});

test("accepts the released v0.3 conformance profile", async () => {
  const { receipt: current } = await conformanceReceipt();
  const historical = clone(current);
  historical.toolkit_version = "0.3.0";
  historical.inputs.contract_catalog = historicalEdgeCatalog();
  historical.calculation_digest = await recalculateReceiptDigest(historical);

  const inspection = await inspectAnalysisReceipt(serialize(historical));
  assert.equal(inspection.digest.status, "match");
});

test("accepts released v0.3 reporting-window and capacity profiles", async () => {
  for (const receipt of [
    await reportingWindowReceipt(),
    await capacityReceipt()
  ]) {
    receipt.toolkit_version = "0.3.0";
    receipt.calculation_digest = await recalculateReceiptDigest(receipt);
    const inspection = await inspectAnalysisReceipt(serialize(receipt));
    assert.equal(inspection.digest.status, "match", receipt.tool.id);
    assert.equal(inspection.replay.status, "match", receipt.tool.id);
  }
});

test("preserves every published v0.4 receipt profile after the v0.5 release", async () => {
  const { receipt: extract } = await extractReceipt();
  const { receipt: conformance } = await conformanceReceipt();
  conformance.inputs.contract_catalog = historicalEdgeCatalog();

  const receipts = [
    await reportingWindowReceipt(),
    extract,
    await capacityReceipt(),
    conformance
  ];
  for (const receipt of receipts) {
    receipt.toolkit_version = "0.4.0";
    receipt.calculation_digest = await recalculateReceiptDigest(receipt);
    const inspection = await inspectAnalysisReceipt(serialize(receipt));
    assert.equal(inspection.structure.status, "valid", receipt.tool.id);
    assert.equal(inspection.digest.status, "match", receipt.tool.id);
    assert.equal(
      inspection.replay.status,
      ["reporting-window", "waitlist-capacity-planner"].includes(
        receipt.tool.id
      )
        ? "match"
        : "not-available",
      receipt.tool.id
    );
  }
});

test("conformance profile rejects inconsistent counts, pass state, and catalog provenance", async () => {
  const { receipt: original } = await conformanceReceipt();
  const mutations = [
    (receipt) => {
      receipt.outputs.summary.mismatch_count = 1;
    },
    (receipt) => {
      receipt.outputs.passed = false;
    },
    (receipt) => {
      receipt.inputs.contract_catalog.catalog_digest = `sha256:${"f".repeat(64)}`;
    },
    (receipt) => {
      receipt.inputs.case_id = "not-a-case";
    }
  ];

  for (const mutate of mutations) {
    const receipt = clone(original);
    mutate(receipt);
    receipt.calculation_digest = await recalculateReceiptDigest(receipt);
    await assert.rejects(
      inspectAnalysisReceipt(serialize(receipt)),
      ReceiptValidationError
    );
  }
});

test("verifies conformance sources and enforces role-specific byte limits", async () => {
  const { receipt, metricsBytes, qualityBytes } = await conformanceReceipt();
  assert.equal(
    (
      await verifyReceiptSource({
        receipt,
        role: "actual_metrics",
        input: metricsBytes
      })
    ).status,
    "match"
  );
  assert.equal(
    (
      await verifyReceiptSource({
        receipt,
        role: "actual_quality",
        input: qualityBytes
      })
    ).status,
    "match"
  );
  await assert.rejects(
    verifyReceiptSource({
      receipt,
      role: "actual_metrics",
      input: new Uint8Array(1024 * 1024 + 1)
    }),
    /larger than the 1 MB limit/
  );
});

test("fails closed on unsupported profiles, metadata drift, and extra members", async () => {
  const original = await reportingWindowReceipt();
  const mutations = [
    (receipt) => {
      receipt.toolkit_version = "99.0.0";
    },
    (receipt) => {
      receipt.tool.name = "Similar looking tool";
    },
    (receipt) => {
      receipt.assumptions[0].statement = "Changed assumption";
    },
    (receipt) => {
      receipt.outputs.extra = true;
    },
    (receipt) => {
      receipt.generated_at = "2026-07-25T12:00:00Z";
    },
    (receipt) => {
      receipt.__proto_pollution_attempt = true;
    }
  ];

  for (const mutate of mutations) {
    const receipt = clone(original);
    mutate(receipt);
    await assert.rejects(
      inspectAnalysisReceipt(serialize(receipt)),
      ReceiptValidationError
    );
  }
});

test("rejects duplicate JSON members, invalid UTF-8, and oversized receipts before validation", async () => {
  const receipt = await reportingWindowReceipt();
  const serialized = serialize(receipt);
  const duplicate = serialized.replace(
    `"toolkit_version":"${TOOLKIT_VERSION}"`,
    `"toolkit_version":"${TOOLKIT_VERSION}","\\u0074oolkit_version":"${TOOLKIT_VERSION}"`
  );
  await assert.rejects(inspectAnalysisReceipt(duplicate), /duplicate member/);
  await assert.rejects(
    inspectAnalysisReceipt(Uint8Array.from([0xc3, 0x28])),
    /valid UTF-8/
  );
  await assert.rejects(
    inspectAnalysisReceipt(`{"padding":"${"a".repeat(RECEIPT_MAX_BYTES)}"}`),
    /larger than/
  );
});

test("documents that generated_at is structurally checked but outside calculation digest", async () => {
  const original = await reportingWindowReceipt();
  const changed = clone(original);
  changed.generated_at = "2026-07-26T12:00:00.000Z";

  assert.equal(
    await recalculateReceiptDigest(original),
    await recalculateReceiptDigest(changed)
  );
  const inspection = await inspectAnalysisReceipt(serialize(changed));
  assert.equal(inspection.digest.status, "match");
  assert.equal(inspection.replay.status, "match");
});

test("validation can be applied to an already parsed supported receipt", async () => {
  const receipt = await reportingWindowReceipt();
  assert.equal(validateAnalysisReceipt(receipt), receipt);
});

async function reportingWindowReceipt(overrides = {}) {
  const inputs = {
    type: "fiscal_ytd",
    asOf: "2026-06-15",
    fiscalStartMonth: 4,
    rollingDays: 90,
    customStart: "",
    customEnd: "",
    comparisonType: "prior_year",
    ...overrides
  };
  return createReportingWindowReceipt({
    inputs,
    result: buildReportingWindow(inputs),
    generatedAt: GENERATED_AT
  });
}

async function capacityReceipt(overrides = {}) {
  const inputs = {
    initialBacklog: 240,
    weeklyArrivals: 42,
    weeklyCapacity: 38,
    changeWeek: 5,
    proposedCapacity: 50,
    horizonWeeks: 26,
    targetWaitWeeks: 4,
    ...overrides
  };
  return createCapacityPlanReceipt({
    result: calculateCapacityPlan(inputs),
    generatedAt: GENERATED_AT
  });
}

async function extractReceipt() {
  const baselineBytes = new TextEncoder().encode(BASELINE_SAMPLE);
  const currentBytes = new TextEncoder().encode(CURRENT_SAMPLE);
  const audit = auditExtracts({
    baseline: parseCsv(BASELINE_SAMPLE),
    current: parseCsv(CURRENT_SAMPLE),
    keyColumns: ["record_id"],
    trimWhitespace: true
  });
  const receipt = await createExtractAuditReceipt({
    audit,
    baselineEvidence: {
      sha256: await sha256Hex(baselineBytes),
      byteCount: baselineBytes.byteLength,
      rowCount: 4,
      columnCount: 6
    },
    currentEvidence: {
      sha256: await sha256Hex(currentBytes),
      byteCount: currentBytes.byteLength,
      rowCount: 4,
      columnCount: 6
    },
    trimWhitespace: true,
    generatedAt: GENERATED_AT
  });
  return { receipt, baselineBytes, currentBytes };
}

async function conformanceReceipt() {
  const selectedCase = CONFORMANCE_CATALOG.cases.find(
    (candidate) => candidate.id === "unmapped-program-retention"
  );
  const metricsText = "period_id,metric_id,actual_value\nFY2026-Q1,test,1\n";
  const qualityText = "check_id,actual_value\ntest,0\n";
  const metricsBytes = new TextEncoder().encode(metricsText);
  const qualityBytes = new TextEncoder().encode(qualityText);
  const expectationCount =
    selectedCase.metrics.length + selectedCase.quality.length;
  const catalog =
    TOOLKIT_VERSION === "0.4.0"
      ? { ...CONFORMANCE_CATALOG, ...historicalEdgeCatalog() }
      : CONFORMANCE_CATALOG;
  const receipt = await createConformanceCheckReceipt({
    result: {
      caseId: selectedCase.id,
      passed: true,
      summary: {
        expectationCount,
        matched: expectationCount,
        mismatchCount: 0,
        missing: 0,
        unexpected: 0,
        value: 0
      }
    },
    catalog,
    metricsEvidence: {
      sha256: await sha256Hex(metricsBytes),
      byteCount: metricsBytes.byteLength,
      rowCount: 1,
      columnCount: 3
    },
    qualityEvidence: {
      sha256: await sha256Hex(qualityBytes),
      byteCount: qualityBytes.byteLength,
      rowCount: 1,
      columnCount: 2
    },
    generatedAt: GENERATED_AT
  });
  return { receipt, metricsBytes, qualityBytes };
}

function historicalEdgeCatalog() {
  return {
    catalog_digest:
      "sha256:e441ce7779cc30b0b539a7f201e4928cb2f8303ee5de0fd1aac1f29c17143807",
    catalog_id: "health-data-edge-cases",
    source_release:
      "https://github.com/dfrbagley-cpu/health-data-edge-cases/releases/tag/v0.2.0",
    suite_version: "0.2.0"
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function serialize(value) {
  return canonicalJsonStringify(value);
}
