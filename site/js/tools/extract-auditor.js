import {
  inferColumnType,
  inferTypeSet,
  inferValueType,
  stringifyCsvLine
} from "../lib/csv.js";
import {
  EXTRACT_MAX_COLUMNS
} from "./extract-auditor-limits.js";

export const AUDIT_PREVIEW_LIMIT = 100;
export const CHANGE_LOG_MAX_ROWS = 250_000;
export const CHANGE_LOG_MAX_BYTES = 48 * 1024 * 1024;

export function auditExtracts({
  baseline,
  current,
  keyColumns,
  trimWhitespace = true
}) {
  const keys = normalizeKeyColumns(keyColumns);

  for (const key of keys) {
    if (!baseline.headers.includes(key) || !current.headers.includes(key)) {
      throw new Error(`Key column "${key}" must exist in both extracts.`);
    }
  }

  const addedColumns = current.headers.filter(
    (header) => !baseline.headers.includes(header)
  );
  const removedColumns = baseline.headers.filter(
    (header) => !current.headers.includes(header)
  );
  const sharedColumns = baseline.headers.filter((header) =>
    current.headers.includes(header)
  );
  const comparedColumns = sharedColumns.filter(
    (header) => !keys.includes(header)
  );

  const baselineIndex = indexRecords(
    baseline.records,
    keys,
    trimWhitespace
  );
  const currentIndex = indexRecords(current.records, keys, trimWhitespace);
  const ambiguousKeys = new Set([
    ...baselineIndex.duplicateInternalKeys,
    ...currentIndex.duplicateInternalKeys
  ]);
  const candidateKeys = new Set([
    ...baselineIndex.unique.keys(),
    ...currentIndex.unique.keys()
  ]);

  const rowDiffs = [];
  for (const internalKey of [...candidateKeys].sort()) {
    if (ambiguousKeys.has(internalKey)) {
      continue;
    }
    const before = baselineIndex.unique.get(internalKey);
    const after = currentIndex.unique.get(internalKey);
    const displayKey = (before ?? after).displayKey;

    if (!before) {
      rowDiffs.push({
        key: displayKey,
        status: "added",
        changedColumns: [],
        changes: []
      });
      continue;
    }
    if (!after) {
      rowDiffs.push({
        key: displayKey,
        status: "removed",
        changedColumns: [],
        changes: []
      });
      continue;
    }

    const changes = comparedColumns
      .filter(
        (column) =>
          normalize(before.record[column], trimWhitespace) !==
          normalize(after.record[column], trimWhitespace)
      )
      .map((column) => ({
        column,
        before: before.record[column] ?? "",
        after: after.record[column] ?? ""
      }));

    rowDiffs.push({
      key: displayKey,
      status: changes.length > 0 ? "changed" : "unchanged",
      changedColumns: changes.map((change) => change.column),
      changes
    });
  }

  const typeChanges = comparedColumns
    .map((column) => ({
      column,
      before: inferColumnType(
        baseline.records.map((record) => record[column])
      ),
      after: inferColumnType(current.records.map((record) => record[column]))
    }))
    .filter(
      (change) =>
        change.before !== change.after &&
        change.before !== "empty" &&
        change.after !== "empty"
    );

  const summary = {
    baselineRows: baseline.records.length,
    currentRows: current.records.length,
    added: countStatus(rowDiffs, "added"),
    removed: countStatus(rowDiffs, "removed"),
    changed: countStatus(rowDiffs, "changed"),
    unchanged: countStatus(rowDiffs, "unchanged"),
    changedCells: rowDiffs.reduce(
      (total, difference) => total + difference.changes.length,
      0
    ),
    ambiguousKeys: ambiguousKeys.size,
    missingBaselineKeys: baselineIndex.missingKeys,
    missingCurrentKeys: currentIndex.missingKeys
  };

  const warnings = [];
  if (summary.ambiguousKeys > 0) {
    warnings.push(
      `${summary.ambiguousKeys} duplicated key value(s) were excluded because record-level comparison would be ambiguous.`
    );
  }
  if (summary.missingBaselineKeys + summary.missingCurrentKeys > 0) {
    warnings.push(
      `${summary.missingBaselineKeys + summary.missingCurrentKeys} row(s) with blank key fields were excluded.`
    );
  }
  if (comparedColumns.length === 0) {
    warnings.push(
      "The extracts share no non-key columns, so only added and removed records were compared."
    );
  }

  return {
    keyColumns: keys,
    addedColumns,
    removedColumns,
    sharedColumns,
    comparedColumns,
    typeChanges,
    duplicates: {
      baseline: baselineIndex.duplicates,
      current: currentIndex.duplicates
    },
    rowDiffs,
    summary,
    warnings
  };
}

