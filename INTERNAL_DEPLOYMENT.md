# Internal deployment guide

The Healthcare Reporting Toolkit is a static browser application. The release
ZIP is intended for an organization-controlled HTTPS web server; it has no
backend, database, account system, telemetry, or runtime package dependency.

This guide does not approve the toolkit for sensitive data. Complete local
privacy, security, retention, accessibility, change-control, and approved-
software review before operational use.

## 1. Pin and verify one release

Download exactly these three assets from one GitHub Release:

- `healthcare-reporting-toolkit-vX.Y.Z.zip`
- `healthcare-reporting-toolkit-vX.Y.Z-provenance.json`
- `SHA256SUMS`

Use only a published release whose tag, provenance, checksums, and exact asset
set are present. GitHub release immutability is an additional recommended
repository control because it locks the associated tag and assets after
publication; the package remains independently verifiable when that setting is
not available.

Verify both listed hashes before extracting the ZIP:

```bash
sha256sum --check SHA256SUMS
```

On Windows PowerShell, compare each value in `SHA256SUMS` with:

```powershell
Get-FileHash .\healthcare-reporting-toolkit-vX.Y.Z.zip -Algorithm SHA256
Get-FileHash .\healthcare-reporting-toolkit-vX.Y.Z-provenance.json -Algorithm SHA256
```

Record the release tag, source commit, ZIP hash, approval, deployment date, and
rollback owner in local change control. The provenance file and the
`RELEASE_MANIFEST.json` inside the ZIP identify the source commit and hashes of
every packaged file.

## 2. Serve it over internal HTTPS

Extract the ZIP and publish the contents of its single versioned directory as
the web root. Do not open `index.html` with a `file:///` URL: JavaScript modules
and the same-origin comparison worker require an HTTP origin, and local-file
behavior is not a supported security boundary.

Use an organization-managed hostname and TLS certificate. Redirect HTTP to
HTTPS. Configure these MIME types if the server does not supply them correctly:

| Extension | MIME type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.js` | `text/javascript; charset=utf-8` |
| `.json` | `application/json; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.csv` | `text/csv; charset=utf-8` |

Recommended response headers are:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; worker-src 'self'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Enable HSTS only after confirming every affected hostname is HTTPS-ready. Do
not weaken `connect-src 'none'` or add third-party scripts, fonts, analytics, or
content-delivery dependencies without a new security review.

## 3. Validate before making it available

From the tagged source commit, run:

```bash
npm ci --ignore-scripts
npm run validate
npm run test:browser
```

In the deployed environment, confirm that every route opens, the synthetic
Extract Change Auditor example completes, the Receipt Inspector accepts its
downloaded receipt, and browser developer tools show no external network
requests. Retain the validation result with the deployment record.

## 4. Data lifecycle in the browser

Selected files are held only by the current browser tab. They are not uploaded
or written to browser storage by the toolkit, but file references, filenames,
results, and generated download data remain in tab memory until cleared.

- Use **Clear selected data** after each Extract Change Auditor or Reporting
  Results Checker session.
- Use **Clear** after Receipt Inspector work.
- Close the tab as an additional end-of-session control, especially on a shared
  workstation.
- Treat downloaded change logs and diagnostics as having the same sensitivity
  as their source data. Store or delete them under local policy.
- Do not rely on browser clearing as a substitute for endpoint, screen-lock,
  download-folder, backup, or retention controls.

Clearing removes native file selections, rendered details, generated-download
references, and other data held by the application, and invalidates unfinished
work so a stale completion cannot restore it. It is not secure memory erasure:
the browser controls garbage collection, and an already-started browser read or
digest may retain bytes briefly before it settles. Close the tab—and, where
local policy requires stronger session isolation, the browser—after clearing.

## 5. Upgrade and rollback

Deploy each approved version to a new immutable versioned directory. Switch the
internal route only after validation; do not overwrite the last approved
directory. Keep the previous version and its three verified release assets for
the locally approved rollback period.

Rollback means repointing the route to the previous verified directory, then
recording the reason and validation result. Analysis receipts declare their
toolkit version, and the Receipt Inspector preserves published compatibility;
do not relabel an older directory as a newer release.
