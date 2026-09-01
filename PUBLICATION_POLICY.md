# Public-repository publication policy

This repository is an independent, public project. Its source, examples,
documentation, tests, and release artifacts must be safe to inspect, copy, and
redistribute under the project licence.

## Allowed material

- Original public-project code and documentation.
- Synthetic examples created specifically for this repository.
- Public standards and public interfaces cited to their authoritative source.
- Third-party material whose licence permits redistribution and is recorded in
  `NOTICE` when required.

## Material that must not be published

- Employer, customer, patient, client, or partner data or identifiers.
- Names, links, code, specifications, architecture, or roadmaps from non-public
  products, repositories, systems, or engagements.
- Licensed reporting definitions, vendor schemas, or internal configuration.
- Credentials, tokens, private keys, connection strings, personal email
  addresses, or machine-specific workspace paths.
- Examples copied or transformed from protected data, even when direct
  identifiers have been removed.

## Required review before publication

1. Review the complete diff and the files that will be included in the commit
   or release artifact.
2. Confirm every example is synthetic and independently authored for this
   project.
3. Run `npm run validate` to apply the repository's generic secret, path, and
   publication checks.
4. Run any project-name or relationship-specific boundary scan from a separate,
   private configuration. Do not commit that configuration or its terms here.
5. Build the operational release package and confirm that only the documented
   public payload is present.
6. Enable GitHub release immutability when repository governance permits it.
   Whether or not it is available, retain the workflow's exact tagged-source
   rebuild, provenance, tag, and asset-byte checks.

The generic repository scan is a backstop, not proof that a publication is
safe. Contextual review remains mandatory because confidential relationships
and project names do not belong in this public repository, including inside a
denylist.

## Separation rule

Do not copy code, schemas, data, test fixtures, or design documents from a
non-public repository into this project. Public integrations, when added, must
depend only on documented public contracts and version-pinned public artifacts.
No private repository may be used as a submodule, package source, build input,
or release dependency.

## If a boundary failure is found

Stop publication, preserve the evidence needed to assess scope, and remove the
material from the pending change. If a credential or protected data was
published, rotate or revoke it and follow the responsible organization's
incident process. Rewriting public history is considered only after the actual
exposure and downstream impact are understood.
