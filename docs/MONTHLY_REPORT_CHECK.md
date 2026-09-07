# Monthly report check

[Open the workflow](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/report-check.html).
This is a separate workflow from the original extract auditor and reference-results checker.

## Synthetic mode: choose real example files

The workflow starts in **Synthetic** mode. No files are silently selected.
Choose `baseline.csv` in the synthetic baseline list and `current.csv` in the
current list. These populate the actual file controls used by the analysis.
Alternatively, download either CSV, then use **Choose File** to select it from
your drive. The analysis uses exactly the files visible in those controls.

The complete example has 1,000 encounters per snapshot, 250 invented patient
IDs, three sites, three programs, and 1,070 retained encounter versions.
Supporting tables, a data dictionary, profile, expected-results JSON, and a
complete SQLite-compatible SQL database are downloadable from the same page.
The SQL creates `patients`, `sites`, `programs`, `encounter_versions`, and two
snapshot views. CSVs and database views contain the same records; the generator
and independent SQL reconstruction are tested. No real data was used.

1. Choose the baseline and current files. The synthetic profile and August 2026
   period are supplied; confirm both snapshots cover that period.
2. Select **Check and reconcile**. Both files contain 1,000 rows, but the eligible
   event count changes from **800 to 794**.
3. Contributions are: 16 eligible additions, 16 eligible removals, 10 existing
   records becoming eligible, and 16 becoming ineligible. Net change **-6**;
   unaccounted remainder **0**.
4. Download the contributions or summary, and save the profile for another run.
5. Choose or download `current-duplicate.csv` as the current file. Reconfirm its
   coverage and rerun. The duplicate composite identity blocks reconciliation.

The key is `site,event_id`: event IDs repeat across sites, and leading zeros
remain text. Synthetic mode checks file bytes against the supplied snapshots;
renaming a personal file does not make it synthetic. Editing or resaving the
example CSV changes its bytes: use Open mode to experiment with modified files.
Supporting tables and database SQL are for exploration, not snapshot inputs.

## Open mode: use your own files

Switch to **Open** to select authorized personal or organizational CSVs from
your own drive. Both modes use the same local analysis engine and input limits.
Open mode does not upload data or connect to an organizational database.
Switching modes cancels active work and clears files, results, dates, coverage,
and profile settings. No personal settings or data are carried into a synthetic
session. Mode and verified synthetic dataset identity are recorded in summaries;
Open-mode output makes no claim that its data is synthetic.

## Use approved local files

Choose two snapshots for the same reporting period. Enter the period and actual
extraction dates. Confirm whole-period coverage only after checking the source
process: neither a timestamp nor a successful parser proves completeness.
An extract taken before period end cannot be declared complete.

Set the key columns, service date column, status column, and eligible statuses.
Required-value checks, allowed code lists, chronology, and explicit source-to-
canonical column mappings are optional additions. Every listed column must
exist. Unknown and ambiguous data is reported rather than repaired.

Profiles contain settings, not data or file paths. Run dates and coverage are
deliberately separate to prevent carrying last month's approval into this month.
The editor supports comma-separated names and values, one chronology rule, and
one `source=destination` mapping per line. It rejects imports that cannot be
represented without loss. The core profile format supports up to 20 chronology
rules for future clients; this editor does not silently discard them.

## Exact behavior

- Profile format `1.0.0`, maximum 64 KB; unknown fields, unsupported versions,
  duplicate JSON keys, executable configuration, and conflicting mappings are rejected.
- Dates are real calendar dates in YYYY-MM-DD format. Boundaries are inclusive;
  same-day chronology is valid. There is no automatic numeric or date coercion.
- Whitespace trimming is explicit and applies to values and keys. Leading zeros
  remain significant; blank, unknown, zero, and not-applicable are not equated.
- Missing schema blocks dependent row checks. Failed row checks or empty extracts
  block reconciliation. All applicable row checks run, with checked and failed
  counts. Counts from different failed checks can overlap and must not be summed.
- Eligible event count is one per unique composite key, with service date inside
  the selected period and status in the selected values. Each nonzero contribution
  belongs to exactly one category: added, removed, became eligible, became
  ineligible. Added/removed takes precedence over eligibility changes.
- Records that remain eligible contribute zero even when other values change.
  Use the existing extract auditor to inspect those differences. This measure
  does not sum distinct people across groups or claim causal explanations.
- The user confirms coverage. A complete result means the configured checks
  passed and the displayed contributions account for the count change; it is not
  independent approval of the reporting definition or input completeness.

## Evidence, limits, and deployment

Checks run in a cancellable worker using the existing UTF-8 parser and limits:
10 MB, 100,000 rows, 200 columns, and two million cells per file. Editing inputs
invalidates prior results. Clearing removes selected data and rendered results
while retaining the visible profile settings. No local storage or network
upload is used.

Preview at most 100 contributions. The complete CSV export is formula-protected
and capped at 24 MB; if it exceeds that limit it is unavailable, never silently
truncated. Summary JSON omits record contributions but contains rule names,
periods, aggregate findings, source-byte fingerprints, a fingerprint of the compact
JSON settings representation, and toolkit version. Save the profile separately for reproduction.
Fingerprints establish consistency, not authorship or approval. Both summaries
and detailed exports can contain sensitive information. These summaries use
their own format and are not analysis receipts for the existing receipt inspector.

Use the normal [internal deployment instructions](../INTERNAL_DEPLOYMENT.md).
Serve the release over an approved static HTTP server; opening an HTML file
directly may prevent module workers from loading. The new page and worker are
included in the deterministic operational release.

For deeper domain logic, see the independently executable
[reporting packs](https://github.com/dfrbagley-cpu/health-data-edge-cases/blob/main/docs/REPORTING_PACKS.md).
Historical cutoffs and effective-dated joins run there; this browser workflow
does not reconstruct history or apply mapping-table joins.
