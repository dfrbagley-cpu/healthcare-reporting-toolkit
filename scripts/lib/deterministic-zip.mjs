import { createHash } from "node:crypto";

export const FIXED_ARCHIVE_TIMESTAMP = "1980-01-01T00:00:00.000Z";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DOS_DATE_1980_01_01 = 33;
const REGULAR_FILE_MODE = 0o100644;

const crcTable = buildCrcTable();

export function createDeterministicZip(inputEntries) {
  const entries = normalizeEntries(inputEntries);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(REGULAR_FILE_MODE * 0x10000, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function readStoredZipEntries(archive) {
  const bytes = Buffer.from(archive);
  const entries = new Map();
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);
    if (signature === CENTRAL_DIRECTORY_HEADER) {
      break;
    }
    if (signature !== LOCAL_FILE_HEADER || offset + 30 > bytes.length) {
      throw new Error(`Invalid ZIP local header at byte ${offset}.`);
    }
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const expectedCrc = bytes.readUInt32LE(offset + 14);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    if (flags !== UTF8_FLAG || method !== 0) {
      throw new Error("Operational release ZIP must use stored UTF-8 entries.");
    }

    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length || compressedSize !== uncompressedSize) {
      throw new Error("Operational release ZIP contains an invalid stored entry.");
    }
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = Buffer.from(bytes.subarray(dataStart, dataEnd));
    if (crc32(data) !== expectedCrc) {
      throw new Error(`CRC mismatch for ${name}.`);
    }
    if (entries.has(name)) {
      throw new Error(`Duplicate ZIP entry: ${name}.`);
    }
    entries.set(name, data);
    offset = dataEnd;
  }

  if (entries.size === 0 || offset + 4 > bytes.length) {
    throw new Error("Operational release ZIP contains no readable entries.");
  }
  return entries;
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(sortJsonValue(value), null, 2)}\n`, "utf8");
}

function normalizeEntries(inputEntries) {
  if (!Array.isArray(inputEntries) || inputEntries.length === 0) {
    throw new Error("At least one ZIP entry is required.");
  }
  const entries = inputEntries.map((entry) => {
    const path = normalizeArchivePath(entry?.path);
    const data = Buffer.isBuffer(entry?.data)
      ? Buffer.from(entry.data)
      : Buffer.from(entry?.data ?? "");
    return { path, data };
  });
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].path === entries[index].path) {
      throw new Error(`Duplicate ZIP entry: ${entries[index].path}.`);
    }
  }
  if (entries.length > 65_535) {
    throw new Error("ZIP64 is not supported by the operational release builder.");
  }
  return entries;
}

function normalizeArchivePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new Error("ZIP entry paths must be non-empty forward-slash paths.");
  }
  const parts = value.split("/");
  if (
    value.startsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ZIP entry path: ${JSON.stringify(value)}.`);
  }
  return value;
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonValue(value[key])])
    );
  }
  return value;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}
