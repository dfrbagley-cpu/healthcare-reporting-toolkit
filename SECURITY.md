# Security policy

## Supported version

Security fixes are applied to the latest release.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting feature under **Security →
Advisories** when it is available. If that option is unavailable, open a
minimal public issue asking the maintainer to establish private contact; do not
include exploit details, sensitive data, or personal health information.

## Data handling

The published application is static. CSV files are parsed in the browser and
are not uploaded by the toolkit. The site has no analytics, account system,
server-side storage, or network API.

Extract analysis receipts include SHA-256 source fingerprints and aggregate
metadata, but exclude filenames, headers, row keys, and cell values. A hash is
not anonymization and does not prove who supplied a file or when it existed.
The separate change-log CSV contains row-level differences and can retain the
sensitivity of the source extracts. Review all downloaded artifacts before
storing or sharing them.

Users should still follow their organization's privacy, security, retention,
and data-handling policies. Inspect the source and deployment before using any
local copy with sensitive information.
