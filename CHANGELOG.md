# Changelog

All notable changes to this project are documented here.

## [0.8.0] - 2026-09-07

- Add explicit Synthetic and Open modes to the monthly report check, with file, settings, coverage, and result reset on mode changes.
- Add a complete independently invented dataset: 1,000 events per snapshot, 250 patient tokens, three sites/programs, retained versions, downloadable CSVs, database SQL, a profile, and expected results.
- Populate actual file controls from the synthetic catalog or accept downloaded files through the normal drive picker. Verify synthetic snapshot bytes before labeling results synthetic.
- Preserve prior receipt profiles and reject stale worker results after mode changes.

## [0.7.0] - 2026-09-07

- Add monthly report checks with reusable profiles, explicit column mappings, preflight checks, and coverage confirmation.
- Account for changed eligible event counts with mutually exclusive contributions and bounded exports.
- Keep checks in a cancellable worker and preserve all published receipt profiles.

## [0.6.1] - 2026-09-02

### Added

- A 60-second synthetic Extract Change Auditor quickstart and a direct local
  audit call to action on the public landing page.
- Structured workflow and problem feedback forms with mandatory publication-
  boundary confirmations for PHI, confidential, licensed, and proprietary
  material.

### Changed

- Made the Extract Change Auditor the toolkit's public front door while
  preserving all four analysis tools and the Receipt Inspector and Replay.
- Updated sharing metadata and the social card around the local CSV-change
  workflow.
- Updated the bundled Health Data Edge Cases catalog from v0.4.0 to v0.5.1,
  retaining all five cases and 72 expectations.
- Preserved explicit Edge Cases v0.2.0 and v0.4.0 identities when inspecting
  historical Toolkit receipts; only new v0.6.1 conformance receipts use Edge
  Cases v0.5.1.

### Unchanged

- Receipt schema version 1.0.0, local-only processing, no telemetry or uploads,
  and the calculation semantics of the four analysis tools.

## [0.6.0] - 2026-09-01

### Added

- Explicit **Clear selected data** controls for the Extract Change Auditor and
  Reporting Results Checker, including stale asynchronous-work invalidation and
  complete in-tab result cleanup.
- A deterministic, fixed-timestamp self-host ZIP with an embedded per-file
  release manifest, plus separate provenance JSON and `SHA256SUMS` release
  assets.
- Byte-for-byte extraction and repeat-build determinism tests for the
  operational release package.
- Internal HTTPS deployment, security-header, MIME-type, verification,
  rollback, version-pinning, and browser-memory guidance.
- A generic public-repository publication policy that keeps relationship-
  specific boundary configuration outside the public project.

### Changed

- Release automation now refuses deployable site changes that reuse a
  published version, anchors published identity to release provenance and its
  tag, verifies the exact quality-tested main commit, and creates or verifies
  exactly three durable release assets idempotently.
- The Receipt Inspector recognizes 0.6.0 receipts while preserving every
  published 0.2.0 through 0.5.0 profile.

## [0.5.0] - 2026-08-03

### Added

- A local-only Receipt Inspector for strict, bounded analysis-receipt import.
- Calculation-digest recalculation with explicit disclosure of the three
  top-level fields outside digest coverage.
- Deterministic replay for Reporting Window and Waitlist Capacity receipts,
  including detection of altered outputs even after a digest is recomputed.
- Optional exact-byte and SHA-256 source verification for Extract Auditor and
  Reporting Results receipts without uploading, persisting, or copying source
  content into the result.
- Compatibility profiles for every published receipt format from toolkit
  versions 0.2.0 through 0.5.0.
- Complete Chrome journeys and automated WCAG 2 A/AA checks across the public
  toolkit routes.

### Changed

- Updated the bundled Health Data Edge Cases catalog from v0.2.0 to v0.4.0,
  retaining all five cases and 72 expectations with stronger input contracts.
- Expanded the browser gate from the 100,000-row auditor path to all four tools
  plus receipt inspection while preserving responsiveness and cancellation
  coverage.
- Clarified that a receipt can be internally consistent without proving
  authenticity, authorship, approval, source origin, or creation time.

### Unchanged

- Receipt schema version 1.0.0 and the calculation semantics of the four
  existing tools remain compatible with their published releases.

## [0.4.0] - 2026-07-26

### Added

- Same-origin module-worker execution for the Extract Change Auditor.
- Visible comparison progress, immediate cancellation, and stale-run protection.
- During-parse limits for physical rows, data rows, columns, and materialized cells.
- Bounded key-column configuration before main-thread tokenization.
- A 100,000-row production-site browser gate with a main-thread heartbeat.
- Browser coverage for cancellation, stale results, bounded previews, and formula-safe downloads.

### Changed

- Retain at most 100 material differences in the interface and no unchanged row details.
- Infer column types incrementally instead of allocating full per-column value copies.
- Build detailed CSV output in bounded chunks and refuse complete downloads above 250,000 rows or 48 MB.
- Keep aggregate counts complete when a detailed download exceeds its safety limit.
- Render composite keys as collision-free JSON arrays in previews and downloads.
- Omit the dictionary-guessable key-column digest from extract receipts; receipts retain only the key-column count and document that the configuration must be preserved separately.
- Permit only same-origin workers in the Content Security Policy; network access remains disabled.

## [0.3.0] - 2026-07-26

### Added

- Local-only Reporting Results Checker for external metric and quality CSV exports.
- Versioned Health Data Edge Cases v0.2.0 catalog with byte, digest, and generated-module parity checks.
- Deterministic missing, unexpected, and incorrect-value diagnostics.
- Matching and deliberately failing synthetic examples for every bundled case.
- Formula-safe detailed diagnostic exports and privacy-safe aggregate receipts.
- Five-minute fail → diagnose → correct tutorial.

### Changed

- Expanded the responsive overview and navigation from three tools to four.
- Added strict CSV parsing options for exact headers and non-ragged result rows.
- Extended analysis-receipt metadata for conformance sources and results.

## [0.2.0] - 2026-07-25

### Added

- Versioned, canonical JSON analysis receipts for all three tools.
- Deterministic calculation digests and explicit assumption, warning, tool, and release metadata.
- Local SHA-256 source fingerprints for extract audits.
- A published JSON Schema for the analysis-receipt contract.
- Privacy regression tests proving extract receipts omit filenames, headers, row keys, and cell values.

## [0.1.0] - 2026-07-23

### Added

- Reporting Window Builder for fiscal, rolling, custom, and like-for-like periods.
- Extract Change Auditor for local CSV schema and record comparison.
- Waitlist Capacity Planner with transparent queue assumptions and scenario comparison.
- Deterministic unit tests, repository-boundary checks, and GitHub Pages deployment.
- Correct fiscal labels for current and comparison periods, including explicit leap-day warnings.
- Sustainable capacity guidance that cannot bank unused prior capacity.
- Strict UTF-8 CSV loading, malformed-quote rejection, and stale-result invalidation.
- Canonical sharing metadata, a privacy-safe social card, and explicit project attribution.

[0.6.1]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.6.1
[0.6.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.6.0
[0.5.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.5.0
[0.4.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.4.0
[0.3.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.3.0
[0.2.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.2.0
[0.1.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.1.0

[0.7.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.7.0

[0.8.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.8.0
