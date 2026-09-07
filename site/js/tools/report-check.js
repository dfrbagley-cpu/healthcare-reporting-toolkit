import { parseStrictJson } from "../lib/strict-json.js";

export const PROFILE_VERSION = "1.0.0";
const badNames = new Set(["__proto__", "prototype", "constructor"]);
const fail = (message) => { throw new Error(message); };
function object(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(value, key))) fail(`Invalid ${label} fields.`);
}
function text(value) {
  if (typeof value !== "string" || value.length > 256 || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || badNames.has(value)) fail("Use non-empty names or values of at most 256 characters without surrounding whitespace or control characters.");
}
function list(value, label, allowEmpty = true) {
  if (!Array.isArray(value) || value.length > 200 || (!allowEmpty && !value.length)) fail(`Invalid ${label}.`);
  value.forEach(text);
  if (new Set(value).size !== value.length) fail(`Duplicate ${label}.`);
}
export function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function validateProfile(p) {
  object(p, ["schema_version", "name", "keys", "required", "mappings", "allowed", "chronology", "trim_whitespace", "measure"], "profile");
  if (p.schema_version !== PROFILE_VERSION) fail("Unsupported profile version. Use a 1.0.0 profile.");
  text(p.name); list(p.keys, "keys", false); list(p.required, "required columns");
  if (typeof p.trim_whitespace !== "boolean") fail("Whitespace setting must be true or false.");
  object(p.mappings, ["baseline", "current"], "column mappings");
  for (const mappings of Object.values(p.mappings)) {
    if (!Array.isArray(mappings) || mappings.length > 200) fail("Invalid column mappings.");
    for (const mapping of mappings) {
      object(mapping, ["from", "to"], "column mapping"); text(mapping.from); text(mapping.to);
    }
    list(mappings.map((m) => m.from), "mapping sources");
    list(mappings.map((m) => m.to), "mapping destinations");
  }
  if (!Array.isArray(p.allowed) || p.allowed.length > 20) fail("Use at most 20 allowed-value rules.");
  for (const rule of p.allowed) {
    object(rule, ["column", "values"], "allowed-value rule"); text(rule.column); list(rule.values, "allowed values", false);
  }
  if (!Array.isArray(p.chronology) || p.chronology.length > 20) fail("Use at most 20 chronology rules.");
  for (const rule of p.chronology) {
    object(rule, ["start", "end", "allow_open"], "chronology rule"); text(rule.start); text(rule.end);
    if (typeof rule.allow_open !== "boolean") fail("Open-end setting must be true or false.");
  }
  object(p.measure, ["date_column", "status_column", "eligible_values"], "measure");
  text(p.measure.date_column); text(p.measure.status_column); list(p.measure.eligible_values, "eligible values", false);
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 64 * 1024) fail("Profile exceeds the 64 KB limit.");
  return p;
}
export function parseProfile(value) {
  return validateProfile(parseStrictJson(value, { maxBytes: 64 * 1024 }));
}
export function validateRun(run) {
  object(run, ["start", "end", "baseline_extracted", "current_extracted", "baseline_complete", "current_complete"], "run");
  for (const key of ["start", "end", "baseline_extracted", "current_extracted"]) if (!isoDate(run[key])) fail("Use valid YYYY-MM-DD dates for the period and extraction dates.");
  if (run.start > run.end) fail("Period start must be on or before its end.");
  if (run.baseline_extracted > run.current_extracted) fail("Current extraction date must be on or after the baseline extraction date.");
  for (const side of ["baseline", "current"]) {
    if (typeof run[`${side}_complete`] !== "boolean") fail("Confirm coverage for both extracts.");
    if (run[`${side}_complete`] && run[`${side}_extracted`] < run.end) fail("A complete extract cannot predate the reporting period end.");
  }
}
function mappedTable(table, mappings) {
  for (const { from } of mappings) if (!table.headers.includes(from)) fail(`Mapped source column is missing: ${from}`);
  const rename = new Map(mappings.map(({ from, to }) => [from, to]));
  const headers = table.headers.map((header) => rename.get(header) ?? header);
  if (new Set(headers).size !== headers.length) fail("Column mapping creates duplicate destinations.");
  return { headers, rows: table.rows };
}
function preflight(table, p) {
  const columns = new Map(table.headers.map((h, i) => [h, i]));
  const needed = new Set([...p.keys, ...p.required, p.measure.date_column, p.measure.status_column,
    ...p.allowed.map((r) => r.column), ...p.chronology.flatMap((r) => [r.start, r.end])]);
  const missing = [...needed].filter((h) => !columns.has(h));
  const checks = [];
  const add = (name, checked, failed, blocked = false) => checks.push({ name, checked, failed,
    status: blocked ? "blocked" : failed ? "failed" : "passed" });
  add("Required schema", table.headers.length, missing.length);
  if (missing.length) {
    add("Row checks", 0, 0, true);
    return { checks, missing, complete: false, totalRows: table.rows.length, checkedRows: 0, entries: new Map() };
  }
  const norm = (v) => p.trim_whitespace ? v.trim() : v;
  const value = (row, name) => norm(row[columns.get(name)] ?? "");
  const groups = new Map(); let blank = 0;
  for (const row of table.rows) {
    const parts = p.keys.map((key) => value(row, key));
    if (parts.some((part) => part.trim() === "")) { blank++; continue; }
    const key = JSON.stringify(parts);
    const group = groups.get(key) ?? { row, count: 0 }; group.count++; groups.set(key, group);
  }
  add("Non-empty extract", table.rows.length, table.rows.length ? 0 : 1);
  add("Non-blank record keys", table.rows.length, blank);
  add("Unique record keys", table.rows.length, [...groups.values()].reduce((n, g) => n + (g.count > 1 ? g.count : 0), 0));
  for (const name of p.required) add(`Required value: ${name}`, table.rows.length, table.rows.filter((row) => value(row, name).trim() === "").length);
  add("Valid service dates", table.rows.length, table.rows.filter((row) => !isoDate(value(row, p.measure.date_column))).length);
  add("Non-blank status", table.rows.length, table.rows.filter((row) => value(row, p.measure.status_column).trim() === "").length);
  for (const rule of p.allowed) add(`Allowed values: ${rule.column}`, table.rows.length, table.rows.filter((row) => !rule.values.includes(value(row, rule.column))).length);
  for (const rule of p.chronology) add(`Date order: ${rule.start} to ${rule.end}`, table.rows.length, table.rows.filter((row) => {
    const start = value(row, rule.start), end = value(row, rule.end);
    return !isoDate(start) || (end === "" ? !rule.allow_open : !isoDate(end) || end < start);
  }).length);
  const entries = new Map([...groups].map(([key, group]) => [key, {
    date: value(group.row, p.measure.date_column), status: value(group.row, p.measure.status_column)
  }]));
  return { checks, missing, complete: checks.every((c) => c.status === "passed"), totalRows: table.rows.length,
    checkedRows: table.rows.length, entries };
}
export function checkReport({ baseline, current, profile, run }) {
  validateProfile(profile); validateRun(run);
  baseline = mappedTable(baseline, profile.mappings.baseline);
  current = mappedTable(current, profile.mappings.current);
  const before = preflight(baseline, profile), after = preflight(current, profile);
  const publicCheck = ({ entries, ...rest }) => rest;
  const result = { schema_version: "1.0.0", status: "blocked", run,
    checks: { baseline: publicCheck(before), current: publicCheck(after) }, reconciliation: null };
  if (!before.complete || !after.complete || !run.baseline_complete || !run.current_complete) return result;
  const eligible = (row) => !!row && row.date >= run.start && row.date <= run.end && profile.measure.eligible_values.includes(row.status);
  const totals = { baseline: 0, current: 0, added: 0, removed: 0, became_eligible: 0, became_ineligible: 0 };
  const contributions = [];
  for (const key of [...new Set([...before.entries.keys(), ...after.entries.keys()])].sort()) {
    const left = before.entries.get(key), right = after.entries.get(key);
    const a = Number(eligible(left)), b = Number(eligible(right));
    totals.baseline += a; totals.current += b;
    if (a === b) continue;
    const category = !left ? "added" : !right ? "removed" : b ? "became_eligible" : "became_ineligible";
    totals[category] += b - a;
    contributions.push({ key, category, contribution: b - a, before_date: left?.date ?? "", after_date: right?.date ?? "",
      before_status: left?.status ?? "", after_status: right?.status ?? "" });
  }
  const delta = totals.current - totals.baseline;
  result.status = "complete";
  result.reconciliation = { ...totals, delta, unexplained: delta - totals.added - totals.removed - totals.became_eligible - totals.became_ineligible, contributions };
  return result;
}

