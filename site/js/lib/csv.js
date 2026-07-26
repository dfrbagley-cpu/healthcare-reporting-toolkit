export function parseCsv(
  input,
  {
    trimHeaders = true,
    allowMissingTrailingValues = true
  } = {}
) {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  if (text.trim() === "") {
    throw new Error("CSV file is empty.");
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

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
        row.push(field);
        field = "";
        quoteClosed = false;
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") {
          index += 1;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        quoteClosed = false;
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
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quoted field.");
  }
  if (field !== "" || row.length > 0 || !/[\r\n]$/.test(text)) {
    row.push(field);
    rows.push(row);
  }

  const nonBlankRows = rows.filter((candidate) =>
    candidate.some((value) => value !== "")
  );
  if (nonBlankRows.length < 1) {
    throw new Error("CSV file does not contain a header row.");
  }

  const headers = nonBlankRows
    .shift()
    .map((header) => (trimHeaders ? header.trim() : header));
  if (headers.some((header) => header === "")) {
    throw new Error("Every CSV column must have a header.");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV headers must be unique.");
  }

  const records = nonBlankRows.map((values, rowIndex) => {
    if (values.length > headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has more values than the header row.`
      );
    }
    if (!allowMissingTrailingValues && values.length < headers.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has fewer values than the header row.`
      );
    }
    const padded = [...values];
    while (padded.length < headers.length) {
      padded.push("");
    }
    return Object.fromEntries(
      headers.map((header, columnIndex) => [header, padded[columnIndex]])
    );
  });

  return { headers, records };
}

export function stringifyCsv(records, headers) {
  const lines = [
    headers.map((header) => escapeCsvValue(header, false)).join(",")
  ];
  for (const record of records) {
    lines.push(
      headers
        .map((header) => escapeCsvValue(record[header] ?? "", true))
        .join(",")
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function inferColumnType(values) {
  const types = new Set(
    values
      .map((value) => String(value ?? "").trim())
      .filter((value) => value !== "")
      .map(inferValueType)
  );

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

function inferValueType(value) {
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
