const DAY_MS = 86_400_000;

export function parseIsoDate(value, label = "date") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${label} is not a valid calendar date.`);
  }

  return date;
}

export function formatIsoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function formatLongDate(date, locale = "en-CA") {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addYearsClamped(date, years) {
  const targetYear = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const day = Math.min(
    date.getUTCDate(),
    new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate()
  );
  return new Date(Date.UTC(targetYear, month, day));
}

export function inclusiveDays(start, end) {
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days < 1) {
    throw new Error("Period start must be on or before period end.");
  }
  return days;
}

export function startOfFiscalYear(date, fiscalStartMonth) {
  assertMonth(fiscalStartMonth);
  const monthIndex = fiscalStartMonth - 1;
  const startYear =
    date.getUTCMonth() >= monthIndex
      ? date.getUTCFullYear()
      : date.getUTCFullYear() - 1;
  return new Date(Date.UTC(startYear, monthIndex, 1));
}

export function startOfFiscalQuarter(date, fiscalStartMonth) {
  const fiscalStart = startOfFiscalYear(date, fiscalStartMonth);
  const monthsSinceStart =
    (date.getUTCFullYear() - fiscalStart.getUTCFullYear()) * 12 +
    date.getUTCMonth() -
    fiscalStart.getUTCMonth();
  const quarterOffset = Math.floor(monthsSinceStart / 3) * 3;
  return new Date(
    Date.UTC(
      fiscalStart.getUTCFullYear(),
      fiscalStart.getUTCMonth() + quarterOffset,
      1
    )
  );
}

export function fiscalYearLabel(date, fiscalStartMonth) {
  const start = startOfFiscalYear(date, fiscalStartMonth);
  const startYear = start.getUTCFullYear();
  if (fiscalStartMonth === 1) {
    return `FY ${startYear}`;
  }
  return `FY ${startYear}/${String(startYear + 1).slice(-2)}`;
}

function assertMonth(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Fiscal start month must be between 1 and 12.");
  }
}
