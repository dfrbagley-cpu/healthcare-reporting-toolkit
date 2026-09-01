import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildOperationalRelease,
  collectPayload
} from "../scripts/build-operational-release.mjs";
import {
  FIXED_ARCHIVE_TIMESTAMP,
  readStoredZipEntries,
  sha256Hex
} from "../scripts/lib/deterministic-zip.mjs";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  ".."
);
test("operational release is deterministic and extracts byte-for-byte", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "toolkit-release-test-"));
  const firstDirectory = join(temporaryRoot, "first");
  const secondDirectory = join(temporaryRoot, "second");
  try {
    const source = await createSourceFixture(temporaryRoot);
    const first = await buildOperationalRelease({
      commit: source.commit,
      outputDirectory: firstDirectory,
      rootDirectory: source.root
    });
    const second = await buildOperationalRelease({
      commit: source.commit,
      outputDirectory: secondDirectory,
      rootDirectory: source.root
    });

    assert.deepEqual(first.outputFiles, [
      "healthcare-reporting-toolkit-v0.6.0.zip",
      "healthcare-reporting-toolkit-v0.6.0-provenance.json",
      "SHA256SUMS"
    ]);
    for (const filename of first.outputFiles) {
      assert.deepEqual(
        await readFile(join(firstDirectory, filename)),
        await readFile(join(secondDirectory, filename)),
        `${filename} must be byte-identical across repeated builds`
      );
    }

    const zipBytes = await readFile(join(firstDirectory, first.zipName));
    const zipEntries = readStoredZipEntries(zipBytes);
    const payload = await collectPayload(source.root);
    assert.equal(zipEntries.size, payload.length + 1);
    for (const file of payload) {
      const archivePath = `${first.archiveRoot}/${file.path}`;
      assert.deepEqual(
        zipEntries.get(archivePath),
        file.data,
        `${archivePath} must extract to the exact source bytes`
      );
    }

    const manifestPath = `${first.archiveRoot}/RELEASE_MANIFEST.json`;
    const manifestBytes = zipEntries.get(manifestPath);
    assert.ok(manifestBytes, "ZIP must contain RELEASE_MANIFEST.json");
    assert.deepEqual(manifestBytes, first.manifestBytes);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    assert.equal(manifest.version, "0.6.0");
    assert.equal(manifest.source_commit, source.commit);
    assert.equal(manifest.archive_timestamp, FIXED_ARCHIVE_TIMESTAMP);
    assert.equal(manifest.entrypoint, "index.html");
    assert.deepEqual(
      manifest.content_files,
      payload.map((file) => ({
        byte_count: file.data.length,
        path: file.path,
        sha256: sha256Hex(file.data)
      }))
    );

    const provenanceBytes = await readFile(
      join(firstDirectory, first.provenanceName)
    );
    const provenance = JSON.parse(provenanceBytes.toString("utf8"));
    assert.equal(provenance.version, "0.6.0");
    assert.equal(provenance.source.commit, source.commit);
    assert.equal(
      provenance.source.repository,
      "https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit"
    );
    assert.equal(provenance.artifact.name, first.zipName);
    assert.equal(provenance.artifact.sha256, sha256Hex(zipBytes));
    assert.equal(provenance.artifact.byte_count, zipBytes.length);
    assert.equal(provenance.build.archive_timestamp, FIXED_ARCHIVE_TIMESTAMP);
    assert.equal(provenance.build.reproducible, true);
    assert.equal(
      provenance.release_manifest.sha256,
      sha256Hex(manifestBytes)
    );

    const checksumLines = (
      await readFile(join(firstDirectory, "SHA256SUMS"), "utf8")
    ).trimEnd().split("\n");
    assert.deepEqual(checksumLines, [
      `${sha256Hex(zipBytes)}  ${first.zipName}`,
      `${sha256Hex(provenanceBytes)}  ${first.provenanceName}`
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("operational release rejects ambiguous inputs", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "toolkit-release-input-"));
  try {
    const source = await createSourceFixture(temporaryRoot);
    await assert.rejects(
      buildOperationalRelease({
        commit: "not-a-commit",
        outputDirectory: join(temporaryRoot, "invalid"),
        rootDirectory: source.root
      }),
      /40-character Git commit SHA/
    );
    await assert.rejects(
      buildOperationalRelease({
        commit: source.commit,
        outputDirectory: join(temporaryRoot, "invalid-repository"),
        repositoryUrl: "http://example.test/owner/repository",
        rootDirectory: source.root
      }),
      /Repository URL must be an HTTPS owner\/repository URL/
    );

    const outputDirectory = join(temporaryRoot, "occupied");
    await buildOperationalRelease({
      commit: source.commit,
      outputDirectory,
      rootDirectory: source.root
    });
    await assert.rejects(
      buildOperationalRelease({
        commit: source.commit,
        outputDirectory,
        rootDirectory: source.root
      }),
      /output directory must be empty/
    );

    await writeFile(
      join(source.root, "site", "robots.txt"),
      "\n# uncommitted release input\n",
      { flag: "a" }
    );
    await assert.rejects(
      buildOperationalRelease({
        commit: source.commit,
        outputDirectory: join(temporaryRoot, "dirty"),
        rootDirectory: source.root
      }),
      /Release payload does not match checked-out commit/
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function createSourceFixture(temporaryRoot) {
  const root = join(temporaryRoot, "source");
  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await cp(join(projectRoot, "site"), join(root, "site"), { recursive: true });
  for (const path of [
    "INTERNAL_DEPLOYMENT.md",
    "LICENSE",
    "NOTICE",
    "PUBLICATION_POLICY.md",
    "README.md",
    "SECURITY.md",
    "package.json",
    "scripts/build-operational-release.mjs",
    "scripts/lib/deterministic-zip.mjs"
  ]) {
    await cp(join(projectRoot, path), join(root, path));
  }

  const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_AUTHOR_EMAIL: "release-test@example.invalid",
    GIT_AUTHOR_NAME: "Release Test",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_EMAIL: "release-test@example.invalid",
    GIT_COMMITTER_NAME: "Release Test"
  };
  runFixtureGit(root, gitEnvironment, ["init", "--quiet"]);
  runFixtureGit(root, gitEnvironment, ["add", "."]);
  runFixtureGit(root, gitEnvironment, [
    "commit",
    "--quiet",
    "--message",
    "fixture"
  ]);
  return {
    commit: runFixtureGit(root, gitEnvironment, ["rev-parse", "HEAD"]).trim(),
    root
  };
}

function runFixtureGit(root, environment, argumentsList) {
  return execFileSync("git", argumentsList, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
}
