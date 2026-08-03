# Receipt Inspector and Replay

The inspector answers a deliberately narrow question:

> Is this published toolkit receipt internally consistent, and do any source
> files I selected match the fingerprints recorded in it?

All parsing, replay, and hashing happen in the browser. No receipt or source
file is uploaded.

## Inspect a receipt

Open the live toolkit, choose **Receipts**, and select an analysis-receipt JSON
file. The inspector accepts at most 256 KB and parses strict UTF-8 JSON. It
rejects duplicate object members, byte-order marks, malformed encodings,
trailing data, excessive nesting, unsupported fields, and profiles that do not
match a published release.

Published compatibility is explicit:

| Toolkit receipt | Supported tools | Conformance catalog |
|---|---|---|
| 0.2.0 | Reporting Window, Extract Auditor, Capacity Planner | Not applicable |
| 0.3.0 | All four tools | Edge Cases 0.2.0 |
| 0.4.0 | All four tools | Edge Cases 0.2.0 |
| 0.5.0 | All four tools | Edge Cases 0.4.0 |

The receipt schema remains 1.0.0. Release profiles add the exact assumptions,
provenance, and tool-specific invariants needed to interpret that envelope.

## Understand the three checks

1. **Structure** checks the exact fields, metadata, assumptions, source roles,
   bounds, and cross-field invariants for the declared release and tool.
2. **Calculation digest** rebuilds the published calculation core and compares
   its SHA-256 digest with the recorded value. `$schema`,
   `calculation_digest`, and `generated_at` are outside digest coverage.
3. **Replay** recalculates Reporting Window and Waitlist Capacity outputs from
   normalized inputs and compares the outputs and warnings exactly. Extract
   and conformance receipts omit the detailed data required for replay, so the
   interface reports replay as unavailable rather than guessing.

The synthetic example demonstrates a current Reporting Window receipt without
requiring a file.

## Verify optional source files

Extract and conformance receipts contain two source fingerprints. After the
receipt passes structural validation, the inspector reveals the corresponding
local file inputs:

- baseline and current extracts: 10 MB each;
- actual metrics and actual quality results: 1 MB each.

For each selected file, the inspector compares its exact byte count and
SHA-256 digest. Filenames and file contents are not part of the receipt and are
not returned by the verification engine. Line endings, encoding, or any other
byte change will produce a mismatch even when parsed values look equivalent.

## Interpret the result

“Internally consistent” means the receipt conforms to its declared published
profile, its recorded digest matches a fresh local recalculation, and any
supported deterministic replay agrees. Unselected source files do not make an
otherwise consistent receipt fail; they remain visibly unverified. A selected
source mismatch is reported as non-green.

This result is not authentication. SHA-256 here is an unkeyed fingerprint, and
anyone can construct a new receipt with a matching recalculated digest. The
inspector does not prove identity, authorship, approval, source origin,
appropriateness, or creation time.
