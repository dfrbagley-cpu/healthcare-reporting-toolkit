import { parseProfile, validateProfile } from "../tools/report-check.js";
import { syntheticDatabase, SYNTHETIC_PROFILE, SYNTHETIC_RUN } from "../data/monthly-synthetic.js";
const $ = (id) => document.getElementById(id);
const database = syntheticDatabase();
let worker = null, report = null, csv = null, revision = 0, mode = "synthetic";
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
    $(`synthetic-${event.target.id}`).value = "";
    updateFileStatus();
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
function updateFileStatus() {
  $("file-status").textContent = ["baseline", "current"].map((side) => `${side}: ${$(side).files[0]?.name ?? "no file selected"}`).join(" · ");
}
function clearFiles() {
  invalidate();
  for (const side of ["baseline", "current"]) { $(side).value = ""; $(`synthetic-${side}`).value = ""; $(`${side}-complete`).checked = false; }
  $("profile-file").value = ""; updateFileStatus();
}
function changeMode(next) {
  clearFiles(); $("report-form").reset(); mode = next;
  $("mode-synthetic").checked = mode === "synthetic"; $("mode-open").checked = mode === "open";
  $("synthetic-library").hidden = mode !== "synthetic"; $("synthetic-pickers").hidden = mode !== "synthetic";
  if (mode === "synthetic") {
    setProfile(structuredClone(SYNTHETIC_PROFILE));
    for (const [key, value] of Object.entries(SYNTHETIC_RUN)) { const node = $(key.replaceAll("_", "-")); if (typeof value === "boolean") node.checked = value; else node.value = value; }
  }
  $("mode-description").textContent = mode === "synthetic"
    ? "Synthetic mode: use the supplied example files. Choose from the list or select an unchanged downloaded CSV."
    : "Open mode: select personal or organizational CSV files from your drive that you are authorized to use. Processing stays local to this browser.";
  $("status").textContent = mode === "synthetic" ? "Choose your synthetic baseline and current files to begin." : "Open mode ready. Select your files and define your reporting check.";
}
for (const next of ["synthetic", "open"]) $(`mode-${next}`).onchange = () => changeMode(next);
for (const side of ["baseline", "current"]) {
  const select = $(`synthetic-${side}`);
  for (const [name, file] of Object.entries(database.files).filter(([, f]) => f.role === side)) {
    const option = document.createElement("option"); option.value = name; option.textContent = file.label; select.append(option);
  }
  select.addEventListener("change", (event) => {
    event.stopPropagation(); invalidate();
    const name = select.value;
    if (!name) $(side).value = "";
    else {
      const file = database.files[name], transfer = new DataTransfer();
      transfer.items.add(new File([file.text], name, { type: file.type }));
      $(side).files = transfer.files;
    }
    $(`${side}-complete`).checked = false; updateFileStatus();
  });
}
for (const [name, file] of Object.entries(database.files)) {
  const button = document.createElement("button"); button.type = "button"; button.className = "button button-secondary";
  button.textContent = file.role ? `Download ${name}` : `${name} — ${file.label}`; button.dataset.downloadFile = name;
  button.onclick = () => download(new Blob([file.text], { type: file.type }), name);
  $(file.role ? "snapshot-downloads" : "dataset-downloads").append(button);
}
$("clear").onclick = () => { clearFiles(); $("status").textContent = "Files and results cleared. Profile settings remain."; };
$("cancel").onclick = () => { invalidate(); $("status").textContent = "Check cancelled. No result retained."; };
$("report-form").onsubmit = (event) => {
  event.preventDefault(); invalidate();
  const runRevision = revision;
  try {
    const profile = getProfile(), run = getRun();
    const [baselineFile, currentFile] = [$("baseline").files[0], $("current").files[0]];
    worker = new Worker(new URL("../workers/report-check-worker.js", import.meta.url), { type: "module" });
    $("run").disabled = true; $("cancel").disabled = false; $("status").textContent = "Reading files…";
    worker.onmessage = ({ data }) => {
      if (runRevision !== revision) return;
      if (data.type === "progress") { $("status").textContent = data.phase; return; }
      stop();
      if (data.type === "error") { $("error").textContent = data.message; $("status").textContent = "Check could not run."; return; }
      report = data.result; csv = data.csv; render(report); $("save-details").disabled = !csv;
      $("status").textContent = report.status === "complete" ? "Check complete." : "Check blocked. Review the findings below.";
      if (!data.exportAvailable) paragraph("reconciliation", "Full contribution export exceeds 24 MB. Split your extracts; the preview is not a complete export.");
    };
    worker.onerror = () => { if (runRevision !== revision) return; stop(); $("error").textContent = "The background check stopped. Retry with smaller files or an approved static server."; };
    worker.postMessage({ baselineFile, currentFile, profile, run, mode });
  } catch (error) { stop(); $("error").textContent = error.message; }
};
$("save-summary").onclick = () => {
  if (!report) return;
  const summary = structuredClone(report);
  if (summary.reconciliation) delete summary.reconciliation.contributions;
  download(jsonBlob(summary), "report-check-summary.json");
};
$("save-details").onclick = () => { if (csv) download(csv, "report-count-contributions.csv"); };
changeMode("synthetic");
