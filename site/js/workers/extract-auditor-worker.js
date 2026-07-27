import {
  runExtractAuditJob
} from "./extract-auditor-job.js";

self.addEventListener("message", async (event) => {
  const { type, runId, payload } = event.data ?? {};
  if (type !== "run" || !Number.isSafeInteger(runId)) {
    self.postMessage({
      type: "error",
      runId,
      message: "The extract-audit worker received an invalid request."
    });
    self.close();
    return;
  }

  try {
    const result = await runExtractAuditJob({
      ...payload,
      onProgress: ({ phase, fraction }) => {
        self.postMessage({
          type: "progress",
          runId,
          phase,
          fraction
        });
      }
    });
    self.postMessage({
      type: "complete",
      runId,
      result
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      runId,
      message:
        error instanceof Error
          ? error.message
          : "The extract audit could not be completed."
    });
  } finally {
    self.close();
  }
});
