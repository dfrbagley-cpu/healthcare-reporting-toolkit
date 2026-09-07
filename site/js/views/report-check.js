import { EXAMPLE_PROFILE, EXAMPLE_RUN, EXAMPLE_BASELINE, EXAMPLE_CURRENT, parseProfile, validateProfile } from "../tools/report-check.js";
const $ = (id) => document.getElementById(id);
let worker = null, sampleFiles = null, report = null, csv = null, revision = 0;
const split = (text) => text.split(",").map((s) => s.trim()).filter(Boolean);
const lines = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
function pair(line) {
  const parts = line.split("=");
  if (parts.length !== 2 || !parts.every((p) => p.trim())) throw new Error("Use one source=destination or column=value1,value2 per line.");
  return parts.map((p) => p.trim());
}
function getProfile() {
  const start = $("chronology-start").value.trim(), end = $("chronology-end").value.trim();
  if (!!start !== !!end) throw new Error("Provide both chronology columns, or leave both blank.");
  return validateProfile({ schema_version: "1.0.0", name: $("profile-name").value.trim(), keys: split($("keys").value),
    required: split($("required-columns").value), mappings: Object.fromEntries(["baseline", "current"].map((side) =>
      [side, lines($(`${side}-mappings`).value).map((line) => { const [from, to] = pair(line); return { from, to }; })])),
    allowed: lines($("allowed").value).map((line) => { const [column, values] = pair(line); return { column, values: split(values) }; }),
    chronology: start ? [{ start, end, allow_open: $("allow-open").checked }] : [],
    trim_whitespace: $("trim").checked,
    measure: { date_column: $("date-column").value.trim(), status_column: $("status-column").value.trim(), eligible_values: split($("eligible-values").value) } });
}
function setProfile(p) {
  // The first editor deliberately supports one chronology rule; never silently discard additional rules.
  if (p.chronology.length > 1) throw new Error("This editor supports one chronology rule per profile.");
  if (Object.values(p.mappings).flat().some((m) => /[=\r\n]/.test(m.from + m.to))) throw new Error("Mapping names cannot contain equals signs or newlines in this editor.");
  const names = [...p.keys, ...p.required, ...p.measure.eligible_values, ...p.allowed.flatMap((r) => [r.column, ...r.values])];
  if (names.some((n) => /[,=\r\n]/.test(n))) throw new Error("This editor needs names and allowed values without commas, equals signs, or newlines.");
  $("profile-name").value = p.name; $("keys").value = p.keys.join(","); $("required-columns").value = p.required.join(",");
  for (const side of ["baseline", "current"]) $(`${side}-mappings`).value = p.mappings[side].map((m) => `${m.from}=${m.to}`).join("\n");
  $("allowed").value = p.allowed.map((r) => `${r.column}=${r.values.join(",")}`).join("\n");
  $("date-column").value = p.measure.date_column; $("status-column").value = p.measure.status_column;
  $("eligible-values").value = p.measure.eligible_values.join(","); $("trim").checked = p.trim_whitespace;
  $("chronology-start").value = p.chronology[0]?.start ?? ""; $("chronology-end").value = p.chronology[0]?.end ?? "";
  $("allow-open").checked = p.chronology[0]?.allow_open ?? false;
}
function getRun() {
  return { start: $("start").value, end: $("end").value, baseline_extracted: $("baseline-extracted").value,
    current_extracted: $("current-extracted").value, baseline_complete: $("baseline-complete").checked, current_complete: $("current-complete").checked };
}
function stop() { worker?.terminate(); worker = null; $("run").disabled = false; $("cancel").disabled = true; }
function invalidate() {
  revision++; stop(); report = null; csv = null; $("results").hidden = true; $("save-details").disabled = true;
  for (const id of ["coverage", "checks", "reconciliation"]) $(id).replaceChildren();
  $("status").textContent = "Settings changed. Run the check again."; $("error").textContent = "";
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const jsonBlob = (data) => new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
function table(headers, rows) {
  const wrap = document.createElement("div"); wrap.className = "report-scroll";
  const node = document.createElement("table"); node.className = "report-table";
  const head = node.createTHead().insertRow();
  for (const label of headers) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = label; head.append(cell); }
  const body = node.createTBody();
  for (const row of rows) { const tr = body.insertRow(); for (const value of row) tr.insertCell().textContent = String(value); }
  wrap.append(node); return wrap;
}
function paragraph(target, text) { const p = document.createElement("p"); p.textContent = text; $(target).append(p); }
function render(result) {
  $("results").hidden = false;
  $("result-heading").textContent = result.status === "complete" ? "Complete: the count change is accounted for" : "Blocked: resolve checks or confirm coverage";
  for (const side of ["baseline", "current"]) {
    const checks = result.checks[side];
    paragraph("coverage", `${side}: ${checks.checkedRows} of ${checks.totalRows} rows checked. Period coverage ${result.run[`${side}_complete`] ? "confirmed by you" : "not confirmed"}.`);
    if (checks.missing.length) paragraph("coverage", `Missing columns: ${checks.missing.join(", ")}`);
    const heading = document.createElement("h3"); heading.textContent = `${side} checks`; $("checks").append(heading);
    $("checks").append(table(["Check", "Status", "Checked", "Failed"], checks.checks.map((c) => [c.name, c.status, c.checked, c.failed])));
  }
  const r = result.reconciliation;
  if (r) {
    $("reconciliation").append(table(["Count component", "Value"], [
      ["Baseline eligible events", r.baseline], ["New eligible records", r.added], ["Removed eligible records", r.removed],
      ["Existing records became eligible", r.became_eligible], ["Existing records became ineligible", r.became_ineligible],
      ["Current eligible events", r.current], ["Total change", r.delta], ["Unaccounted remainder", r.unexplained]
    ]));
    paragraph("reconciliation", `Showing ${r.contributions.length} of ${r.contribution_count} non-zero contributions. Categories are mutually exclusive; values and dates show the observed change, not its cause.`);
    $("reconciliation").append(table(["Record key", "Category", "Contribution"], r.contributions.map((row) => [row.key, row.category, row.contribution])));
  } else paragraph("reconciliation", "No complete reconciliation is available. Resolve failed checks and establish period coverage, then rerun.");
}
$("report-form").addEventListener("input", invalidate);
$("report-form").addEventListener("change", (event) => {
  invalidate();
  if (["baseline", "current"].includes(event.target.id)) {
    sampleFiles = null; $("file-status").textContent = "Using your selected files.";
    $(`${event.target.id}-complete`).checked = false;
  }
});
$("profile-file").addEventListener("change", async (event) => {
  event.stopPropagation(); invalidate();
  const file = $("profile-file").files[0], ticket = revision;
  if (!file) return;
  try {
    if (file.size > 64 * 1024) throw new Error("Profile exceeds the 64 KB limit.");
    const profile = parseProfile(await file.arrayBuffer());
    if (ticket !== revision) return;
    setProfile(profile); $("status").textContent = "Profile loaded. Review the dates and confirm coverage for this run.";
    $("baseline-complete").checked = false; $("current-complete").checked = false;
  } catch (error) { $("error").textContent = error.message; }
});
$("save-profile").onclick = () => { try { download(jsonBlob(getProfile()), "report-profile.json"); } catch (error) { $("error").textContent = error.message; } };
function example(defective = false) {
  invalidate(); setProfile(structuredClone(EXAMPLE_PROFILE));
  for (const [key, value] of Object.entries(EXAMPLE_RUN)) { const node = $(key.replaceAll("_", "-")); if (typeof value === "boolean") node.checked = value; else node.value = value; }
  $("baseline").value = ""; $("current").value = "";
  const current = defective ? EXAMPLE_CURRENT + "N,001,A,2026-08-01,2026-08-02,completed\n" : EXAMPLE_CURRENT;
  sampleFiles = [new File([EXAMPLE_BASELINE], "synthetic-baseline.csv"), new File([current], "synthetic-current.csv")];
  $("file-status").textContent = defective ? "Synthetic files loaded: current extract has a duplicate identity." : "Synthetic files loaded: four rows in each, eligible count changes from 3 to 2.";
  $("status").textContent = "Example ready. Select Check and reconcile.";
}
$("example").onclick = () => example(); $("defective").onclick = () => example(true);
$("clear").onclick = () => { invalidate(); sampleFiles = null; $("baseline").value = ""; $("current").value = ""; $("profile-file").value = "";
  $("baseline-complete").checked = false; $("current-complete").checked = false; $("file-status").textContent = "No files selected."; $("status").textContent = "Files and results cleared. Profile settings remain."; };
