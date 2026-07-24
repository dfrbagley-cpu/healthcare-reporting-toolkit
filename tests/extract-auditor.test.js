import test from "node:test";
import assert from "node:assert/strict";

import { parseCsv } from "../site/js/lib/csv.js";
import { BASELINE_SAMPLE, CURRENT_SAMPLE } from "../site/js/samples.js";
import {
  auditExtracts,
  auditRowsForCsv
} from "../site/js/tools/extract-auditor.js";

test("separates schema drift from record-level changes", () => {
  const audit = auditExtracts({
    baseline: parseCsv(BASELINE_SAMPLE),
    current: parseCsv(CURRENT_SAMPLE),
    keyColumns: ["record_id"],
    trimWhitespace: true
  });

  assert.deepEqual(audit.addedColumns, ["owner"]);
  assert.deepEqual(audit.removedColumns, ["active"]);
  assert.deepEqual(audit.summary, {
    baselineRows: 4,
    currentRows: 4,
    added: 1,
    removed: 1,
    changed: 2,
    unchanged: 1,
    changedCells: 2,
    ambiguousKeys: 0,
    missingBaselineKeys: 0,
    missingCurrentKeys: 0
  });
  assert.deepEqual(
    audit.rowDiffs
      .filter((row) => row.status === "changed")
      .map((row) => row.key),
    ["R-1001", "R-1002"]
  );
  assert.equal(auditRowsForCsv(audit).length, 4);
});

test("excludes duplicate and blank keys rather than guessing", () => {
  const baseline = parseCsv(
    "id,value\nA,1\nA,2\n,3\nB,4\n"
  );
  const current = parseCsv(
    "id,value\nA,2\nB,5\n,8\n"
  );
  const audit = auditExtracts({
    baseline,
    current,
    keyColumns: ["id"],
    trimWhitespace: true
  });

  assert.equal(audit.summary.ambiguousKeys, 1);
  assert.equal(audit.summary.missingBaselineKeys, 1);
  assert.equal(audit.summary.missingCurrentKeys, 1);
  assert.equal(audit.summary.changed, 1);
  assert.deepEqual(
    audit.rowDiffs.map((row) => row.key),
    ["B"]
  );
  assert.equal(audit.warnings.length, 2);
});

test("supports composite keys", () => {
  const baseline = parseCsv(
    "person_id,encounter_id,status\nP1,E1,open\nP1,E2,open\n"
  );
  const current = parseCsv(
    "person_id,encounter_id,status\nP1,E1,closed\nP1,E2,open\n"
  );
  const audit = auditExtracts({
    baseline,
    current,
    keyColumns: ["person_id", "encounter_id"],
    trimWhitespace: true
  });

  assert.equal(audit.summary.changed, 1);
  assert.equal(
    audit.rowDiffs.find((row) => row.status === "changed").key,
    "P1 | E1"
  );
});

test("does not mark all records changed for added schema columns", () => {
  const baseline = parseCsv("id,value\n1,A\n");
  const current = parseCsv("id,value,new_column\n1,A,new\n");
  const audit = auditExtracts({
    baseline,
    current,
    keyColumns: ["id"],
    trimWhitespace: true
  });

  assert.equal(audit.summary.unchanged, 1);
  assert.equal(audit.summary.changed, 0);
  assert.deepEqual(audit.addedColumns, ["new_column"]);
});

test("allows whitespace-sensitive comparison when requested", () => {
  const baseline = parseCsv("id,value\n1,Alpha\n");
  const current = parseCsv("id,value\n1, Alpha \n");

  const trimmed = auditExtracts({
    baseline,
    current,
    keyColumns: ["id"],
    trimWhitespace: true
  });
  const exact = auditExtracts({
    baseline,
    current,
    keyColumns: ["id"],
    trimWhitespace: false
  });

  assert.equal(trimmed.summary.unchanged, 1);
  assert.equal(exact.summary.changed, 1);
});

test("rejects missing and repeated key column names", () => {
  const extract = parseCsv("id,value\n1,A\n");
  assert.throws(
    () =>
      auditExtracts({
        baseline: extract,
        current: extract,
        keyColumns: ["missing"],
        trimWhitespace: true
      }),
    /must exist/
  );
  assert.throws(
    () =>
      auditExtracts({
        baseline: extract,
        current: extract,
        keyColumns: ["id", "id"],
        trimWhitespace: true
      }),
    /must be unique/
  );
});
