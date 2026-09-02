# Healthcare Reporting Toolkit

[![Quality gates](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/actions/workflows/pages.yml/badge.svg)](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/actions/workflows/pages.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-0f766e.svg)](LICENSE)

Catch changed records and schema drift before they reach a healthcare report,
then use the companion local tools for reporting periods, capacity scenarios,
result contracts, and receipt inspection.

**Live toolkit:** <https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/>

[![Healthcare Reporting Toolkit — catch CSV extract changes before they reach a report](site/social-card.png)](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/#auditor)

## Try the Extract Change Auditor in 60 seconds

1. Open the [live synthetic extract audit](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/#auditor).
2. Select **Use synthetic example**. No files or account are required.
3. Review schema changes, added and removed records, changed cells, and key-integrity warnings.
4. Download the formula-safe change log or privacy-bounded analysis receipt if you want a reviewable record.

The comparison runs entirely in your browser. Nothing is uploaded, and the
published site has no backend, account system, telemetry, or third-party asset
requests.

Have a recurring reporting workflow or find a problem? [Share safe feedback on
GitHub](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/issues/new/choose).
Use synthetic, independently created examples only. Never include PHI or
patient data, employer-confidential information, licensed reporting-standard
content, or vendor-proprietary schemas or specifications.

## Product case study

**Intended users.** Hospital decision-support and analytics teams that need
repeatable checks around operational reporting extracts and calculations.

**Problem.** Reporting checks are often manual, difficult to reproduce, and
risky when work involves sensitive extracts.

**Product decision.** Keep the tools local-first in the browser, with no remote
storage or telemetry, and make assumptions explicit through exportable,
versioned analysis receipts with deterministic calculation digests.

**My role.** I framed the users and problems, set product scope and priorities,
defined workflows, requirements, acceptance criteria, and UX direction, and
validated the result. AI-assisted development accelerated implementation; I
retained responsibility for healthcare-domain decisions, product direction,
and validation.

**Evidence.** Four analysis workflows plus a Receipt Inspector and replay
utility provide five working browser experiences. Validation covers a
browser-tested 100,000-row extract-audit path, versioned receipt profiles,
deterministic calculation digests, automated accessibility checks, and the
live deployment. The Reporting Results Checker is a controlled consumer of the
pinned, digest-verified catalogue from
[Health Data Edge Cases](https://github.com/dfrbagley-cpu/health-data-edge-cases),
so the two products share definitions without maintaining duplicate contracts.

**Boundaries.** This is independent portfolio work using synthetic data, not
approved clinical software or a production hospital platform. It contains no
patient or employer data, licensed reporting standards, or proprietary vendor
schemas.

## What is included

| Tool | Question it answers | Output |
|---|---|---|
| Reporting Window Builder | What exact current and comparison dates should this report use? | Inclusive fiscal, rolling, custom, and like-for-like periods |
| Extract Change Auditor | What changed between two CSV snapshots? | Responsive worker-based schema and record comparison, bounded preview, key warnings, and a complete change log when within safety limits |
| Waitlist Capacity Planner | What happens to backlog if demand and capacity continue at these rates? | Current-versus-planned trajectory, wait proxy, and required-capacity estimate |
| Reporting Results Checker | Do external result exports match a known synthetic reporting contract? | Exact missing, unexpected, and incorrect-value diagnostics |
| Receipt Inspector and Replay | Is a published toolkit receipt internally consistent, and do selected local files match its fingerprints? | Strict profile validation, digest recalculation, deterministic replay where possible, and optional exact source matching |

The project deliberately avoids authentication, telemetry, remote storage,
vendor-specific schemas, and opaque scoring. It is a small, inspectable toolkit,
not a hosted reporting platform.

## Use it

Open the [live toolkit](https://dfrbagley-cpu.github.io/healthcare-reporting-toolkit/)
in a modern browser. There is no installation or account.

For an approved internal deployment, download the self-host ZIP, provenance
JSON, and `SHA256SUMS` from one versioned GitHub Release, verify the hashes, and
follow [INTERNAL_DEPLOYMENT.md](INTERNAL_DEPLOYMENT.md). The ZIP is a durable,
dependency-free static artifact pinned to one tested commit; do not use the
moving `main` branch as an operational deployment source. GitHub release
immutability is recommended where repository governance permits it; the
workflow also rebuilds from the tagged commit and compares every published
asset byte-for-byte.

To run a local copy:

```bash
python3 -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

## Privacy and security

- The site is static and has no backend.
- CSV files are parsed on the user's device.
- Extract parsing and comparison run in a same-origin module worker so the
  interface remains responsive and cancellation can terminate the computation.
- The published site makes no API, analytics, font, or asset requests to third parties.
- A restrictive Content Security Policy disables network connections from the application.
- Downloaded CSV change logs protect leading spreadsheet-formula characters.
- Duplicate and missing record keys are excluded rather than guessed.
- Extract analysis receipts contain source fingerprints and aggregate findings,
  but omit filenames, column names, row keys, and cell values.
- The Extract Change Auditor and Reporting Results Checker provide explicit
  **Clear selected data** actions. Use them after each session; closing the tab
  is an additional end-of-session control.
- Conformance checks use only a bundled synthetic contract catalog. Uploaded
  result exports and detailed diagnostics remain local to the browser.

These controls do not override an organization's privacy, retention, security,
or approved-software policies. Inspect and approve the code and deployment
before using a local copy with sensitive information.

## Analysis receipts

Every tool can download a versioned JSON analysis receipt. A receipt records
the normalized inputs, aggregate outputs, warnings, calculation assumptions,
toolkit version, and a deterministic calculation digest. The public
[JSON Schema](site/schemas/analysis-receipt.schema.json) defines the contract.

For extract audits, SHA-256 fingerprints are calculated from the original file
bytes in the browser. The receipt includes those fingerprints plus file size,
row count, and column count; it deliberately excludes filenames, headers,
record keys, and cell values. The ordered key-column choice is represented by
its count only; key-column names are omitted rather than represented by a
guessable deterministic fingerprint. Preserve the chosen key columns
separately if another person must reproduce the comparison exactly. The
separate change-log CSV does contain row-level differences and must be handled
according to the source data's sensitivity.

A receipt and its hashes support repeatability; they do not prove source
accuracy, authorship, approval, or when a calculation occurred. Review a
receipt before sharing it because even aggregate metadata can be sensitive.

The local [Receipt Inspector and Replay](docs/RECEIPT_INSPECTOR.md) recognizes
the published 0.2.0 through 0.6.1 receipt profiles. It strictly validates the
selected profile, recalculates the unkeyed calculation digest, replays
reporting-window and capacity calculations, and can compare selected source
files with recorded byte counts and SHA-256 fingerprints. “Internally
consistent” is deliberately not described as authentic: the schema URL,
digest field, and recorded timestamp are outside digest coverage, and a person
can construct a new self-consistent receipt.

Reporting-results receipts contain the pinned edge-suite version and digest,
selected public case ID, source-file fingerprints, and aggregate mismatch
counts. They omit filenames, period and result keys, metric and check IDs,
expected and actual values, and row-level diagnostics. The separate diagnostics
CSV contains those details and can remain sensitive.

## Reporting-results contract

The Reporting Results Checker consumes the versioned catalog generated by
[Health Data Edge Cases v0.5.1](https://github.com/dfrbagley-cpu/health-data-edge-cases/releases/tag/v0.5.1).
The byte-identical JSON catalog is vendored with a generated browser module and
verified by digest in tests and CI. The live application never fetches a
contract at runtime.

Select one bundled case and provide:

- `actual_metrics.csv`: `period_id,metric_id,actual_value`
- `actual_quality.csv`: `check_id,actual_value`

Headers and order are exact. Blank or duplicate keys and malformed rows are
rejected. Values must be integer text without decimals, exponents, `NaN`, or
infinity. Missing, unexpected, and incorrect values all prevent a match.

See the [five-minute fail → diagnose → correct tutorial](docs/CONFORMANCE_CHECKER.md).

## Calculation boundaries

The tools are decision support:

- Reporting periods use calendar dates and inclusive boundaries. They do not
  implement 4-4-5 calendars, holiday calendars, or organization-specific exclusions.
- Extract values are compared as text. Inferred type changes are screening
  signals, not a formal schema. Inputs must be UTF-8 comma-delimited CSV.
  Per-file limits are 10 MB, 100,000 data rows, 200 columns, and 2,000,000
  materialized cells. The interface retains at most 100 material differences.
  A complete detailed download is refused—not truncated—above 250,000 rows or
  48 MB, while aggregate comparison counts remain complete.
- The waitlist planner uses a deterministic fluid-queue approximation with
  constant average arrivals and capacity. It is not a patient-level prediction,
  discrete-event simulation, or clinical prioritization model. Its recommended
  capacity is the larger of the amount needed to meet the selected horizon
  target and the steady-state floor implied by average arrivals.
- The results checker compares aggregate exports with selected synthetic cases.
  A pass does not certify the producing pipeline, source data, local policy, or
  behavior outside the tested contract.

Every material assumption is repeated beside the relevant tool.

## Development

The deployed site uses plain HTML, CSS, and JavaScript modules with no runtime
dependencies. Node.js 20 or later plus exact development-only pins for
`playwright-core` and `axe-core` support production-site journeys and WCAG 2
A/AA checks against the Chrome already installed on GitHub-hosted runners.

```bash
npm ci --ignore-scripts
npm test
npm run check
npm run validate
```

`npm run validate` runs deterministic domain and receipt-profile tests, contract digest and
provenance checks, syntax checks, interface integrity checks, privacy-boundary
checks, and network-primitive checks. `npm run test:browser` additionally
serves the real site over HTTP and validates all four tool journeys, receipt
replay and source matching, every public route against WCAG 2 A/AA, and the
100,000-row worker path with responsiveness, cancellation, stale-run
protection, bounded preview, and formula-safe download in Chrome. Set
`CHROME_PATH` if Chrome is not on a standard executable path.

## Project structure

```text
site/
  index.html                  Public application
  styles.css                  Responsive visual system
  js/lib/                     Date, CSV, receipt, and hashing utilities
  js/tools/                   Pure calculation modules
  js/workers/                 Bounded extract-audit job and worker entrypoint
  js/views/                   Isolated browser controllers
  contracts/                  Byte-identical edge-suite contract catalog
  js/app.js                   Browser interface
  examples/                   Synthetic CSV snapshots
  schemas/                    Published analysis-receipt JSON Schema
tests/                        Deterministic unit and production-site browser tests
scripts/validate-site.mjs     Static and boundary validation
scripts/build-operational-release.mjs  Deterministic self-host release assets
scripts/vendor-edge-contract.mjs  Catalog vendoring and parity validation
.github/workflows/            CI and GitHub Pages deployment
```

## Related project

[Health Data Edge Cases](https://github.com/dfrbagley-cpu/health-data-edge-cases)
owns the deterministic synthetic fixtures, expected results, catalog generator,
and reference comparison semantics. The toolkit consumes its pinned public
catalog to provide a local browser interface; it does not maintain a second
hand-written contract.

## Contributing and licence

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[PUBLICATION_POLICY.md](PUBLICATION_POLICY.md) for synthetic-data, scope, and
public/private publication boundaries. The code is licensed under
[Apache License 2.0](LICENSE).

Created and maintained by [David Bagley](https://github.com/dfrbagley-cpu).
