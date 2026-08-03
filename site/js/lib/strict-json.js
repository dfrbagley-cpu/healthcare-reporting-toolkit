export const STRICT_JSON_DEFAULT_LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxDepth: 20,
  maxNodes: 10_000,
  maxStringLength: 64 * 1024
});

export class StrictJsonError extends Error {
  constructor(message, offset = null) {
    super(offset === null ? message : `${message} (at character ${offset}).`);
    this.name = "StrictJsonError";
    this.offset = offset;
  }
}

export function parseStrictJson(input, options = {}) {
  const limits = normalizeLimits(options);
  const text = decodeInput(input, limits.maxBytes);
  const parser = new StrictJsonParser(text, limits);
  return parser.parse();
}

function decodeInput(input, maxBytes) {
  if (typeof input === "string") {
    const byteCount = new TextEncoder().encode(input).byteLength;
    if (byteCount > maxBytes) {
      throw new StrictJsonError(
        `JSON input is larger than the ${formatBytes(maxBytes)} limit`
      );
    }
    if (input.charCodeAt(0) === 0xfeff) {
      throw new StrictJsonError("JSON input must not begin with a byte-order mark", 0);
    }
    return input;
  }

  const bytes = toByteView(input);
  if (bytes.byteLength > maxBytes) {
    throw new StrictJsonError(
      `JSON input is larger than the ${formatBytes(maxBytes)} limit`
    );
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new StrictJsonError("JSON input must not begin with a byte-order mark", 0);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new StrictJsonError("JSON input must be valid UTF-8");
  }
}

function toByteView(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("Strict JSON input must be text or bytes.");
}

function normalizeLimits(options) {
  const limits = { ...STRICT_JSON_DEFAULT_LIMITS, ...options };
  for (const name of ["maxBytes", "maxDepth", "maxNodes", "maxStringLength"]) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < 1) {
      throw new TypeError(`${name} must be a positive safe integer.`);
    }
  }
  return limits;
}

class StrictJsonParser {
  constructor(text, limits) {
    this.text = text;
    this.limits = limits;
    this.index = 0;
    this.nodeCount = 0;
  }

  parse() {
    this.skipWhitespace();
    if (this.index === this.text.length) {
      throw this.error("JSON input is empty");
    }
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw this.error("JSON input contains trailing content");
    }
    return value;
  }

  parseValue(depth) {
    this.nodeCount += 1;
    if (this.nodeCount > this.limits.maxNodes) {
      throw this.error(
        `JSON input contains more than ${this.limits.maxNodes.toLocaleString("en-CA")} values`
      );
    }

    const character = this.text[this.index];
    if (character === "{") {
      return this.parseObject(depth);
    }
    if (character === "[") {
      return this.parseArray(depth);
    }
    if (character === '"') {
      return this.parseString();
    }
    if (character === "t") {
      return this.parseLiteral("true", true);
    }
    if (character === "f") {
      return this.parseLiteral("false", false);
    }
    if (character === "n") {
      return this.parseLiteral("null", null);
    }
    if (character === "-" || isDigit(character)) {
      return this.parseNumber();
    }
    throw this.error("JSON input contains an invalid value");
  }

  parseObject(depth) {
    this.assertDepth(depth);
    this.index += 1;
    const result = Object.create(null);
    const keys = new Set();
    this.skipWhitespace();
    if (this.consume("}")) {
      return result;
    }

    while (true) {
      if (this.text[this.index] !== '"') {
        throw this.error("JSON object member names must be strings");
      }
      const keyOffset = this.index;
      const key = this.parseString();
      if (keys.has(key)) {
        throw new StrictJsonError(
          `JSON object contains the duplicate member ${JSON.stringify(key)}`,
          keyOffset
        );
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":", "JSON object member is missing a colon");
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.consume("}")) {
        return result;
      }
      this.expect(",", "JSON object members must be separated by commas");
      this.skipWhitespace();
    }
  }

  parseArray(depth) {
    this.assertDepth(depth);
    this.index += 1;
    const result = [];
    this.skipWhitespace();
    if (this.consume("]")) {
      return result;
    }

    while (true) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      if (this.consume("]")) {
        return result;
      }
      this.expect(",", "JSON array items must be separated by commas");
      this.skipWhitespace();
    }
  }

  parseString() {
    this.index += 1;
    let result = "";
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      this.index += 1;
      if (character === '"') {
        return result;
      }
      if (character === "\\") {
        result += this.parseEscape();
      } else {
        if (character.charCodeAt(0) < 0x20) {
          throw this.error("JSON strings cannot contain unescaped control characters");
        }
        result += character;
      }
      if (result.length > this.limits.maxStringLength) {
        throw this.error(
          `JSON string is longer than ${this.limits.maxStringLength.toLocaleString("en-CA")} characters`
        );
      }
    }
    throw this.error("JSON string is not terminated");
  }

  parseEscape() {
    if (this.index >= this.text.length) {
      throw this.error("JSON string ends with an incomplete escape");
    }
    const escape = this.text[this.index];
    this.index += 1;
    const simple = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t"
    };
    if (Object.hasOwn(simple, escape)) {
      return simple[escape];
    }
    if (escape !== "u") {
      throw this.error("JSON string contains an invalid escape");
    }
    const hexadecimal = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) {
      throw this.error("JSON Unicode escape must contain four hexadecimal digits");
    }
    this.index += 4;
    return String.fromCharCode(Number.parseInt(hexadecimal, 16));
  }

  parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.text.slice(this.index)
    );
    if (!match) {
      throw this.error("JSON input contains an invalid number");
    }
    const token = match[0];
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw this.error("JSON number must be finite");
    }
    return value;
  }

  parseLiteral(token, value) {
    if (this.text.slice(this.index, this.index + token.length) !== token) {
      throw this.error("JSON input contains an invalid literal");
    }
    this.index += token.length;
    return value;
  }

  assertDepth(depth) {
    if (depth >= this.limits.maxDepth) {
      throw this.error(
        `JSON nesting is deeper than the ${this.limits.maxDepth.toLocaleString("en-CA")}-level limit`
      );
    }
  }

  skipWhitespace() {
    while (
      this.text[this.index] === " " ||
      this.text[this.index] === "\t" ||
      this.text[this.index] === "\n" ||
      this.text[this.index] === "\r"
    ) {
      this.index += 1;
    }
  }

  consume(character) {
    if (this.text[this.index] !== character) {
      return false;
    }
    this.index += 1;
    return true;
  }

  expect(character, message) {
    if (!this.consume(character)) {
      throw this.error(message);
    }
  }

  error(message) {
    return new StrictJsonError(message, this.index);
  }
}

function isDigit(value) {
  return value >= "0" && value <= "9";
}

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024).toLocaleString("en-CA")} KB`;
}
