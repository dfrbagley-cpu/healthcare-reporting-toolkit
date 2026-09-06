# Product case study: a reviewable CSV change audit

[Try the live example](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/#auditor)
· [Reproduce the findings](EXTRACT_AUDITOR.md) · [Back to the project](../README.md)

## The user and the decision

The intended user is a healthcare reporting analyst reviewing a recurring
extract before it feeds a report. The immediate decision is whether a change
needs investigation: has a field disappeared, has a record been removed, or
has a value changed despite the total row count staying the same?

The toolkit makes those differences visible and exportable. It does not decide
whether a source change is correct or approve the resulting report.

## A small example that exposes the problem

The built-in baseline and current extracts each have four rows. A row-count
check passes, yet one record is added, one removed, and two shared records have
changed values. A column is added and another removed. The auditor separates
schema changes from record changes so a new column does not misleadingly mark
every record as modified.

![Actual toolkit results using only the bundled synthetic example](images/extract-audit-example.jpg)

The [fixture](../site/js/samples.js),
[expected results](../tests/extract-auditor.test.js), and
[calculation module](../site/js/tools/extract-auditor.js) are public and inspectable.

## Product choices and trade-offs

| Choice | User benefit | Cost or constraint |
|---|---|---|
| Browser-only file processing with no accounts or telemetry | A visitor can try an example immediately without submitting a dataset | No shared workspace, saved projects, or automatic usage analytics |
| Compare values as text and show assumptions | Results can be inspected without hidden coercion | Semantically equivalent values can still differ as text |
| Exclude duplicate or blank keys with warnings | The tool avoids inventing record matches | An analyst must resolve key problems before a complete comparison |
| Run extract work in a cancellable worker with explicit limits | Larger comparisons keep the interface usable | Inputs and exports above the limits are refused |
| Separate detailed CSVs from aggregate receipts | Users can choose the evidence appropriate to a review | Aggregates and file hashes can still be sensitive; a receipt is not approval or authentication |
| Consume a pinned public edge-case catalogue | Browser checks and reference fixtures share one contract | Updating the catalogue requires an explicit version and digest review |

These constraints keep the product focused on a repeatable reporting check.
Authentication, remote storage, vendor integrations, and automatic report
approval are outside its current scope.

## Evidence a reviewer can reproduce

| Claim | Evidence |
|---|---|
| Schema drift is separate from changed values | [Extract comparison tests](../tests/extract-auditor.test.js) and the [live walkthrough](EXTRACT_AUDITOR.md) |
| Calculation outputs and receipt compatibility are tested | [Domain and receipt tests](../tests) run by `npm run validate` |
| The larger audit path is bounded and cancellable | [Chrome journey](../tests/browser/extract-auditor.browser.mjs) exercises 100,000 rows, responsiveness, cancellation, stale-run protection, and safe CSV export |
| Every public route receives automated accessibility checks | The same Chrome journey runs axe WCAG 2 A/AA scans; this is not a substitute for manual assistive-technology testing |
| Operational artifacts can be reproduced and verified | [Release tests](../tests/operational-release.test.js), [release workflow](../.github/workflows/release.yml), and [deployment guide](../INTERNAL_DEPLOYMENT.md) |
| Public and non-public material stay separate | [Publication policy](../PUBLICATION_POLICY.md) and [site validation](../scripts/validate-site.mjs) |

The [latest workflow runs](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/actions/workflows/ci.yml)
show which checks ran for each commit. The screenshot above was captured from
the published v0.6.1 application using its bundled synthetic example.

## Ownership and honest limits

David Bagley framed the users and problems, set product scope and priorities,
defined workflows, requirements, acceptance criteria, and UX direction, and
validated the result. Implementation was AI-assisted; responsibility for
product direction, healthcare-domain decisions, and validation remains with
the maintainer. Individual contributions are recorded in the public history.

This independent portfolio project contains no patient or employer data,
licensed reporting definitions, or proprietary vendor schemas. Public test
results demonstrate behavior against defined cases. They do not establish
hospital approval, production adoption, time saved, or clinical suitability.

The next useful evidence is an independent analyst completing the walkthrough
and identifying a recurring task it improves. A
[synthetic workflow report](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/issues/new/choose)
is more actionable than an unmeasured claim about impact.
