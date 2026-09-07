import { stringifyCsvLine } from "../lib/csv.js";
import { EXAMPLE_PROFILE, EXAMPLE_RUN } from "../tools/report-check.js";

// Independently invented records. No source dataset, employer schema, or patient data.
export const DATASET_ID = "monthly-clinics-1.0.0";
export const SYNTHETIC_PROFILE = { ...EXAMPLE_PROFILE, name: "Synthetic clinic database",
  required: ["program", "patient_id"],
  allowed: [{ column: "status", values: ["completed", "cancelled"] },
    { column: "program", values: ["A", "B", "C"] }, { column: "site", values: ["N", "S", "W"] }] };
export const SYNTHETIC_RUN = { ...EXAMPLE_RUN, baseline_complete: false, current_complete: false };
export const SYNTHETIC_EXPECTED = Object.freeze({ baseline_rows: 1000, current_rows: 1000,
  baseline_eligible: 800, current_eligible: 794, added: 16, removed: -16,
  became_eligible: 10, became_ineligible: -16, delta: -6, unexplained: 0 });
const headers = ["site", "event_id", "patient_id", "program", "referred_on", "service_on", "status", "duration_minutes", "version", "known_on"];
const csv = (columns, rows) => [stringifyCsvLine(columns), ...rows.map((row) => stringifyCsvLine(row))].join("\r\n") + "\r\n";
const key = (row) => JSON.stringify(row.slice(0, 2));
function encounter(i) {
  const day = 1 + ((i - 1) % 28), date = (n) => `2026-08-${String(n).padStart(2, "0")}`;
  return [["N", "S", "W"][(i - 1) % 3], String(Math.floor((i - 1) / 3) + 1).padStart(5, "0"),
    `SYN-P${String(1 + ((i - 1) % 250)).padStart(4, "0")}`, ["A", "B", "C"][(i - 1) % 3],
    date(Math.max(1, day - 3)), date(day), i % 5 ? "completed" : "cancelled", String(30 * (1 + (i % 3))),
    "1", i <= 1000 ? "2026-09-01" : "2026-09-07"];
}
function sqlTable(name, columns, rows) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  return `CREATE TABLE ${name} (${columns.map((c) => `${c} TEXT NOT NULL`).join(",")});\n` +
    rows.map((row) => `INSERT INTO ${name} VALUES (${row.map(quote).join(",")});`).join("\n") + "\n";
}
export function syntheticDatabase() {
  const baseline = Array.from({ length: 1000 }, (_, i) => encounter(i + 1));
  const versions = baseline.map((row) => [...row, "0"]);
  const current = new Map(baseline.map((row) => [key(row), row]));
  for (let i = 1; i <= 40; i++) {
    const row = [...baseline[i - 1]]; row[8] = "2"; row[9] = "2026-09-07";
    if (i <= 20) current.delete(key(row)); else { row[6] = "cancelled"; current.set(key(row), row); }
    versions.push([...row, i <= 20 ? "1" : "0"]);
  }
  for (let i = 45; i <= 90; i += 5) {
    const row = [...baseline[i - 1]]; row[6] = "completed"; row[8] = "2"; row[9] = "2026-09-07";
    current.set(key(row), row); versions.push([...row, "0"]);
  }
  for (let i = 1001; i <= 1020; i++) { const row = encounter(i); current.set(key(row), row); versions.push([...row, "0"]); }
  const currentRows = [...current.values()];
  const patients = Array.from({ length: 250 }, (_, i) => [`SYN-P${String(i + 1).padStart(4, "0")}`, ["18–39", "40–64", "65+"][i % 3]]);
  const sites = [["N", "Synthetic North Clinic"], ["S", "Synthetic South Clinic"], ["W", "Synthetic West Clinic"]];
  const programs = [["A", "Synthetic Program A"], ["B", "Synthetic Program B"], ["C", "Synthetic Program C"]];
  let sql = "-- Original synthetic teaching database. SQLite-compatible SQL; all dates use day granularity.\nBEGIN TRANSACTION;\n";
  sql += sqlTable("patients", ["patient_id", "age_band"], patients);
  sql += sqlTable("sites", ["site", "site_name"], sites);
  sql += sqlTable("programs", ["program", "program_name"], programs);
  sql += sqlTable("encounter_versions", [...headers, "deleted"], versions);
  sql += "CREATE UNIQUE INDEX event_version_identity ON encounter_versions(site,event_id,version);\n";
  for (const [name, cutoff] of [["baseline", "2026-09-01"], ["current", "2026-09-07"]]) {
    sql += `CREATE VIEW ${name} AS WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY site,event_id ORDER BY CAST(version AS INTEGER) DESC) AS version_rank FROM encounter_versions WHERE known_on <= '${cutoff}') SELECT ${headers.join(",")} FROM ranked WHERE version_rank=1 AND deleted='0';\n`;
  }
  sql += "COMMIT;\n";
  const dictionary = [
    ["site", "Clinic code; combine with event_id for record identity"],
    ["event_id", "Event identifier within a site; preserve leading zeros"],
    ["patient_id", "Invented patient token; joins patients table"],
    ["program", "Local synthetic program code; joins programs table"],
    ["referred_on", "Referral start, YYYY-MM-DD; on or before service"],
    ["service_on", "Service date, YYYY-MM-DD; all example events belong to August 2026"],
    ["status", "completed is eligible; cancelled is ineligible"],
    ["duration_minutes", "Invented planned duration; not used in eligible event count"],
    ["version", "Increasing version within site/event_id"],
    ["known_on", "Date the version became known; included on cutoff day"],
    ["deleted", "Database history only: 1 removes an event from later snapshots"],
    ["age_band", "Invented patient age category; supporting table only"]
  ];
  const files = {
    "baseline.csv": { label: "Baseline — September 1 (1,000 rows)", role: "baseline", type: "text/csv", text: csv(headers, baseline) },
    "current.csv": { label: "Current — September 7 (1,000 rows)", role: "current", type: "text/csv", text: csv(headers, currentRows) },
    "current-duplicate.csv": { label: "Current — duplicate key (1,001 rows)", role: "current", type: "text/csv", text: csv(headers, [...currentRows, currentRows[0]]) },
    "patients.csv": { label: "250 invented patient records", type: "text/csv", text: csv(["patient_id", "age_band"], patients) },
    "sites.csv": { label: "Three synthetic sites", type: "text/csv", text: csv(["site", "site_name"], sites) },
    "programs.csv": { label: "Three synthetic programs", type: "text/csv", text: csv(["program", "program_name"], programs) },
    "encounter-versions.csv": { label: "1,070 historical event versions", type: "text/csv", text: csv([...headers, "deleted"], versions) },
    "synthetic-database.sql": { label: "Complete database with snapshot views", type: "application/sql", text: sql },
    "data-dictionary.csv": { label: "Column definitions", type: "text/csv", text: csv(["column", "definition"], dictionary) },
    "report-profile.json": { label: "Monthly check settings", type: "application/json", text: JSON.stringify(SYNTHETIC_PROFILE, null, 2) + "\n" },
    "expected-results.json": { label: "Independently specified expected counts", type: "application/json", text: JSON.stringify({ dataset_id: DATASET_ID, ...SYNTHETIC_EXPECTED }, null, 2) + "\n" }
  };
  return { id: DATASET_ID, files };
}
