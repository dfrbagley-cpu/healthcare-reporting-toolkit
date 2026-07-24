import {
  addDays,
  addYearsClamped,
  fiscalYearLabel,
  formatIsoDate,
  inclusiveDays,
  parseIsoDate,
  startOfFiscalQuarter,
  startOfFiscalYear
} from "../lib/date-utils.js";

const WINDOW_LABELS = {
  fiscal_ytd: "Fiscal year to date",
  fiscal_qtd: "Fiscal quarter to date",
  rolling: "Rolling period",
  custom: "Custom period"
};

const COMPARISON_LABELS = {
  prior_year: "Like-for-like prior year",
  previous_period: "Immediately preceding period"
};

export function buildReportingWindow(options) {
  const type = options.type ?? "fiscal_ytd";
  const comparisonType = options.comparisonType ?? "prior_year";
  const fiscalStartMonth = Number(options.fiscalStartMonth ?? 4);

  if (!Object.hasOwn(WINDOW_LABELS, type)) {
    throw new Error("Choose a supported reporting period.");
  }
  if (!Object.hasOwn(COMPARISON_LABELS, comparisonType)) {
    throw new Error("Choose a supported comparison method.");
  }
  if (
    !Number.isInteger(fiscalStartMonth) ||
    fiscalStartMonth < 1 ||
    fiscalStartMonth > 12
  ) {
    throw new Error("Fiscal start month must be between 1 and 12.");
  }

  let start;
  let end;

  if (type === "custom") {
    start = parseIsoDate(options.customStart, "Custom start");
    end = parseIsoDate(options.customEnd, "Custom end");
  } else {
    end = parseIsoDate(options.asOf, "As-of date");
    if (type === "fiscal_ytd") {
      start = startOfFiscalYear(end, fiscalStartMonth);
    } else if (type === "fiscal_qtd") {
      start = startOfFiscalQuarter(end, fiscalStartMonth);
    } else {
      const rollingDays = Number(options.rollingDays);
      if (
        !Number.isInteger(rollingDays) ||
        rollingDays < 1 ||
        rollingDays > 3_660
      ) {
        throw new Error("Rolling days must be a whole number from 1 to 3,660.");
      }
      start = addDays(end, -(rollingDays - 1));
    }
  }

  const current = makePeriod(start, end);
  let comparison;

  if (comparisonType === "prior_year") {
    comparison = makePeriod(
      addYearsClamped(start, -1),
      addYearsClamped(end, -1)
    );
  } else {
    const comparisonEnd = addDays(start, -1);
    comparison = makePeriod(
      addDays(comparisonEnd, -(current.days - 1)),
      comparisonEnd
    );
  }

  const warnings = [];
  if (comparison.days !== current.days) {
    warnings.push(
      `The comparison contains ${comparison.days} days versus ${current.days} days in the current period because of calendar alignment.`
    );
  }
  if (
    comparison.startDate <= current.endDate &&
    comparison.endDate >= current.startDate
  ) {
    warnings.push(
      "The comparison overlaps the current period. Confirm that this is intentional."
    );
  }

  const startFiscalYear = fiscalYearLabel(start, fiscalStartMonth);
  const endFiscalYear = fiscalYearLabel(end, fiscalStartMonth);

  return {
    type,
    typeLabel: WINDOW_LABELS[type],
    comparisonType,
    comparisonLabel: COMPARISON_LABELS[comparisonType],
    fiscalYear:
      startFiscalYear === endFiscalYear
        ? endFiscalYear
        : `${startFiscalYear} → ${endFiscalYear}`,
    current: stripDates(current),
    comparison: stripDates(comparison),
    warnings
  };
}

function makePeriod(startDate, endDate) {
  return {
    startDate,
    endDate,
    start: formatIsoDate(startDate),
    end: formatIsoDate(endDate),
    days: inclusiveDays(startDate, endDate)
  };
}

function stripDates(period) {
  return {
    start: period.start,
    end: period.end,
    days: period.days
  };
}
