# Contributing

Contributions that make the calculations clearer, safer, or easier to verify
are welcome.

## Before opening a pull request

1. Open an issue describing the reporting problem or edge case.
2. Keep examples synthetic and independent of employer, vendor, or proprietary
   specifications.
3. Add tests that state the expected result.
4. Run `npm run validate`.
5. Explain any changed assumption in the user interface and documentation.
6. Version the receipt schema when a receipt field changes incompatibly, and
   preserve the extract-receipt privacy boundary.
7. Do not edit the bundled edge-case catalog or browser module by hand. Update
   the canonical catalog in Health Data Edge Cases, then run the vendoring
   script against that versioned generated artifact.
8. Changes to extract parsing, worker orchestration, or download limits must
   also pass `npm run test:browser` in Chrome and preserve the documented
   100,000-row responsiveness, cancellation, and bounded-output behavior.
9. Changes to receipt generation or inspection must add compatibility tests
   for every affected published profile. Do not silently reinterpret an older
   receipt, widen accepted JSON, or describe an unkeyed digest as authentication.

## Design principles

- Prefer transparent calculations over hidden heuristics.
- Keep file processing local to the browser.
- Keep expected conformance contracts synthetic, versioned, and owned by the
  companion edge-case repository.
- Add complexity only when it changes a decision or prevents a material error.
- Do not add authentication, telemetry, or remote data storage.
- Treat outputs as decision support, not certified submissions or clinical advice.

By contributing, you agree that your contribution is licensed under Apache
License 2.0.
