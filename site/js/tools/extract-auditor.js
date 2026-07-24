import { inferColumnType } from "../lib/csv.js";

export function auditExtracts({
  baseline,
  current,
  keyColumns,
  trimWhitespace = true
}) {
  const keys = keyColumns
    .map((column) => String(column).trim())
    .filter(Boolean);
  if (keys.length === 0) {
    throw new Error("Enter at least one key column.");
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error("Key columns must be unique.");
  }

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
      displayKey: parts.join(" | ")
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

function countStatus(differences, status) {
  return differences.filter((difference) => difference.status === status)
    .length;
}
