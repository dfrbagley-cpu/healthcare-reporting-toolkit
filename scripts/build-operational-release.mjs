import { spawnSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDeterministicZip,
  FIXED_ARCHIVE_TIMESTAMP,
  sha256Hex,
  stableJsonBuffer
} from "./lib/deterministic-zip.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const defaultSourceRepository =
  "https://github.com/dfrbagley-cpu/healthcare-reporting-toolkit";
const rootPayloadFiles = [
  "INTERNAL_DEPLOYMENT.md",
  "LICENSE",
  "NOTICE",
  "PUBLICATION_POLICY.md",
  "README.md",
  "SECURITY.md"
];

export async function buildOperationalRelease({
  commit,
  outputDirectory,
  repositoryUrl = defaultSourceRepository,
  rootDirectory = projectRoot
}) {
  assertCommit(commit);
  assertRepositoryUrl(repositoryUrl);
  const root = resolve(rootDirectory);
  verifySourceCommit(root, commit);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const existing = await readdir(output);
  if (existing.length !== 0) {
    throw new Error("Release output directory must be empty.");
  }

  const packageMetadata = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  );
  const version = packageMetadata.version;
  assertVersion(version);
  const archiveRoot = `healthcare-reporting-toolkit-v${version}`;
  const payload = await collectPayload(root);
  const contentFiles = payload.map((file) => ({
    byte_count: file.data.length,
    path: file.path,
    sha256: sha256Hex(file.data)
  }));
  const releaseManifest = {
    archive_root: archiveRoot,
    archive_timestamp: FIXED_ARCHIVE_TIMESTAMP,
    content_files: contentFiles,
    entrypoint: "index.html",
    manifest_scope: "Packaged files excluding RELEASE_MANIFEST.json",
    product: "Healthcare Reporting Toolkit",
    schema_version: "1.0.0",
    source_commit: commit,
    source_repository: repositoryUrl,
    version
  };
  const manifestBytes = stableJsonBuffer(releaseManifest);
  const zipBytes = createDeterministicZip([
    ...payload.map((file) => ({
      path: `${archiveRoot}/${file.path}`,
      data: file.data
    })),
    {
      path: `${archiveRoot}/RELEASE_MANIFEST.json`,
      data: manifestBytes
    }
  ]);

  const zipName = `healthcare-reporting-toolkit-v${version}.zip`;
  const provenanceName =
    `healthcare-reporting-toolkit-v${version}-provenance.json`;
  const zipDigest = sha256Hex(zipBytes);
  const provenance = {
    artifact: {
      byte_count: zipBytes.length,
      name: zipName,
      sha256: zipDigest
    },
    build: {
      archive_timestamp: FIXED_ARCHIVE_TIMESTAMP,
      builder: "scripts/build-operational-release.mjs",
      dependency_free: true,
      reproducible: true
    },
    product: "Healthcare Reporting Toolkit",
    release_manifest: {
      archive_path: `${archiveRoot}/RELEASE_MANIFEST.json`,
      sha256: sha256Hex(manifestBytes)
    },
    schema_version: "1.0.0",
    source: {
      commit,
      repository: repositoryUrl
    },
    version
  };
  const provenanceBytes = stableJsonBuffer(provenance);
  const checksumBytes = Buffer.from(
    `${zipDigest}  ${zipName}\n` +
      `${sha256Hex(provenanceBytes)}  ${provenanceName}\n`,
    "utf8"
  );

  await Promise.all([
    writeFile(join(output, zipName), zipBytes),
    writeFile(join(output, provenanceName), provenanceBytes),
    writeFile(join(output, "SHA256SUMS"), checksumBytes)
  ]);

  return {
    archiveRoot,
    contentFiles,
    manifestBytes,
    outputFiles: [zipName, provenanceName, "SHA256SUMS"],
    provenance,
    provenanceName,
    version,
    zipName
  };
}

