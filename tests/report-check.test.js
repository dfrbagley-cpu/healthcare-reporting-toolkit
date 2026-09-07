import test from "node:test";
import assert from "node:assert/strict";
import { parseCsvRows } from "../site/js/lib/csv.js";
import { checkReport, parseProfile, validateProfile, isoDate, EXAMPLE_PROFILE, EXAMPLE_RUN, EXAMPLE_BASELINE, EXAMPLE_CURRENT } from "../site/js/tools/report-check.js";
const inputs = () => ({ baseline: parseCsvRows(EXAMPLE_BASELINE), current: parseCsvRows(EXAMPLE_CURRENT), profile: structuredClone(EXAMPLE_PROFILE), run: structuredClone(EXAMPLE_RUN) });

test("same row counts reconcile different eligible counts with mutually exclusive contributions", () => {
  const r = checkReport(inputs());
  assert.equal(r.status, "complete");
  assert.deepEqual([r.reconciliation.baseline, r.reconciliation.current, r.reconciliation.delta, r.reconciliation.unexplained], [3, 2, -1, 0]);
  assert.deepEqual([r.reconciliation.added, r.reconciliation.removed, r.reconciliation.became_eligible, r.reconciliation.became_ineligible], [0, -1, 1, -1]);
  assert.equal(r.reconciliation.contributions.length, 3);
  assert.equal(new Set(r.reconciliation.contributions.map((r) => r.key)).size, 3);
});
test("profile round-trip and repeated runs preserve results", () => {
  const data = inputs(); const first = checkReport(data);
  data.profile = parseProfile(JSON.stringify(data.profile));
  assert.deepEqual(checkReport(data), first);
  data.current = data.baseline;
  assert.equal(checkReport(data).reconciliation.delta, 0);
  assert.equal(checkReport(data).reconciliation.contributions.length, 0);
});
test("leading zeros and composite identities remain distinct", () => {
  const data = inputs();
  data.current.rows.push(["N", "1", "A", "2026-08-01", "2026-08-02", "completed"]);
  const r = checkReport(data); assert.equal(r.status, "complete"); assert.equal(r.reconciliation.added, 1);
});
for (const side of ["baseline", "current"]) {
  test(`${side} duplicates block the whole reconciliation`, () => {
    const data = inputs(); data[side].rows.push([...data[side].rows[0]]);
    const r = checkReport(data); assert.equal(r.status, "blocked"); assert.equal(r.reconciliation, null);
  });
  test(`${side} unconfirmed coverage blocks the reconciliation`, () => {
    const data = inputs(); data.run[`${side}_complete`] = false;
    assert.equal(checkReport(data).status, "blocked");
  });
}
test("blank keys, unknown codes, impossible dates, and impossible chronology fail closed", () => {
  for (const [index, value] of [[1, " "], [2, "UNKNOWN"], [4, "2026-02-30"], [4, "2026-07-31"], [5, ""]]) {
    const data = inputs(); data.current.rows[0][index] = value;
    assert.equal(checkReport(data).status, "blocked", `${index}: ${value}`);
  }
});
test("schema omissions and empty extracts cannot pass", () => {
  let data = inputs(); data.current.headers[2] = "renamed";
  let r = checkReport(data); assert.equal(r.status, "blocked"); assert.equal(r.checks.current.checkedRows, 0);
  data = inputs(); data.current.rows = [];
  assert.equal(checkReport(data).status, "blocked");
});
test("explicit mappings restore comparison; collisions and missing sources are rejected", () => {
  const data = inputs(); data.current.headers[1] = "new_id";
  data.profile.mappings.current = [{ from: "new_id", to: "event_id" }];
  assert.equal(checkReport(data).status, "complete");
  data.profile.mappings.current[0].to = "site";
  assert.throws(() => checkReport(data), /duplicate/);
  data.profile.mappings.current = [{ from: "missing", to: "event_id" }];
  assert.throws(() => checkReport(data), /missing/);
});
test("inclusive service boundaries and date corrections have exact count contributions", () => {
  const data = inputs(); data.current = structuredClone(data.baseline);
  data.current.rows[0][4] = "2026-08-31";
  assert.equal(checkReport(data).reconciliation.delta, 0);
  data.current.rows[0][4] = "2026-09-01";
  assert.equal(checkReport(data).reconciliation.became_ineligible, -1);
});
test("open chronology ends are separate from required service dates", () => {
  const data = inputs(); data.profile.chronology = [{ start: "referred_on", end: "closed_on", allow_open: true }];
  for (const side of ["baseline", "current"]) { data[side].headers.push("closed_on"); data[side].rows.forEach((r) => r.push("")); }
  assert.equal(checkReport(data).status, "complete");
  data.profile.chronology[0].allow_open = false;
  assert.equal(checkReport(data).status, "blocked");
});
test("profile imports reject unknown code-bearing fields, duplicate JSON keys, unsupported versions and excessive size", () => {
  const p = structuredClone(EXAMPLE_PROFILE); p.script = "ignored";
  assert.throws(() => validateProfile(p), /fields/);
  assert.throws(() => parseProfile('{"name":"a","name":"b"}'));
  assert.throws(() => parseProfile(JSON.stringify({ ...EXAMPLE_PROFILE, schema_version: "2.0.0" })), /version/);
  assert.throws(() => parseProfile(" ".repeat(65537)), /limit/);
});
test("dates and incomplete extraction chronology are checked", () => {
  assert.equal(isoDate("2026-02-29"), false); assert.equal(isoDate("2024-02-29"), true);
  const data = inputs(); data.run.baseline_extracted = "2026-08-20";
  assert.throws(() => checkReport(data), /predate/);
  data.run.baseline_complete = false;
  assert.equal(checkReport(data).status, "blocked");
});
test("explicit whitespace option changes matching without numeric coercion", () => {
  const data = inputs(); data.current = structuredClone(data.baseline); data.current.rows[0][1] = " 001 ";
  assert.equal(checkReport(data).reconciliation.contributions.length, 0);
  data.profile.trim_whitespace = false;
  const r = checkReport(data).reconciliation; assert.equal(r.added, 1); assert.equal(r.removed, -1);
});
