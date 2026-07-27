import test from "node:test";
import assert from "node:assert/strict";

import {
  runExtractAuditJob
} from "../site/js/workers/extract-auditor-job.js";

test("worker job returns only bounded results, evidence, and a downloadable blob", async () => {
  const progress = [];
  const result = await runExtractAuditJob({
    baselineFile: new Blob(["id,value\n1,A\n2,B\n"], {
      type: "text/csv"
    }),
    currentFile: new Blob(["id,value\n1,A\n2,C\n3,D\n"], {
      type: "text/csv"
    }),
    keyColumns: ["id"],
    trimWhitespace: true,
    onProgress: (update) => progress.push(update)
  });

  assert.equal(result.audit.summary.changed, 1);
  assert.equal(result.audit.summary.added, 1);
  assert.equal(result.audit.rowDiffs.length, 2);
  assert.equal(result.evidence.baseline.rowCount, 2);
  assert.match(result.evidence.baseline.sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.changeLogBlob instanceof Blob);
  assert.equal(
    Object.hasOwn(result, "baseline") || Object.hasOwn(result, "current"),
    false
  );
  assert.equal(progress.at(-1).fraction, 1);
  assert.ok(progress.some(({ phase }) => phase === "Comparing records"));
});

test("worker job rejects oversized files before reading their bytes", async () => {
  let read = false;
  const oversized = {
    size: 10 * 1024 * 1024 + 1,
    async arrayBuffer() {
      read = true;
      return new ArrayBuffer(0);
    }
  };

  await assert.rejects(
    () =>
      runExtractAuditJob({
        baselineFile: oversized,
        currentFile: new Blob(["id\n1\n"]),
        keyColumns: ["id"],
        trimWhitespace: true
      }),
    /larger than the 10 MB limit/
  );
  assert.equal(read, false);
});