export async function collectPayload(rootDirectory = projectRoot) {
  const root = resolve(rootDirectory);
  const siteRoot = join(root, "site");
  const siteFiles = await walkFiles(siteRoot);
  const mappings = [
    ...siteFiles.map((path) => ({
      archivePath: toArchivePath(relative(siteRoot, path)),
      sourcePath: path
    })),
    ...rootPayloadFiles.map((path) => ({
      archivePath: path,
      sourcePath: join(root, path)
    }))
  ];
  mappings.sort((left, right) =>
    left.archivePath < right.archivePath
      ? -1
      : left.archivePath > right.archivePath
        ? 1
        : 0
  );

  return Promise.all(
    mappings.map(async ({ archivePath, sourcePath }) => {
      const status = await lstat(sourcePath);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new Error(`Release payload must contain only regular files: ${sourcePath}`);
      }
      return {
        data: await readFile(sourcePath),
        path: archivePath
      };
    })
  );
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in the release payload: ${path}`);
    }
    if (entry.isDirectory()) {
      paths.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      paths.push(path);
    } else {
      throw new Error(`Unsupported release payload entry: ${path}`);
    }
  }
  return paths;
}

function toArchivePath(path) {
  return sep === "/" ? path : path.split(sep).join("/");
}

function assertVersion(version) {
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  ) {
    throw new Error(`Operational releases require a stable semantic version: ${version}`);
  }
}

function assertCommit(commit) {
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("--commit must be a lowercase 40-character Git commit SHA.");
  }
}

function assertRepositoryUrl(repositoryUrl) {
  if (
    typeof repositoryUrl !== "string" ||
    !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
      repositoryUrl
    )
  ) {
    throw new Error("Repository URL must be an HTTPS owner/repository URL.");
  }
}

function verifySourceCommit(root, commit) {
  const topLevel = runGit(root, ["rev-parse", "--show-toplevel"]).trim();
  if (resolve(topLevel) !== root) {
    throw new Error("Release root must be the top level of its Git worktree.");
  }
  const head = runGit(root, ["rev-parse", "HEAD"]).trim();
  if (head !== commit) {
    throw new Error(`Release commit ${commit} does not match checked-out HEAD ${head}.`);
  }

  const verifiedPaths = [
    "package.json",
    ...rootPayloadFiles,
    "site",
    "scripts/build-operational-release.mjs",
    "scripts/lib/deterministic-zip.mjs"
  ];
  const diff = spawnSync(
    "git",
    ["diff", "--quiet", commit, "--", ...verifiedPaths],
    { cwd: root, encoding: "utf8" }
  );
  if (diff.error || (diff.status !== 0 && diff.status !== 1)) {
    throw new Error(
      `Could not verify release payload against ${commit}: ${diff.error?.message ?? diff.stderr.trim()}`
    );
  }
  if (diff.status === 1) {
    throw new Error(`Release payload does not match checked-out commit ${commit}.`);
  }
  const untracked = runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...verifiedPaths
  ]).trim();
  if (untracked) {
    throw new Error(`Release payload contains untracked files: ${untracked}`);
  }
}

function runGit(root, argumentsList) {
  const result = spawnSync("git", argumentsList, {
    cwd: root,
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Git source verification failed: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return result.stdout;
}

function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (
      !["--commit", "--output-dir", "--repository-url"].includes(name) ||
      value === undefined ||
      values.has(name)
    ) {
      throw new Error(
        "Expected unique --commit, --output-dir, and optional --repository-url arguments."
      );
    }
    values.set(name, value);
  }
  const commit = values.get("--commit") ?? process.env.GITHUB_SHA;
  const outputDirectory = values.get("--output-dir");
  const repositoryUrl =
    values.get("--repository-url") ??
    (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
      : defaultSourceRepository);
  if (!outputDirectory) {
    throw new Error(
      "Usage: npm run package:release -- --commit SHA --output-dir PATH [--repository-url URL]"
    );
  }
  return { commit, outputDirectory, repositoryUrl };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const result = await buildOperationalRelease(parseArguments(process.argv.slice(2)));
    console.log(
      `Built ${result.outputFiles.length} operational release assets for v${result.version}: ${result.outputFiles.join(", ")}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
