import {
  parseCsvRows
} from "../lib/csv.js";
import { sha256Hex } from "../lib/analysis-receipt.js";
import {
  auditExtractTables
} from "../tools/extract-auditor.js";
import {
  EXTRACT_FILE_MAX_BYTES,
  EXTRACT_MAX_DATA_ROWS,
  EXTRACT_MAX_PHYSICAL_ROWS,
  EXTRACT_MAX_COLUMNS,
  EXTRACT_MAX_CELLS
} from "../tools/extract-auditor-limits.js";

export async function runExtractAuditJob({
  baselineFile,
  currentFile,
  keyColumns,
  trimWhitespace,
  onProgress
}) {
  const baseline = await loadExtract({
    file: baselineFile,
    label: "baseline",
    rangeStart: 0,
    rangeEnd: 0.2,
    onProgress
  });
  const current = await loadExtract({
    file: currentFile,
    label: "current",
    rangeStart: 0.2,
    rangeEnd: 0.4,
    onProgress
  });
  const { audit, changeLogBlob } = auditExtractTables({
    baseline: baseline.table,
    current: current.table,
    keyColumns,
    trimWhitespace,
    onProgress: ({ phase, fraction }) => {
      emitProgress(onProgress, phase, 0.4 + fraction * 0.6);
    }
  });

  return {
    audit,
    evidence: {
      baseline: baseline.evidence,
      current: current.evidence
    },
    changeLogBlob
  };
}

async function loadExtract({
  file,
  label,
  rangeStart,
  rangeEnd,
  onProgress
}) {
  if (
    !file ||
    typeof file.size !== "number" ||
    typeof file.arrayBuffer !== "function"
  ) {
    throw new TypeError(`Select a ${label} CSV file.`);
  }
  if (file.size > EXTRACT_FILE_MAX_BYTES) {
    throw new Error(
      `The ${label} file is larger than the 10 MB limit.`
    );
  }

  const span = rangeEnd - rangeStart;
  emitProgress(onProgress, `Reading ${label} file`, rangeStart);
  let bytes = await file.arrayBuffer();
  emitProgress(
    onProgress,
    `Fingerprinting ${label} file`,
    rangeStart + span * 0.12
  );
  const hash = await sha256Hex(bytes);
  emitProgress(
    onProgress,
    `Decoding ${label} file`,
    rangeStart + span * 0.22
  );

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      `The ${label} file is not valid UTF-8 text.`
    );
  } finally {
    bytes = null;
  }

  const table = parseCsvRows(text, {
    maxRows: EXTRACT_MAX_DATA_ROWS,
    maxPhysicalRows: EXTRACT_MAX_PHYSICAL_ROWS,
    maxColumns: EXTRACT_MAX_COLUMNS,
    maxCells: EXTRACT_MAX_CELLS,
    onProgress: ({ fraction }) => {
      emitProgress(
        onProgress,
        `Parsing ${label} file`,
        rangeStart + span * (0.25 + fraction * 0.75)
      );
    }
  });
  text = null;

  return {
    table,
    evidence: {
      sha256: hash,
      byteCount: file.size,
      rowCount: table.rows.length,
      columnCount: table.headers.length
    }
  };
}

function emitProgress(onProgress, phase, fraction) {
  if (typeof onProgress === "function") {
    onProgress({
      phase,
      fraction: Math.max(0, Math.min(1, fraction))
    });
  }
}
