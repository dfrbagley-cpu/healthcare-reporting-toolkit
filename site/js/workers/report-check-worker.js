import { loadExtract } from "./extract-auditor-job.js";
import { checkReport, validateProfile, validateRun } from "../tools/report-check.js";
import { sha256Hex, TOOLKIT_VERSION } from "../lib/analysis-receipt.js";
import { stringifyCsvLine } from "../lib/csv.js";
import { syntheticDatabase, DATASET_ID } from "../data/monthly-synthetic.js";

self.onmessage = async ({ data }) => {
  try {
    if (!["synthetic", "open"].includes(data.mode)) throw new Error("Select Synthetic or Open mode.");
    validateProfile(data.profile); validateRun(data.run);
    const onProgress = ({ phase }) => self.postMessage({ type: "progress", phase });
    const baseline = await loadExtract({ file: data.baselineFile, label: "baseline", rangeStart: 0, rangeEnd: 0.4, onProgress });
    const current = await loadExtract({ file: data.currentFile, label: "current", rangeStart: 0.4, rangeEnd: 0.8, onProgress });
    if (data.mode === "synthetic") {
      const files = syntheticDatabase().files;
      for (const [side, source] of [["baseline", baseline], ["current", current]]) {
        const hashes = await Promise.all(Object.values(files).filter((file) => file.role === side)
          .map((file) => sha256Hex(new TextEncoder().encode(file.text))));
        if (!hashes.includes(source.evidence.sha256)) throw new Error(`The ${side} file is not an unchanged supplied synthetic snapshot. Choose a supplied file, or switch to Open mode for your own data.`);
      }
    }
    onProgress({ phase: "Checking definitions and reconciling eligible records" });
    const result = checkReport({ baseline: baseline.table, current: current.table, profile: data.profile, run: data.run });
    const rows = result.reconciliation?.contributions ?? [];
    const fields = ["key", "category", "contribution", "before_date", "after_date", "before_status", "after_status"];
    const csv = [stringifyCsvLine(fields), ...rows.map((r) => stringifyCsvLine(fields.map((f) => r[f])))].join("\r\n") + "\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const exportAvailable = blob.size <= 24 * 1024 * 1024;
    if (result.reconciliation) {
      result.reconciliation.contribution_count = rows.length;
      result.reconciliation.contributions = rows.slice(0, 100);
    }
    result.evidence = { toolkit_version: TOOLKIT_VERSION, mode: data.mode, synthetic_dataset: data.mode === "synthetic" ? DATASET_ID : null, baseline: baseline.evidence, current: current.evidence,
      profile_sha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(data.profile))) };
    self.postMessage({ type: "result", result, csv: exportAvailable && result.status === "complete" ? blob : null,
      exportAvailable });
  } catch (error) { self.postMessage({ type: "error", message: error.message }); }
};
