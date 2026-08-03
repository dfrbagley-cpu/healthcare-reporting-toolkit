# Changelog

All notable changes to this project are documented here.

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

[0.5.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.5.0
[0.4.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.4.0
[0.3.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.3.0
[0.2.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.2.0
[0.1.0]: https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit/releases/tag/v0.1.0