export function auditRowsForCsv(audit) {
  const rows = [];
  for (const difference of audit.rowDiffs) {
    if (difference.status === "changed") {
      for (const change of difference.changes) {
        rows.push({
          key: difference.key,
          status: difference.status,
          column: change.column,
          before: change.before,
          after: change.after
        });
      }
    } else if (difference.status !== "unchanged") {
      rows.push({
        key: difference.key,
        status: difference.status,
        column: "",
        before: "",
        after: ""
      });
    }
  }
  return rows;
}

export function auditExtractTables({
  baseline,
  current,
  keyColumns,
  trimWhitespace = true,
  previewLimit = AUDIT_PREVIEW_LIMIT,
  changeLogMaxRows = CHANGE_LOG_MAX_ROWS,
  changeLogMaxBytes = CHANGE_LOG_MAX_BYTES,
  onProgress
}) {
  const keys = normalizeKeyColumns(keyColumns);
  validateTable(baseline, "Baseline");
  validateTable(current, "Current");
  validateNonNegativeLimit(previewLimit, "Preview limit");
  validateNonNegativeLimit(changeLogMaxRows, "Change-log row limit");
  validateNonNegativeLimit(changeLogMaxBytes, "Change-log byte limit");

  const baselineHeaderIndex = indexHeaders(baseline.headers);
  const currentHeaderIndex = indexHeaders(current.headers);
  for (const key of keys) {
    if (!baselineHeaderIndex.has(key) || !currentHeaderIndex.has(key)) {
      throw new Error(`Key column "${key}" must exist in both extracts.`);
    }
  }

  const addedColumns = current.headers.filter(
    (header) => !baselineHeaderIndex.has(header)
  );
  const removedColumns = baseline.headers.filter(
    (header) => !currentHeaderIndex.has(header)
  );
  const sharedColumns = baseline.headers.filter((header) =>
    currentHeaderIndex.has(header)
  );
  const comparedColumns = sharedColumns.filter(
    (header) => !keys.includes(header)
  );
  const baselineKeyIndexes = keys.map((key) =>
    baselineHeaderIndex.get(key)
  );
  const currentKeyIndexes = keys.map((key) =>
    currentHeaderIndex.get(key)
  );
  const baselineComparedIndexes = comparedColumns.map((column) =>
    baselineHeaderIndex.get(column)
  );
  const currentComparedIndexes = comparedColumns.map((column) =>
    currentHeaderIndex.get(column)
  );

  const baselineIndex = indexTableRows({
    table: baseline,
    keyIndexes: baselineKeyIndexes,
    typeIndexes: baselineComparedIndexes,
    trimWhitespace,
    onProgress: progressMapper(
      onProgress,
      "Indexing baseline extract",
      0,
      0.3
    )
  });
  const currentIndex = indexTableRows({
    table: current,
    keyIndexes: currentKeyIndexes,
    typeIndexes: currentComparedIndexes,
    trimWhitespace,
    onProgress: progressMapper(
      onProgress,
      "Indexing current extract",
      0.3,
      0.6
    )
  });

  const ambiguousKeys = new Set();
  for (const [internalKey, group] of baselineIndex.groups) {
    if (group.count > 1) {
      ambiguousKeys.add(internalKey);
    }
  }
  for (const [internalKey, group] of currentIndex.groups) {
    if (group.count > 1) {
      ambiguousKeys.add(internalKey);
    }
  }

  const candidateKeys = new Set([
    ...baselineIndex.groups.keys(),
    ...currentIndex.groups.keys()
  ]);
  const sortedKeys = [...candidateKeys].sort();
  const preview = [];
  const writer = createChangeLogWriter({
    maxRows: changeLogMaxRows,
    maxBytes: changeLogMaxBytes
  });
  const summary = {
    baselineRows: baseline.rows.length,
    currentRows: current.rows.length,
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
    changedCells: 0,
    ambiguousKeys: ambiguousKeys.size,
    missingBaselineKeys: baselineIndex.missingKeys,
    missingCurrentKeys: currentIndex.missingKeys
  };

  for (let keyIndex = 0; keyIndex < sortedKeys.length; keyIndex += 1) {
    if (keyIndex % 2_048 === 0 || keyIndex === sortedKeys.length - 1) {
      emitProgress(
        onProgress,
        "Comparing records",
        0.6 + 0.35 * fractionComplete(keyIndex, sortedKeys.length)
      );
    }

    const internalKey = sortedKeys[keyIndex];
    if (ambiguousKeys.has(internalKey)) {
      continue;
    }
    const before = baselineIndex.groups.get(internalKey);
    const after = currentIndex.groups.get(internalKey);
    const displayKey = (before ?? after).displayKey;

    if (!before) {
      summary.added += 1;
      recordMaterialDifference(
        {
          key: displayKey,
          status: "added",
          changedColumns: [],
          changes: []
        },
        preview,
        previewLimit,
        writer
      );
      continue;
    }
    if (!after) {
      summary.removed += 1;
      recordMaterialDifference(
        {
          key: displayKey,
          status: "removed",
          changedColumns: [],
          changes: []
        },
        preview,
        previewLimit,
        writer
      );
      continue;
    }

    const changes = [];
    for (
      let columnIndex = 0;
      columnIndex < comparedColumns.length;
      columnIndex += 1
    ) {
      const beforeValue =
        before.row[baselineComparedIndexes[columnIndex]] ?? "";
      const afterValue =
        after.row[currentComparedIndexes[columnIndex]] ?? "";
      if (
        normalize(beforeValue, trimWhitespace) !==
        normalize(afterValue, trimWhitespace)
      ) {
        changes.push({
          column: comparedColumns[columnIndex],
          before: beforeValue,
          after: afterValue
        });
      }
    }

    if (changes.length === 0) {
      summary.unchanged += 1;
      continue;
    }
    summary.changed += 1;
    summary.changedCells += changes.length;
    recordMaterialDifference(
      {
        key: displayKey,
        status: "changed",
        changedColumns: changes.map((change) => change.column),
        changes
      },
      preview,
      previewLimit,
      writer
    );
  }

  const typeChanges = comparedColumns
    .map((column, index) => ({
      column,
      before: inferTypeSet(baselineIndex.typeSets[index]),
      after: inferTypeSet(currentIndex.typeSets[index])
    }))
    .filter(
      (change) =>
        change.before !== change.after &&
        change.before !== "empty" &&
        change.after !== "empty"
    );
  const changeLog = writer.finish();
  const warnings = buildWarnings(summary, comparedColumns);
  if (!changeLog.available) {
    warnings.push(changeLog.reason);
  }
  emitProgress(onProgress, "Finalizing results", 1);

  return {
    audit: {
      keyColumns: keys,
      addedColumns,
      removedColumns,
      sharedColumns,
      comparedColumns,
      typeChanges,
      rowDiffs: preview,
      materialDifferenceCount:
        summary.added + summary.removed + summary.changed,
      summary,
      warnings,
      changeLog: {
        available: changeLog.available,
        rowCount: changeLog.rowCount,
        byteCount: changeLog.byteCount,
        reason: changeLog.reason
      }
    },
    changeLogBlob: changeLog.blob
  };
}