export const EXAMPLE_PROFILE = {
  schema_version: PROFILE_VERSION, name: "Monthly synthetic encounters", keys: ["site", "event_id"],
  required: ["program"], mappings: { baseline: [], current: [] },
  allowed: [{ column: "status", values: ["completed", "cancelled"] }, { column: "program", values: ["A", "B"] }],
  chronology: [{ start: "referred_on", end: "service_on", allow_open: false }], trim_whitespace: true,
  measure: { date_column: "service_on", status_column: "status", eligible_values: ["completed"] }
};
export const EXAMPLE_RUN = { start: "2026-08-01", end: "2026-08-31", baseline_extracted: "2026-09-01", current_extracted: "2026-09-07", baseline_complete: true, current_complete: true };
export const EXAMPLE_BASELINE = "site,event_id,program,referred_on,service_on,status\nN,001,A,2026-08-01,2026-08-02,completed\nN,002,A,2026-08-01,2026-08-03,completed\nS,001,B,2026-08-01,2026-08-04,cancelled\nN,003,A,2026-08-01,2026-08-05,completed\n";
export const EXAMPLE_CURRENT = "site,event_id,program,referred_on,service_on,status\nN,001,A,2026-08-01,2026-08-02,completed\nN,002,A,2026-08-01,2026-08-03,cancelled\nS,001,B,2026-08-01,2026-08-04,completed\nN,004,A,2026-08-01,2026-08-06,cancelled\n";