$("cancel").onclick = () => { invalidate(); $("status").textContent = "Check cancelled. No result retained."; };
$("report-form").onsubmit = (event) => {
  event.preventDefault(); invalidate();
  try {
    const profile = getProfile(), run = getRun();
    const [baselineFile, currentFile] = sampleFiles ?? [$("baseline").files[0], $("current").files[0]];
    worker = new Worker(new URL("../workers/report-check-worker.js", import.meta.url), { type: "module" });
    $("run").disabled = true; $("cancel").disabled = false; $("status").textContent = "Reading files…";
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") { $("status").textContent = data.phase; return; }
      stop();
      if (data.type === "error") { $("error").textContent = data.message; $("status").textContent = "Check could not run."; return; }
      report = data.result; csv = data.csv; render(report); $("save-details").disabled = !csv;
      $("status").textContent = report.status === "complete" ? "Check complete." : "Check blocked. Review the findings below.";
      if (!data.exportAvailable) paragraph("reconciliation", "Full contribution export exceeds 24 MB. Split your extracts; the preview is not a complete export.");
    };
    worker.onerror = () => { stop(); $("error").textContent = "The background check stopped. Retry with smaller files or an approved static server."; };
    worker.postMessage({ baselineFile, currentFile, profile, run });
  } catch (error) { stop(); $("error").textContent = error.message; }
};
$("save-summary").onclick = () => {
  if (!report) return;
  const summary = structuredClone(report);
  if (summary.reconciliation) delete summary.reconciliation.contributions;
  download(jsonBlob(summary), "report-check-summary.json");
};
$("save-details").onclick = () => { if (csv) download(csv, "report-count-contributions.csv"); };
