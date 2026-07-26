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

## Design principles

- Prefer transparent calculations over hidden heuristics.
- Keep file processing local to the browser.
- Add complexity only when it changes a decision or prevents a material error.
- Do not add authentication, telemetry, or remote data storage.
- Treat outputs as decision support, not certified submissions or clinical advice.

By contributing, you agree that your contribution is licensed under Apache
License 2.0.
