import test from "node:test";
import assert from "node:assert/strict";

import { buildReportingWindow } from "../site/js/tools/reporting-window.js";

test("builds an April fiscal year-to-date comparison", () => {
  const result = buildReportingWindow({
    type: "fiscal_ytd",
    asOf: "2026-06-15",
    fiscalStartMonth: 4,
    comparisonType: "prior_year"
  });

  assert.deepEqual(result.current, {
    start: "2026-04-01",
    end: "2026-06-15",
    days: 76
  });
  assert.deepEqual(result.comparison, {
    start: "2025-04-01",
    end: "2025-06-15",
    days: 76
  });
  assert.equal(result.fiscalYear, "FY 2026/27");
  assert.deepEqual(result.warnings, []);
});

test("aligns a fiscal quarter to the configured fiscal year", () => {
  const result = buildReportingWindow({
    type: "fiscal_qtd",
    asOf: "2026-11-05",
    fiscalStartMonth: 4,
    comparisonType: "prior_year"
  });

  assert.equal(result.current.start, "2026-10-01");
  assert.equal(result.current.end, "2026-11-05");
  assert.equal(result.current.days, 36);
});

test("creates an inclusive rolling period", () => {
  const result = buildReportingWindow({
    type: "rolling",
    asOf: "2026-06-15",
    rollingDays: 90,
    fiscalStartMonth: 4,
    comparisonType: "previous_period"
  });

  assert.deepEqual(result.current, {
    start: "2026-03-18",
    end: "2026-06-15",
    days: 90
  });
  assert.deepEqual(result.comparison, {
    start: "2025-12-18",
    end: "2026-03-17",
    days: 90
  });
});

test("clamps leap day when shifting a comparison year", () => {
  const result = buildReportingWindow({
    type: "custom",
    customStart: "2024-02-29",
    customEnd: "2024-03-01",
    fiscalStartMonth: 4,
    comparisonType: "prior_year"
  });

  assert.deepEqual(result.comparison, {
    start: "2023-02-28",
    end: "2023-03-01",
    days: 2
  });
});

test("builds an immediately preceding custom period of equal length", () => {
  const result = buildReportingWindow({
    type: "custom",
    customStart: "2026-06-01",
    customEnd: "2026-06-15",
    fiscalStartMonth: 4,
    comparisonType: "previous_period"
  });

  assert.deepEqual(result.comparison, {
    start: "2026-05-17",
    end: "2026-05-31",
    days: 15
  });
});

test("labels periods that cross fiscal years explicitly", () => {
  const result = buildReportingWindow({
    type: "custom",
    customStart: "2025-03-15",
    customEnd: "2025-04-15",
    fiscalStartMonth: 4,
    comparisonType: "prior_year"
  });

  assert.equal(result.fiscalYear, "FY 2024/25 → FY 2025/26");
});

test("rejects invalid boundaries and unsupported periods", () => {
  assert.throws(
    () =>
      buildReportingWindow({
        type: "custom",
        customStart: "2026-07-01",
        customEnd: "2026-06-01",
        fiscalStartMonth: 4,
        comparisonType: "prior_year"
      }),
    /start must be on or before/
  );
  assert.throws(
    () =>
      buildReportingWindow({
        type: "rolling",
        asOf: "2026-06-01",
        rollingDays: 0,
        fiscalStartMonth: 4,
        comparisonType: "prior_year"
      }),
    /whole number/
  );
});
