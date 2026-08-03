import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CONFORMANCE_CATALOG } from "../site/js/data/edge-case-contracts.js";
import { stringifyCsv } from "../site/js/lib/csv.js";
import {
  compareConformanceResults,
  diagnosticsForCsv,
  failingExampleForCase,
  matchingExampleForCase,
  parseActualResults
} from "../site/js/tools/conformance-checker.js";

test("vendored catalog provenance and digest match the generated module", () => {
  const catalog = JSON.parse(
    readFileSync(
      new URL("../site/contracts/catalog-v1.json", import.meta.url),
      "utf8"
    )
  );
  assert.deepEqual(CONFORMANCE_CATALOG, catalog);
  assert.equal(catalog.schema_version, "1.0.0");
  assert.equal(catalog.catalog_id, "health-data-edge-cases");
  assert.equal(catalog.suite_version, "0.4.0");
  assert.equal(
    catalog.source_release,
    "https://github.com/dfrbagley-cpu/health-data-edge-cases/releases/tag/v0.4.0"
  );
  assert.deepEqual(catalog.external_results.metrics.columns, [
    "period_id",
    "metric_id",
    "actual_value"
  ]);
  assert.deepEqual(catalog.external_results.quality.columns, [
    "check_id",
    "actual_value"
  ]);

  const { catalog_digest: claimedDigest, ...payload } = catalog;
  const actualDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(sortValue(payload)), "utf8")
    .digest("hex")}`;
  assert.equal(actualDigest, claimedDigest);
});

test("matching examples pass every bundled case", () => {
  let expectationCount = 0;
  for (const edgeCase of CONFORMANCE_CATALOG.cases) {
    const example = matchingExampleForCase(
      CONFORMANCE_CATALOG,
      edgeCase.id
    );
    const result = compareConformanceResults({
      catalog: CONFORMANCE_CATALOG,
      caseId: edgeCase.id,
      metrics: parseActualResults(example.metricsCsv, "metrics"),
      quality: parseActualResults(example.qualityCsv, "quality")
    });
    assert.equal(result.passed, true, edgeCase.id);
    assert.equal(result.summary.mismatchCount, 0, edgeCase.id);
    assert.equal(
      result.summary.expectationCount,
      edgeCase.metrics.length + edgeCase.quality.length,
      edgeCase.id
    );
    expectationCount += result.summary.expectationCount;
  }
  assert.equal(expectationCount, 72);
});

test("deliberate examples produce one deterministic wrong-value diagnostic", () => {
  for (const edgeCase of CONFORMANCE_CATALOG.cases) {
    const example = failingExampleForCase(
      CONFORMANCE_CATALOG,
      edgeCase.id
    );
    const result = compareConformanceResults({
      catalog: CONFORMANCE_CATALOG,
      caseId: edgeCase.id,
      metrics: parseActualResults(example.metricsCsv, "metrics"),
      quality: parseActualResults(example.qualityCsv, "quality")
    });
    assert.equal(result.passed, false, edgeCase.id);
    assert.equal(result.summary.value, 1, edgeCase.id);
    assert.equal(result.summary.missing, 0, edgeCase.id);
    assert.equal(result.summary.unexpected, 0, edgeCase.id);
    assert.equal(result.diagnostics[0].kind, "value", edgeCase.id);
  }
});

test("missing and unexpected keys are separate, deterministic mismatches", () => {
  const edgeCase = CONFORMANCE_CATALOG.cases[0];
  const example = matchingExampleForCase(CONFORMANCE_CATALOG, edgeCase.id);
  const metrics = parseActualResults(example.metricsCsv, "metrics");
  const quality = parseActualResults(example.qualityCsv, "quality");
  metrics.rows.shift();
  metrics.rows.push({
    key: ["=PRIVATE-PERIOD", "@PRIVATE-METRIC"],
    value: "7"
  });

  const result = compareConformanceResults({
    catalog: CONFORMANCE_CATALOG,
    caseId: edgeCase.id,
    metrics,
    quality
  });
  assert.equal(result.summary.missing, 1);
  assert.equal(result.summary.unexpected, 1);
  assert.equal(result.summary.value, 0);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.kind),
    ["missing", "unexpected"]
  );

  const exported = stringifyCsv(diagnosticsForCsv(result), [
    "result_type",
    "period_id",
    "result_id",
    "status",
    "expected_value",
    "actual_value"
  ]);
  assert.match(exported, /'=PRIVATE-PERIOD/);
  assert.match(exported, /'@PRIVATE-METRIC/);
});

test("external CSV contract fails closed on headers, rows, keys, and values", () => {
  for (const [label, csv, pattern] of [
    [
      "wrong header order",
      "metric_id,period_id,actual_value\nm,p,1\n",
      /exactly these columns in this order/
    ],
    [
      "surrounding header whitespace",
      " period_id,metric_id,actual_value\np,m,1\n",
      /exactly these columns in this order/
    ],
    [
      "ragged row",
      "period_id,metric_id,actual_value\np,m\n",
      /fewer values/
    ],
    [
      "blank key",
      "period_id,metric_id,actual_value\np, ,1\n",
      /blank metric_id/
    ],
    [
      "duplicate key",
      "period_id,metric_id,actual_value\np,m,1\np,m,2\n",
      /duplicate result key/
    ],
    [
      "fraction",
      "period_id,metric_id,actual_value\np,m,1.0\n",
      /without decimals or exponents/
    ],
    [
      "exponent",
      "period_id,metric_id,actual_value\np,m,1e3\n",
      /without decimals or exponents/
    ],
    [
      "NaN",
      "period_id,metric_id,actual_value\np,m,NaN\n",
      /without decimals or exponents/
    ],
    [
      "infinity",
      "period_id,metric_id,actual_value\np,m,Infinity\n",
      /without decimals or exponents/
    ]
  ]) {
    assert.throws(
      () => parseActualResults(csv, "metrics"),
      pattern,
      label
    );
  }

  const huge = parseActualResults(
    "period_id,metric_id,actual_value\np,m,+000123456789012345678901234567890\n",
    "metrics"
  );
  assert.equal(huge.rows[0].value, "123456789012345678901234567890");
});

test("composite keys are collision-safe and inputs are not mutated", () => {
  const catalog = {
    cases: [
      {
        id: "collision-test",
        title: "Collision-safe composite result keys",
        principle: "Composite keys remain separate ordered values.",
        naive_failure: "Joining key parts with display punctuation can collide.",
        expected_resolution: "Use a structured tuple for every result key.",
        synthetic_data_only: true,
        metrics: [
          {
            period_id: "A / B",
            metric_id: "C",
            expected_value: 1
          },
          {
            period_id: "A",
            metric_id: "B / C",
            expected_value: 2
          }
        ],
        quality: [{ check_id: "q", expected_value: 0 }]
      }
    ]
  };
  const metrics = parseActualResults(
    "period_id,metric_id,actual_value\nA / B,C,1\nA,B / C,2\n",
    "metrics"
  );
  const quality = parseActualResults(
    "check_id,actual_value\nq,0\n",
    "quality"
  );
  const before = structuredClone({ metrics, quality });
  const result = compareConformanceResults({
    catalog,
    caseId: "collision-test",
    metrics,
    quality
  });
  assert.equal(result.passed, true);
  assert.deepEqual({ metrics, quality }, before);
});

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])])
    );
  }
  return value;
}
