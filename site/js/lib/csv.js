export function parseCsv(
  input,
  options = {}
) {
  const { headers, rows } = parseCsvRows(input, options);
  const records = rows.map((values) => {
    const record = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      record[headers[columnIndex]] = values[columnIndex];
    }
    return record;
  });

  return { headers, records };
}

export function parseCsvRows(
  input,
  {
    trimHeaders = true,
    allowMissingTrailingValues = true,
    maxRows = Number.POSITIVE_INFINITY,
    maxPhysicalRows = Number.POSITIVE_INFINITY,
    maxColumns = Number.POSITIVE_INFINITY,
    maxCells = Number.POSITIVE_INFINITY,
    onProgress
  } = {}
) {
  validateLimit(maxRows, "Maximum rows");
  validateLimit(maxPhysicalRows, "Maximum physical rows");
  validateLimit(maxColumns, "Maximum columns");
  validateLimit(maxCells, "Maximum cells");

  const source = String(input ?? "");
  const text =
    source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (text.trim() === "") {
    throw new Error("CSV file is empty.");
  }

  let headers = null;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;
  let nextProgressIndex = 0;
  let physicalRows = 0;

  const reportProgress = (processedCharacters) => {
    if (typeof onProgress !== "function") {
      return;
    }
    const completed = Math.min(processedCharacters, text.length);
    if (completed < nextProgressIndex && completed !== text.length) {
      return;
    }
    nextProgressIndex = completed + 256 * 1024;
    onProgress({
      completed,
      total: text.length,
      fraction: text.length === 0 ? 1 : completed / text.length
    });
  };

  const consumeRow = (values) => {
    if (!values.some((value) => value !== "")) {
      return;
    }

    if (headers === null) {
      headers = values.map((header) =>
        trimHeaders ? header.trim() : header
      );
      if (headers.some((header) => header === "")) {
        throw new Error("Every CSV column must have a header.");
      }
      if (new Set(headers).size !== headers.length) {
        throw new Error("CSV headers must be unique.");
      }
      if (headers.length > maxColumns) {
        throw new Error(
          `CSV contains more than ${formatLimit(maxColumns)} columns.`
        );
      }
      return;
    }

    const rowNumber = rows.length + 2;
    if (values.length > headers.length) {
      throw new Error(
        `CSV row ${rowNumber} has more values than the header row.`
      );
    }
    if (!allowMissingTrailingValues && values.length < headers.length) {
      throw new Error(
        `CSV row ${rowNumber} has fewer values than the header row.`
      );
    }
    if (rows.length >= maxRows) {
      throw new Error(
        `CSV contains more than ${formatLimit(maxRows)} data rows.`
      );
    }
    if ((rows.length + 1) * headers.length > maxCells) {
      throw new Error(
        `CSV would materialize more than ${formatLimit(maxCells)} data cells.`
      );
    }

    while (values.length < headers.length) {
      values.push("");
    }
    rows.push(values);
  };

  const appendField = () => {
    const fieldLimit = headers === null ? maxColumns : headers.length;
    if (row.length >= fieldLimit) {
      if (headers === null) {
        throw new Error(
          `CSV contains more than ${formatLimit(maxColumns)} columns.`
        );
      }
      throw new Error(
        `CSV row ${rows.length + 2} has more values than the header row.`
      );
    }
    row.push(field);
    field = "";
  };

  const finishRow = () => {
    appendField();
    consumeRow(row);
    row = [];
    quoteClosed = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (
      character === "\r" ||
      (character === "\n" && text[index - 1] !== "\r")
    ) {
      physicalRows += 1;
      if (physicalRows > maxPhysicalRows) {
        throw new Error(
          `CSV contains more than ${formatLimit(maxPhysicalRows)} physical rows.`
        );
      }
    }
    reportProgress(index);

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed) {
      if (character === ",") {
        appendField();
        quoteClosed = false;
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") {
          index += 1;
        }
        finishRow();
      } else {
        throw new Error(
          "CSV contains characters after a closing quote and before the next delimiter."
        );
      }
    } else if (character === '"' && field === "") {
      inQuotes = true;
    } else if (character === '"') {
      throw new Error("CSV contains a quote inside an unquoted field.");
    } else if (character === ",") {
      appendField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quoted field.");
  }
  if (!/[\r\n]$/.test(text)) {
    physicalRows += 1;
    if (physicalRows > maxPhysicalRows) {
      throw new Error(
        `CSV contains more than ${formatLimit(maxPhysicalRows)} physical rows.`
      );
    }
  }
  if (field !== "" || row.length > 0 || !/[\r\n]$/.test(text)) {
    finishRow();
  }
  reportProgress(text.length);

  if (headers === null) {
    throw new Error("CSV file does not contain a header row.");
  }

  return { headers, rows };
}

export function stringifyCsv(records, headers) {
  const lines = [
    stringifyCsvLine(headers, { protectFormulas: false })
  ];
  for (const record of records) {
    lines.push(
      stringifyCsvLine(
        headers.map((header) => record[header] ?? ""),
        { protectFormulas: true }
      )
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function stringifyCsvLine(
  values,
  { protectFormulas = true } = {}
) {
  return values
    .map((value) => escapeCsvValue(value, protectFormulas))
    .join(",");
}

export function inferColumnType(values) {
  const types = new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter((value) => value !== "")
      .map(inferValueType)
  );

  return inferTypeSet(types);
}

export function inferTypeSet(types) {
  if (types.size === 0) {
    return "empty";
  }
  if (types.size === 1) {
    return [...types][0];
  }
  if (
    types.size === 2 &&
    types.has("integer") &&
    types.has("decimal")
  ) {
    return "decimal";
  }
  return "mixed";
}

export function inferValueType(value) {
  if (/^[+-]?\d+$/.test(value)) {
    return "integer";
  }
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(value)) {
    return "decimal";
  }
  if (/^(?:true|false)$/i.test(value)) {
    return "boolean";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return "date";
    }
  }
  return "text";
}

function validateLimit(value, label) {
  if (
    value !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function formatLimit(value) {
  return new Intl.NumberFormat("en-CA").format(value);
}

function escapeCsvValue(value, protectFormula) {
  let text = String(value ?? "");
  if (protectFormula && /^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