function normalizeKeyColumns(keyColumns) {
  if (!Array.isArray(keyColumns)) {
    throw new TypeError("Key columns must be provided as a list.");
  }
  const keys = keyColumns
    .map((column) => String(column).trim())
    .filter(Boolean);
  if (keys.length === 0) {
    throw new Error("Enter at least one key column.");
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error("Key columns must be unique.");
  }
  if (keys.length > EXTRACT_MAX_COLUMNS) {
    throw new Error(
      `Select no more than ${formatNumber(EXTRACT_MAX_COLUMNS)} key columns.`
    );
  }
  return keys;
}

function validateTable(table, label) {
  if (
    !table ||
    !Array.isArray(table.headers) ||
    !Array.isArray(table.rows)
  ) {
    throw new TypeError(`${label} extract is not a parsed CSV table.`);
  }
}

function indexHeaders(headers) {
  return new Map(headers.map((header, index) => [header, index]));
}

function indexTableRows({
  table,
  keyIndexes,
  typeIndexes,
  trimWhitespace,
  onProgress
}) {
  const groups = new Map();
  const typeSets = typeIndexes.map(() => new Set());
  let missingKeys = 0;

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    if (rowIndex % 2_048 === 0 || rowIndex === table.rows.length - 1) {
      onProgress(fractionComplete(rowIndex, table.rows.length));
    }
    const row = table.rows[rowIndex];
    const parts = keyIndexes.map((index) =>
      normalize(row[index], trimWhitespace)
    );
    if (parts.some((part) => part === "")) {
      missingKeys += 1;
    } else {
      const internalKey = JSON.stringify(parts);
      const existing = groups.get(internalKey);
      if (existing) {
        existing.count += 1;
      } else {
        groups.set(internalKey, {
          row,
          count: 1,
          displayKey: formatDisplayKey(parts)
        });
      }
    }

    for (let index = 0; index < typeIndexes.length; index += 1) {
      const value = String(row[typeIndexes[index]] ?? "").trim();
      if (value !== "") {
        typeSets[index].add(inferValueType(value));
      }
    }
  }

  return { groups, typeSets, missingKeys };
}

