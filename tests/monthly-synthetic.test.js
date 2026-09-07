import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseCsvRows } from "../site/js/lib/csv.js";
import { checkReport } from "../site/js/tools/report-check.js";
import { syntheticDatabase, SYNTHETIC_PROFILE, SYNTHETIC_RUN, SYNTHETIC_EXPECTED } from "../site/js/data/monthly-synthetic.js";

test("full synthetic snapshots match independently specified counts and retain composite IDs", () => {
  const { files } = syntheticDatabase();
  const baseline = parseCsvRows(files["baseline.csv"].text), current = parseCsvRows(files["current.csv"].text);
  const result = checkReport({ baseline, current, profile: SYNTHETIC_PROFILE,
    run: { ...SYNTHETIC_RUN, baseline_complete: true, current_complete: true } });
  assert.equal(baseline.rows.length, 1000); assert.equal(current.rows.length, 1000);
  assert.equal(result.status, "complete");
  const r = result.reconciliation, expected = SYNTHETIC_EXPECTED;
  assert.equal(r.baseline, expected.baseline_eligible); assert.equal(r.current, expected.current_eligible);
  for (const k of ["added", "removed", "became_eligible", "became_ineligible", "delta", "unexplained"]) assert.equal(r[k], expected[k], k);
  assert.equal(new Set(baseline.rows.map((r) => r[1])).size < 1000, true);
  assert.equal(new Set(baseline.rows.map((r) => JSON.stringify(r.slice(0, 2)))).size, 1000);
  assert.equal(parseCsvRows(files["patients.csv"].text).rows.length, 250);
  assert.equal(parseCsvRows(files["encounter-versions.csv"].text).rows.length, 1070);
});
test("downloaded duplicate-key snapshot blocks reconciliation and generation is deterministic", () => {
  const database = syntheticDatabase(); assert.deepEqual(database, syntheticDatabase());
  const result = checkReport({ baseline: parseCsvRows(database.files["baseline.csv"].text),
    current: parseCsvRows(database.files["current-duplicate.csv"].text), profile: SYNTHETIC_PROFILE,
    run: { ...SYNTHETIC_RUN, baseline_complete: true, current_complete: true } });
  assert.equal(result.status, "blocked"); assert.equal(result.reconciliation, null);
});
test("complete database SQL reproduces both CSV snapshots and valid reference links", () => {
  const { files } = syntheticDatabase();
  const result = spawnSync("python3", ["-c", `
import sys,json,sqlite3,csv,io
data=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript(data['sql'])
for side in ['baseline','current']:
    rows=list(csv.reader(io.StringIO(data[side])))
    assert sorted(rows[1:]) == sorted([list(r) for r in db.execute('SELECT * FROM '+side)])
assert db.execute('SELECT count(*) FROM patients').fetchone()[0] == 250
for name,column in [('patients','patient_id'),('sites','site'),('programs','program')]:
    query='SELECT count(*) FROM encounter_versions e LEFT JOIN '+name+' r ON e.'+column+'=r.'+column+' WHERE r.'+column+' IS NULL'
    assert db.execute(query).fetchone()[0] == 0
print('database and CSV snapshots agree')
`], { input: JSON.stringify({ sql: files["synthetic-database.sql"].text,
    baseline: files["baseline.csv"].text, current: files["current.csv"].text }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
