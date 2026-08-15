const textDecoder = new TextDecoder('utf-8');

function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes, offset) {
  return ((bytes[offset] * 0x1000000)
    + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])) >>> 0;
}

function readI8(value) {
  return value & 0x80 ? value - 0x100 : value;
}

function readSignedBE(bytes, offset, length) {
  let value = 0n;
  for (let index = 0; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  const bits = BigInt(length * 8);
  if (value & (1n << (bits - 1n))) value -= 1n << bits;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

function readVarint(bytes, offset) {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[offset + index];
    value = (value << 7n) | BigInt(byte & 0x7f);
    if (!(byte & 0x80)) {
      const number = Number(value);
      return { value: Number.isSafeInteger(number) ? number : value, length: index + 1 };
    }
  }

  value = (value << 8n) | BigInt(bytes[offset + 8]);
  const number = Number(value);
  return { value: Number.isSafeInteger(number) ? number : value, length: 9 };
}

export class SQLiteReader {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const magic = textDecoder.decode(this.bytes.subarray(0, 16));
    if (magic !== 'SQLite format 3\u0000') {
      throw new Error('The embedded Anki collection is not a readable SQLite database.');
    }

    const rawPageSize = readU16BE(this.bytes, 16);
    this.pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
    this.reserved = this.bytes[20];
    this.usableSize = this.pageSize - this.reserved;
    if (!this.pageSize || this.pageSize < 512) throw new Error('Unsupported SQLite page size.');
  }

  pageOffset(pageNumber) {
    return (pageNumber - 1) * this.pageSize;
  }

  localPayloadSize(payloadSize) {
    const usable = this.usableSize;
    const maxLocal = usable - 35;
    if (payloadSize <= maxLocal) return payloadSize;
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    const candidate = minLocal + ((payloadSize - minLocal) % (usable - 4));
    return candidate <= maxLocal ? candidate : minLocal;
  }

  readPayload(pageNumber, payloadStart, payloadSize) {
    const pageBase = this.pageOffset(pageNumber);
    const local = this.localPayloadSize(payloadSize);
    if (payloadStart + local > pageBase + this.pageSize) throw new Error('Corrupt SQLite payload.');
    if (local === payloadSize) return this.bytes.slice(payloadStart, payloadStart + local);

    const output = new Uint8Array(payloadSize);
    output.set(this.bytes.subarray(payloadStart, payloadStart + local), 0);
    let written = local;
    let overflowPage = readU32BE(this.bytes, payloadStart + local);
    const chunkSize = this.usableSize - 4;
    const seen = new Set();

    while (written < payloadSize && overflowPage) {
      if (seen.has(overflowPage)) throw new Error('Circular SQLite overflow chain.');
      seen.add(overflowPage);
      const base = this.pageOffset(overflowPage);
      if (base < 0 || base + 4 > this.bytes.length) throw new Error('Invalid SQLite overflow page.');
      const next = readU32BE(this.bytes, base);
      const take = Math.min(chunkSize, payloadSize - written);
      output.set(this.bytes.subarray(base + 4, base + 4 + take), written);
      written += take;
      overflowPage = next;
    }

    if (written < payloadSize) throw new Error('Truncated SQLite overflow payload.');
    return output;
  }

  decodeRecord(payload) {
    const header = readVarint(payload, 0);
    const headerSize = Number(header.value);
    if (!Number.isFinite(headerSize) || headerSize < header.length || headerSize > payload.length) {
      throw new Error('Invalid SQLite record header.');
    }

    const serialTypes = [];
    let position = header.length;
    while (position < headerSize) {
      const serial = readVarint(payload, position);
      serialTypes.push(Number(serial.value));
      position += serial.length;
    }

    let dataPosition = headerSize;
    const values = [];
    for (const serial of serialTypes) {
      let length = 0;
      let value = null;

      if (serial === 0) value = null;
      else if (serial === 1) {
        length = 1;
        value = readI8(payload[dataPosition]);
      } else if (serial >= 2 && serial <= 6) {
        length = [0, 0, 2, 3, 4, 6, 8][serial];
        value = readSignedBE(payload, dataPosition, length);
      } else if (serial === 7) {
        length = 8;
        value = new DataView(payload.buffer, payload.byteOffset + dataPosition, 8).getFloat64(0, false);
      } else if (serial === 8) value = 0;
      else if (serial === 9) value = 1;
      else if (serial >= 12) {
        length = serial % 2 === 0 ? (serial - 12) / 2 : (serial - 13) / 2;
        const slice = payload.subarray(dataPosition, dataPosition + length);
        value = serial % 2 === 0 ? slice.slice() : textDecoder.decode(slice);
      }

      if (dataPosition + length > payload.length) throw new Error('Truncated SQLite record.');
      dataPosition += length;
      values.push(value);
    }

    return values;
  }

  readTablePage(pageNumber, output, seen = new Set()) {
    if (!pageNumber || seen.has(pageNumber)) return;
    seen.add(pageNumber);

    const pageBase = this.pageOffset(pageNumber);
    const headerBase = pageBase + (pageNumber === 1 ? 100 : 0);
    if (headerBase + 8 > this.bytes.length) throw new Error('Invalid SQLite b-tree page.');

    const type = this.bytes[headerBase];
    const cellCount = readU16BE(this.bytes, headerBase + 3);
    const headerSize = type === 0x05 ? 12 : type === 0x0d ? 8 : 0;
    if (!headerSize) throw new Error(`Unsupported SQLite b-tree page type 0x${type.toString(16)}.`);

    const pointers = [];
    for (let index = 0; index < cellCount; index += 1) {
      pointers.push(readU16BE(this.bytes, headerBase + headerSize + index * 2));
    }

    if (type === 0x05) {
      for (const cellOffset of pointers) {
        const cell = pageBase + cellOffset;
        this.readTablePage(readU32BE(this.bytes, cell), output, seen);
      }
      this.readTablePage(readU32BE(this.bytes, headerBase + 8), output, seen);
      return;
    }

    for (const cellOffset of pointers) {
      let cell = pageBase + cellOffset;
      const payloadVarint = readVarint(this.bytes, cell);
      const payloadSize = Number(payloadVarint.value);
      cell += payloadVarint.length;
      const rowid = readVarint(this.bytes, cell);
      cell += rowid.length;
      const payload = this.readPayload(pageNumber, cell, payloadSize);
      output.push({ rowid: rowid.value, values: this.decodeRecord(payload) });
    }
  }

  readTable(rootPage) {
    const rows = [];
    this.readTablePage(Number(rootPage), rows);
    return rows;
  }

  schema() {
    return this.readTable(1).map((row) => ({
      type: row.values[0],
      name: row.values[1],
      tableName: row.values[2],
      rootPage: row.values[3],
      sql: row.values[4]
    }));
  }

  table(name) {
    const entry = this.schema().find((item) => item.type === 'table' && item.name === name);
    if (!entry) throw new Error(`SQLite table ${name} was not found.`);
    return { entry, rows: this.readTable(entry.rootPage) };
  }
}

export function sqliteColumnNames(createSql) {
  const sql = String(createSql || '');
  const start = sql.indexOf('(');
  const end = sql.lastIndexOf(')');
  if (start < 0 || end <= start) return [];

  const body = sql.slice(start + 1, end);
  const parts = [];
  let part = '';
  let quote = null;
  let depth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      part += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      part += char;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(part.trim());
      part = '';
    } else {
      part += char;
    }
  }
  if (part.trim()) parts.push(part.trim());

  return parts.map((definition) => {
    const match = definition.match(/^\s*["'`\[]?([^\s"'`\]]+)/);
    return match?.[1]?.replace(/\]$/, '') ?? '';
  });
}