function recordMaterialDifference(
  difference,
  preview,
  previewLimit,
  writer
) {
  if (preview.length < previewLimit) {
    preview.push(difference);
  }
  writer.appendDifference(difference);
}

function createChangeLogWriter({ maxRows, maxBytes }) {
  const encoder = new TextEncoder();
  const parts = [];
  let chunk = `${stringifyCsvLine(
    ["key", "status", "column", "before", "after"],
    { protectFormulas: false }
  )}\r\n`;
  let byteCount = 0;
  let rowCount = 0;
  let available = true;
  let reason = "";

  const abort = (message) => {
    available = false;
    reason = message;
    parts.length = 0;
    chunk = "";
    byteCount = 0;
  };
  const flush = () => {
    if (!available || chunk === "") {
      return;
    }
    const chunkBytes = encoder.encode(chunk).byteLength;
    if (byteCount + chunkBytes > maxBytes) {
      abort(
        `The complete change log exceeds the ${formatBytes(maxBytes)} download safety limit. Split or filter the extracts to create a detailed export.`
      );
      return;
    }
    parts.push(chunk);
    byteCount += chunkBytes;
    chunk = "";
  };
  const appendRow = (values) => {
    rowCount += 1;
    if (!available) {
      return;
    }
    if (rowCount > maxRows) {
      abort(
        `The complete change log exceeds the ${formatNumber(maxRows)}-row download safety limit. Split or filter the extracts to create a detailed export.`
      );
      return;
    }
    chunk += `${stringifyCsvLine(values)}\r\n`;
    if (chunk.length >= 256 * 1024) {
      flush();
    }
  };

  return {
    appendDifference(difference) {
      if (difference.status === "changed") {
        for (const change of difference.changes) {
          appendRow([
            difference.key,
            difference.status,
            change.column,
            change.before,
            change.after
          ]);
        }
      } else {
        appendRow([
          difference.key,
          difference.status,
          "",
          "",
          ""
        ]);
      }
    },
    finish() {
      flush();
      return {
        available,
        rowCount,
        byteCount,
        reason,
        blob: available
          ? new Blob(parts, { type: "text/csv;charset=utf-8" })
          : null
      };
    }
  };
}

function buildWarnings(summary, comparedColumns) {
  const warnings = [];
  if (summary.ambiguousKeys > 0) {
    warnings.push(
      `${summary.ambiguousKeys} duplicated key value(s) were excluded because record-level comparison would be ambiguous.`
    );
  }
  if (summary.missingBaselineKeys + summary.missingCurrentKeys > 0) {
    warnings.push(
      `${summary.missingBaselineKeys + summary.missingCurrentKeys} row(s) with blank key fields were excluded.`
    );
  }
  if (comparedColumns.length === 0) {
    warnings.push(
      "The extracts share no non-key columns, so only added and removed records were compared."
    );
  }
  return warnings;
}

function progressMapper(onProgress, phase, start, end) {
  return (fraction) => {
    emitProgress(onProgress, phase, start + (end - start) * fraction);
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

function fractionComplete(index, total) {
  return total === 0 ? 1 : Math.min(1, (index + 1) / total);
}

function validateNonNegativeLimit(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-CA").format(value);
}

function formatBytes(value) {
  return `${formatNumber(value / (1024 * 1024))} MB`;
}

function indexRecords(records, keys, trimWhitespace) {
  const groups = new Map();
  let missingKeys = 0;

  for (const record of records) {
    const parts = keys.map((key) => normalize(record[key], trimWhitespace));
    if (parts.some((part) => part === "")) {
      missingKeys += 1;
      continue;
    }
    const internalKey = JSON.stringify(parts);
    const indexed = {
      record,
      internalKey,
      displayKey: formatDisplayKey(parts)
    };
    const group = groups.get(internalKey) ?? [];
    group.push(indexed);
    groups.set(internalKey, group);
  }

  const unique = new Map();
  const duplicates = [];
  const duplicateInternalKeys = new Set();
  for (const [internalKey, group] of groups) {
    if (group.length === 1) {
      unique.set(internalKey, group[0]);
    } else {
      duplicateInternalKeys.add(internalKey);
      duplicates.push({ key: group[0].displayKey, count: group.length });
    }
  }

  return {
    unique,
    duplicates,
    duplicateInternalKeys,
    missingKeys
  };
}

function normalize(value, trimWhitespace) {
  const text = String(value ?? "");
  return trimWhitespace ? text.trim() : text;
}

function formatDisplayKey(parts) {
  return parts.length === 1 ? parts[0] : JSON.stringify(parts);
}

function countStatus(differences, status) {
  return differences.filter((difference) => difference.status === status)
    .length;
}
