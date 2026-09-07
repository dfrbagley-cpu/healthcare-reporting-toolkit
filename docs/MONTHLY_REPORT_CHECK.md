# Monthly report check

[Open the workflow](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/report-check.html).
This is a separate workflow from the original extract auditor and reference-results checker.

## Try it

1. Select **Try the clean example**, then **Check and reconcile**.
2. Both extracts have four rows. The eligible event count moves from **3 to 2**.
   One eligible record is removed (-1); one existing record becomes ineligible
   (-1); another becomes eligible (+1). The net change is -1 and remainder is 0.
3. Download the contributions CSV to inspect the relevant keys and statuses.
4. Save the profile. Load it again, confirm the reporting dates and coverage,
   and repeat the check. Loading settings deliberately resets coverage confirmation.
5. Select **Try an invalid example** and rerun. A duplicate composite identity
   blocks reconciliation; it cannot disappear behind an all-clear result.

The key is `site,event_id`. `N,001` and `S,001` are different records; `001`
remains text. This demonstrates why event identity sometimes requires more than
one column. All example identifiers and reporting rules are independently invented.

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
