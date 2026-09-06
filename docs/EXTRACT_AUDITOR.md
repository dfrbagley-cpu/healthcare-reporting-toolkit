# Extract Change Auditor: find what a row-count check misses

[Open the auditor](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/#auditor)
· [Back to the toolkit](../README.md)

This walkthrough uses the bundled, independently authored synthetic example.
No files or account are needed. The comparator runs in your browser.

## 1. Compare the example

Open **Extracts**, then select **Use synthetic example**. The tool loads both
snapshots, sets the record key to `record_id`, and starts the comparison.
Leave **Ignore surrounding whitespace** checked for this walkthrough.

You should see **4 → 4 rows**, but the records are different:

| Record | Expected result | Reason |
|---|---|---|
| `R-1001` | Changed | `status` goes from `open` to `closed` |
| `R-1002` | Changed | `wait_days` goes from `9` to `11` |
| `R-1003` | Removed | It is present only in the baseline |
| `R-1004` | Unchanged | All shared non-key values match |
| `R-1005` | Added | It is present only in the current extract |

Summary: **1 added, 1 removed, 2 changed records, and 2 changed cells**.
The unchanged record appears in the count, not in the changed-record preview.

Under **Schema changes**, `owner` is added and `active` is removed. These are
reported separately; they do not make every shared record count as changed.
**Key integrity** should show zero duplicate keys and zero blank keys.

## 2. Decide what needs investigation

A difference is a finding, not necessarily an error. For this invented example,
questions might be: was the status correction expected, why did the wait value
change, and should the removed record still be in the reporting population?

The auditor cannot answer those questions from two files alone. It identifies
the exact difference so an analyst can investigate before relying on a report.

## 3. Choose a review artifact

| Download | What it includes | What to remember |
|---|---|---|
| **Download change log** | Four detailed rows for this example: two changed values, one removal, and one addition | It contains record keys and values; handle it according to the source data's sensitivity |
| **Download analysis receipt** | Source-byte fingerprints, aggregate findings, calculation assumptions, version, and digest | It omits filenames, column names, keys, and cell values; even aggregates and hashes can be sensitive |

The CSV protects leading spreadsheet-formula characters. It is a record-level
change log: schema findings remain visible in the interface and are represented
as aggregate findings in the receipt, rather than detailed schema rows in the
CSV. An unkeyed receipt digest supports consistency checks, not proof of
authorship, approval, or when a comparison occurred.

For an additional check, open **Receipts**, select the downloaded JSON, and
choose **Inspect receipt**. A freshly generated example should be **Internally
consistent**. See the [receipt guide](RECEIPT_INSPECTOR.md) for the exact limits
of that result.

## 4. Try the file-selection path

The same sample snapshots are available as
[baseline.csv](../site/examples/baseline.csv) and
[current.csv](../site/examples/current.csv). On GitHub, use **Download raw file**
to save each CSV. Select **Clear selected data**, choose the two files, enter
`record_id`, and select **Compare extracts**. The result should match the table.

For your own approved files, choose key columns present in both extracts.
Composite keys use comma-separated column names. Duplicate and blank keys
produce warnings and are excluded from matching; the tool does not guess which
record belongs to which. Comparisons use text values, not numeric or date
equivalence. See [all limits](TECHNICAL_REFERENCE.md#calculation-boundaries).

## 5. Leave one useful piece of feedback

If a step failed or the result was unclear,
[report the problem](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/issues/new/choose)
with your browser, the step, expected behavior, and observed behavior.
If it worked, a description of the recurring task it could help with is useful
too. Use synthetic examples only. Never post patient data, confidential
operational material, licensed definitions, or vendor schemas.
