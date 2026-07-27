import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  parseCsvRows,
  stringifyCsv
} from "../site/js/lib/csv.js";
import { BASELINE_SAMPLE, CURRENT_SAMPLE } from "../site/js/samples.js";
import {
  auditExtractTables,
  auditExtracts,
  auditRowsForCsv
} from "../site/js/tools/extract-auditor.js";
import {
  parseExtractKeyColumns
} from "../site/js/tools/extract-auditor-limits.js";

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
    '["P1","E1"]'
  );
});

test("renders composite keys without collapsing distinct key parts", async () => {
  const baselineText =
    "part_a,part_b,value\n" +
    "a | b,c,before-1\n" +
    "a,b | c,before-2\n";
  const currentText =
    "part_a,part_b,value\n" +
    "a | b,c,after-1\n" +
    "a,b | c,after-2\n";
  const full = auditExtracts({
    baseline: parseCsv(baselineText),
    current: parseCsv(currentText),
    keyColumns: ["part_a", "part_b"]
  });
  const bounded = auditExtractTables({
    baseline: parseCsvRows(baselineText),
    current: parseCsvRows(currentText),
    keyColumns: ["part_a", "part_b"]
  });
  const expectedKeys = new Set([
    '["a | b","c"]',
    '["a","b | c"]'
  ]);

  assert.deepEqual(
    new Set(full.rowDiffs.map((difference) => difference.key)),
    expectedKeys
  );
  assert.deepEqual(
    new Set(bounded.audit.rowDiffs.map((difference) => difference.key)),
    expectedKeys
  );
  const changeLog = parseCsv(await bounded.changeLogBlob.text());
  assert.deepEqual(
    new Set(changeLog.records.map((record) => record.key)),
    expectedKeys
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

test("bounds key-column configuration before comparison", () => {
  assert.deepEqual(
    parseExtractKeyColumns("person_id, encounter_id"),
    ["person_id", " encounter_id"]
  );
  assert.throws(
    () => parseExtractKeyColumns("x".repeat(10_001)),
    /longer than 10,000 characters/
  );
  assert.throws(
    () =>
      parseExtractKeyColumns(
        Array.from({ length: 201 }, (_, index) => `key_${index}`).join(",")
      ),
    /no more than 200 key columns/
  );
  assert.throws(
    () =>
      auditExtractTables({
        baseline: parseCsvRows("id\n1\n"),
        current: parseCsvRows("id\n1\n"),
        keyColumns: Array.from(
          { length: 201 },
          (_, index) => `key_${index}`
        )
      }),
    /no more than 200 key columns/
  );
});

test("bounded worker audit matches the existing result without retaining unchanged rows", async () => {
  const full = auditExtracts({
    baseline: parseCsv(BASELINE_SAMPLE),
    current: parseCsv(CURRENT_SAMPLE),
    keyColumns: ["record_id"],
    trimWhitespace: true
  });
  const bounded = auditExtractTables({
    baseline: parseCsvRows(BASELINE_SAMPLE),
    current: parseCsvRows(CURRENT_SAMPLE),
    keyColumns: ["record_id"],
    trimWhitespace: true
  });

  assert.deepEqual(bounded.audit.summary, full.summary);
  assert.deepEqual(bounded.audit.addedColumns, full.addedColumns);
  assert.deepEqual(bounded.audit.removedColumns, full.removedColumns);
  assert.deepEqual(bounded.audit.typeChanges, full.typeChanges);
  assert.equal(bounded.audit.materialDifferenceCount, 4);
  assert.equal(
    bounded.audit.rowDiffs.some((row) => row.status === "unchanged"),
    false
  );
  assert.equal(bounded.audit.changeLog.available, true);
  assert.equal(
    await bounded.changeLogBlob.text(),
    stringifyCsv(auditRowsForCsv(full), [
      "key",
      "status",
      "column",
      "before",
      "after"
    ])
  );
});

test("bounded audit caps the preview while preserving complete aggregate counts", () => {
  const baselineRows = ["id,value"];
  const currentRows = ["id,value"];
  for (let index = 0; index < 150; index += 1) {
    baselineRows.push(`${String(index).padStart(3, "0")},before`);
    currentRows.push(`${String(index).padStart(3, "0")},after`);
  }
  const result = auditExtractTables({
    baseline: parseCsvRows(`${baselineRows.join("\n")}\n`),
    current: parseCsvRows(`${currentRows.join("\n")}\n`),
    keyColumns: ["id"],
    previewLimit: 100
  });

  assert.equal(result.audit.summary.changed, 150);
  assert.equal(result.audit.summary.changedCells, 150);
  assert.equal(result.audit.materialDifferenceCount, 150);
  assert.equal(result.audit.rowDiffs.length, 100);
  assert.equal(result.audit.rowDiffs[0].key, "000");
  assert.equal(result.audit.rowDiffs.at(-1).key, "099");
});

test("bounded audit protects formula prefixes in the generated change log", async () => {
  const result = auditExtractTables({
    baseline: parseCsvRows("id,value\n=ROW,=BEFORE\n"),
    current: parseCsvRows("id,value\n=ROW,+AFTER\n"),
    keyColumns: ["id"]
  });
  const csv = await result.changeLogBlob.text();

  assert.match(csv, /'=ROW/);
  assert.match(csv, /'=BEFORE/);
  assert.match(csv, /'\+AFTER/);
});

test("output limits disable the complete change log without truncating aggregate results", () => {
  const result = auditExtractTables({
    baseline: parseCsvRows("id,value\n1,A\n2,A\n3,A\n"),
    current: parseCsvRows("id,value\n1,B\n2,B\n3,B\n"),
    keyColumns: ["id"],
    changeLogMaxRows: 2
  });

  assert.equal(result.audit.summary.changed, 3);
  assert.equal(result.audit.summary.changedCells, 3);
  assert.equal(result.audit.changeLog.rowCount, 3);
  assert.equal(result.audit.changeLog.available, false);
  assert.equal(result.changeLogBlob, null);
  assert.match(result.audit.changeLog.reason, /complete change log exceeds/);
  assert.equal(result.audit.changeLog.reason.includes("1"), false);
});

test("byte limits refuse rather than publish a partial change log", () => {
  const result = auditExtractTables({
    baseline: parseCsvRows(`id,value\nsafe,${"A".repeat(200)}\n`),
    current: parseCsvRows(`id,value\nsafe,${"B".repeat(200)}\n`),
    keyColumns: ["id"],
    changeLogMaxBytes: 64
  });

  assert.equal(result.audit.summary.changed, 1);
  assert.equal(result.audit.changeLog.available, false);
  assert.equal(result.changeLogBlob, null);
  assert.match(result.audit.changeLog.reason, /download safety limit/);
});
