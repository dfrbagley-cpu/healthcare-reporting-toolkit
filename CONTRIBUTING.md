# Contributing

Help make a reporting check easier to understand, reproduce, or trust. You do
not need healthcare-system access to contribute: examples must be independently
authored and synthetic. Start by [trying the extract audit](docs/EXTRACT_AUDITOR.md).

## Small contributions to start with

These are scoped starting points, not reserved assignments. Check the
[good first issues](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
and open pull requests before starting to avoid duplicating work.

| Contribution | Where to work | Done when… |
|---|---|---|
| [Add a composite-key worked example (#20)](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/issues/20) | `docs/EXTRACT_AUDITOR.md` | Two small synthetic CSVs share a person key but have distinct encounter keys; the guide explains why both columns are needed, gives the exact key entry, and demonstrates one changed and one unchanged record |
| Check the walkthrough in Firefox or Safari | [Problem/workflow form](https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/issues/new/choose) | Record your actual browser/version, whether the synthetic result and both downloads work, and any reproducible failure; no compatibility claim without trying it |
| Improve an unclear instruction | The relevant guide or tool copy | Show the confusing step and replacement wording, verify it against the live example, and preserve the calculation or privacy assumption |

A precise report is useful even without a code fix. Documentation-only fixes
can go directly to a pull request; no issue or test is required for a typo.
For new behavior, start with an issue explaining the repeated task, current
friction, and smallest useful outcome. Feature proposals need a user problem,
not just a possible implementation.

## Set up locally

Use Node.js 20 or later. The static site and core validation have no package
dependencies:

```bash
git clone https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit.git
cd healthcare-reporting-toolkit
npm run validate
python3 -m http.server 8000 --directory site
```

Open `http://localhost:8000`. Stop the server with Ctrl+C. There is no build step.

For browser verification, install the exact development dependencies and use
a local Chrome executable:

```bash
npm ci --ignore-scripts
npm run test:browser
```

Set `CHROME_PATH` if Chrome is not on a standard executable path. CI uses
Node.js 20 and 24 for core validation and Chrome for the browser gate.

## Choose the checks that match the change

| Change | Verification |
|---|---|
| Documentation | Follow the changed instructions and check links; run `npm run validate` before submitting |
| Calculation or CSV behavior | Add an independently calculated expected result, run the focused `node --test tests/<file>.test.js`, then `npm run validate` |
| Browser UI, extract parsing, workers, or download limits | Run `npm run validate` and `npm run test:browser`; preserve 100,000-row responsiveness, cancellation, and bounded output |
| Receipt generation or inspection | Add compatibility coverage for every affected published profile; run core and browser validation |
| Bundled edge-case contract | Change the canonical Health Data Edge Cases catalogue first, then vendor its versioned generated artifact; never hand-edit the bundled JSON or browser module |

`npm run validate` runs deterministic domain and receipt tests, contract digest
and provenance checks, JavaScript syntax and interface checks, and publication
and network-boundary scans. The browser gate covers all four analysis tools
plus receipt inspection, every public route's axe WCAG 2 A/AA checks, and the
larger extract-audit path. Automated accessibility checks do not replace manual
keyboard and assistive-technology review.

Site changes after a published version require a toolkit version bump and
consistent release/receipt metadata; CI checks this. Discuss that scope with
the maintainer when opening the PR. Documentation-only changes do not require
a site version bump.

## Before submitting

Explain the problem, resulting behavior, and checks actually run. For a bug,
include a minimal synthetic example and the expected result. State any changed
calculation assumption in the interface and documentation.

- Follow [PUBLICATION_POLICY.md](PUBLICATION_POLICY.md): no patient or employer
  data, confidential material, licensed definitions, vendor schemas, or content
  copied or transformed from protected sources.
- Keep file processing local. Do not introduce telemetry, authentication, or
  remote data storage.
- Keep calculations explicit. Add complexity only when it changes a decision
  or prevents a material error.
- Preserve the extract-receipt privacy boundary. Version incompatible receipt
  fields; do not reinterpret an older profile, widen accepted JSON, or describe
  an unkeyed digest as authentication.
- Treat outputs as decision support, not certified submissions or clinical advice.

By contributing, you agree that your contribution is licensed under Apache 2.0.
