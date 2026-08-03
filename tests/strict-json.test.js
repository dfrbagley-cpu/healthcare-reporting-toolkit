import test from "node:test";
import assert from "node:assert/strict";

import {
  parseStrictJson,
  StrictJsonError
} from "../site/js/lib/strict-json.js";

test("strict JSON parses complete JSON values into pollution-safe objects", () => {
  const result = parseStrictJson(
    '{"text":"line\\n\\u0041","array":[true,false,null,-0,1.25e2],"__proto__":{"safe":true}}'
  );

  assert.equal(Object.getPrototypeOf(result), null);
  assert.equal(Object.getPrototypeOf(result.__proto__), null);
  assert.equal(result.text, "line\nA");
  assert.deepEqual([...result.array], [true, false, null, -0, 125]);
  assert.equal(result.__proto__.safe, true);
  assert.equal({}.safe, undefined);
});

test("strict JSON rejects duplicate decoded member names at every depth", () => {
  for (const input of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"outer":{"key":1,"key":2}}'
  ]) {
    assert.throws(
      () => parseStrictJson(input),
      (error) =>
        error instanceof StrictJsonError && /duplicate member/.test(error.message)
    );
  }
});

test("strict JSON rejects malformed syntax, invalid numbers, and trailing data", () => {
  for (const input of [
    "",
    "{",
    '{"a":}',
    '{"a":1,}',
    "[1,]",
    "01",
    "1.",
    "1e",
    "true false",
    '"unescaped\nnewline"',
    '"\\x20"',
    '"\\u12xz"'
  ]) {
    assert.throws(() => parseStrictJson(input), StrictJsonError, input);
  }
});

test("strict JSON rejects byte-order marks and malformed UTF-8", () => {
  assert.throws(() => parseStrictJson("\ufeff{}"), /byte-order mark/);
  assert.throws(
    () => parseStrictJson(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    /byte-order mark/
  );
  assert.throws(
    () => parseStrictJson(Uint8Array.from([0xc3, 0x28])),
    /valid UTF-8/
  );
});

test("strict JSON applies byte, nesting, node, and string quotas", () => {
  assert.throws(
    () => parseStrictJson('{"value":"12345"}', { maxBytes: 10 }),
    /larger than/
  );
  assert.throws(
    () => parseStrictJson('{"a":{"b":{"c":1}}}', { maxDepth: 2 }),
    /nesting is deeper/
  );
  assert.throws(
    () => parseStrictJson("[1,2,3]", { maxNodes: 3 }),
    /more than 3 values/
  );
  assert.throws(
    () => parseStrictJson('"12345"', { maxStringLength: 4 }),
    /longer than 4 characters/
  );
});

test("strict JSON validates limit configuration and input type", () => {
  assert.throws(() => parseStrictJson("{}", { maxDepth: 0 }), /positive safe integer/);
  assert.throws(() => parseStrictJson({}), /text or bytes/);
});
