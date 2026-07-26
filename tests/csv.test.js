import test from "node:test";
import assert from "node:assert/strict";

import {
  inferColumnType,
  parseCsv,
  stringifyCsv
} from "../site/js/lib/csv.js";

test("parses quoted commas, newlines, escaped quotes, BOM, and CRLF", () => {
  const parsed = parseCsv(
    '\uFEFFid,note,owner\r\n1,"Line one,\nline two","A ""quoted"" name"\r\n'
  );

  assert.deepEqual(parsed.headers, ["id", "note", "owner"]);
  assert.deepEqual(parsed.records, [
    {
      id: "1",
      note: "Line one,\nline two",
      owner: 'A "quoted" name'
    }
  ]);
});

test("pads missing trailing values and skips blank lines", () => {
  const parsed = parseCsv("id,name,active\n1,Alpha\n\n2,Beta,true\n");
  assert.deepEqual(parsed.records, [
    { id: "1", name: "Alpha", active: "" },
    { id: "2", name: "Beta", active: "true" }
  ]);
});

test("strict mode preserves exact headers and rejects ragged rows", () => {
  const parsed = parseCsv(" first,second\none,two\n", {
    trimHeaders: false,
    allowMissingTrailingValues: false
  });
  assert.deepEqual(parsed.headers, [" first", "second"]);

  assert.throws(
    () =>
      parseCsv("first,second\none\n", {
        trimHeaders: false,
        allowMissingTrailingValues: false
      }),
    /fewer values/
  );
});

test("rejects malformed headers and rows", () => {
  assert.throws(() => parseCsv("id,id\n1,2\n"), /unique/);
  assert.throws(() => parseCsv("id,\n1,2\n"), /must have a header/);
  assert.throws(() => parseCsv('id,note\n1,"open'), /unclosed/);
  assert.throws(
    () => parseCsv('id,note\n1,"closed"x\n'),
    /after a closing quote/
  );
  assert.throws(
    () => parseCsv('id,note\n1,un"quoted\n'),
    /inside an unquoted field/
  );
  assert.throws(() => parseCsv("id\n1,extra\n"), /more values/);
});

test("infers simple column types without coercing source values", () => {
  assert.equal(inferColumnType(["1", "2", ""]), "integer");
  assert.equal(inferColumnType(["1", "2.5"]), "decimal");
  assert.equal(inferColumnType(["true", "FALSE"]), "boolean");
  assert.equal(inferColumnType(["2026-02-28", "2026-03-01"]), "date");
  assert.equal(inferColumnType(["1", "unknown"]), "mixed");
  assert.equal(inferColumnType(["", " "]), "empty");
});

test("writes valid CSV and protects spreadsheet formula prefixes", () => {
  const csv = stringifyCsv(
    [
      {
        id: "1",
        detail: '=HYPERLINK("https://example.invalid")',
        note: "a,b",
        spaced: " \t=2+2"
      }
    ],
    ["id", "detail", "note", "spaced"]
  );

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
  assert.match(csv, /"a,b"/);
  assert.match(csv, /' \t=2\+2/);
  assert.ok(csv.endsWith("\r\n"));
});
