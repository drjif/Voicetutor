// Reads Anki files in the browser: deck packages (.apkg), collection packages (.colpkg) and raw
// collections (collection.anki2). Nothing is uploaded.
//
// It reuses the app's own readers unchanged (zip-reader.js for inflating, sqlite-read.js for
// table pages and records) and adds what a full CSV export needs:
// - ZIP directories read through Blob.slice, with ZIP64, so a 2 GB deck full of images never
//   loads its media into memory. Only the collection file is read.
// - Modern packages (collection.anki21b): zstd, via the browser when it can, otherwise a
//   self-hosted decoder (./vendor/fzstd.js). No third-party CDN.
// - WITHOUT ROWID tables, where modern collections keep note-type field names.
// - Note types, field names, decks and tags, for both the legacy and the modern schema.

import { extractZipEntry } from '../zip-reader.js';
import { SQLiteReader } from '../sqlite-read.js';

export class ApkgError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApkgError';
    this.code = code;
  }
}

/** Newest first: modern packages also carry a stub collection.anki2 for old Anki versions. */
export const COLLECTION_NAMES = ['collection.anki21b', 'collection.21b', 'collection.anki21', 'collection.anki2'];
const SQLITE_MAGIC = 'SQLite format 3\u0000';
const STUB_NOTE = /please update to the latest anki version/i;
const utf8 = new TextDecoder('utf-8');

const MESSAGES = {
  'not-anki': 'That isn’t an Anki deck. Choose a .apkg file exported from Anki (a .colpkg backup works too).',
  'no-collection': 'That ZIP file doesn’t contain an Anki deck. Choose a .apkg file exported from Anki.',
  corrupt: 'That deck file is damaged or incomplete. Download or export it again, then try once more.',
  encrypted: 'That file is password-protected, so it can’t be read.',
  empty: 'That file is empty. Download or export the deck again.',
  'no-notes': 'That deck has no cards in it.',
  zstd: 'This browser couldn’t unpack that deck. Try a current version of Chrome, Safari, Edge or Firefox.',
  'old-browser': 'This browser can’t unpack ZIP files. Try a current version of Chrome, Safari, Edge or Firefox.'
};

function fail(code, detail) {
  const error = new ApkgError(code, MESSAGES[code] ?? MESSAGES.corrupt);
  if (detail) error.detail = detail;
  return error;
}

// ---- Little helpers --------------------------------------------------------------------

const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const le64 = (b, o) => le32(b, o) + le32(b, o + 4) * 0x100000000;
const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;

function isSqlite(bytes) {
  return bytes.length >= 16 && utf8.decode(bytes.subarray(0, 16)) === SQLITE_MAGIC;
}

function isZstd(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
}

async function readRange(blob, start, end) {
  if (!(start >= 0) || !(end <= blob.size) || start > end) throw fail('corrupt', `range ${start}-${end} of ${blob.size}`);
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** SQLite's big-endian varint (as in sqlite-read.js, which doesn't export it). */
function sqliteVarint(bytes, offset) {
  let value = 0;
  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[offset + index];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return { value, length: index + 1 };
  }
  return { value: value * 256 + bytes[offset + 8], length: 9 };
}

/** Rowids are signed 64-bit; sqlite-read.js returns negative ones as large unsigned BigInts. */
function signedRowid(value) {
  if (typeof value !== 'bigint') return value;
  const signed = value >= 2n ** 63n ? value - 2n ** 64n : value;
  const number = Number(signed);
  return Number.isSafeInteger(number) ? number : signed;
}

/** Protocol Buffers' little-endian varint. */
function protoVarint(bytes, offset) {
  let value = 0;
  let scale = 1;
  for (let index = 0; index < 10 && offset + index < bytes.length; index += 1) {
    const byte = bytes[offset + index];
    value += (byte & 0x7f) * scale;
    scale *= 128;
    if (!(byte & 0x80)) return { value, length: index + 1 };
  }
  return { value, length: 10 };
}

// ---- ZIP (central directory read from the end of the file) ---------------------------

function findEndRecord(tail) {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (le32(tail, offset) === 0x06054b50) return offset;
  }
  return -1;
}

export async function readZipDirectory(blob) {
  // The end record sits in the last 22 bytes unless the ZIP has a comment (up to 64 KB).
  // Look at the last 1 KB first, so a big deck's media isn't touched.
  let tail = await readRange(blob, Math.max(0, blob.size - 1024), blob.size);
  let end = findEndRecord(tail);
  if (end < 0 && blob.size > 1024) {
    tail = await readRange(blob, Math.max(0, blob.size - (22 + 0xffff + 20)), blob.size);
    end = findEndRecord(tail);
  }
  if (end < 0) throw fail('not-anki', 'no end of central directory');

  let count = le16(tail, end + 10);
  let size = le32(tail, end + 12);
  let start = le32(tail, end + 16);
  const locator = end - 20;
  if ((count === 0xffff || size === 0xffffffff || start === 0xffffffff) && locator >= 0 && le32(tail, locator) === 0x07064b50) {
    const recordOffset = le64(tail, locator + 8);
    const record = await readRange(blob, recordOffset, recordOffset + 56);
    if (le32(record, 0) !== 0x06064b50) throw fail('corrupt', 'bad ZIP64 record');
    count = le64(record, 32);
    size = le64(record, 40);
    start = le64(record, 48);
  }

  const directory = await readRange(blob, start, start + size);
  const entries = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directory.length || le32(directory, offset) !== 0x02014b50) throw fail('corrupt', 'bad central directory');
    const nameLength = le16(directory, offset + 28);
    const extraLength = le16(directory, offset + 30);
    const commentLength = le16(directory, offset + 32);
    const entry = {
      name: utf8.decode(directory.subarray(offset + 46, offset + 46 + nameLength)),
      flags: le16(directory, offset + 8),
      compression: le16(directory, offset + 10),
      compressedSize: le32(directory, offset + 20),
      uncompressedSize: le32(directory, offset + 24),
      localHeaderOffset: le32(directory, offset + 42)
    };
    // ZIP64 sizes and offsets live in extra field 0x0001, in this order, only when maxed out.
    let extra = offset + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = le16(directory, extra);
      const length = le16(directory, extra + 2);
      if (id === 0x0001) {
        let field = extra + 4;
        if (entry.uncompressedSize === 0xffffffff) { entry.uncompressedSize = le64(directory, field); field += 8; }
        if (entry.compressedSize === 0xffffffff) { entry.compressedSize = le64(directory, field); field += 8; }
        if (entry.localHeaderOffset === 0xffffffff) entry.localHeaderOffset = le64(directory, field);
      }
      extra += 4 + length;
    }
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Reads one entry: its local header and data only, then inflates with zip-reader.js. */
export async function readZipEntry(blob, entry) {
  if (entry.flags & 0x1) throw fail('encrypted');
  const head = await readRange(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (le32(head, 0) !== 0x04034b50) throw fail('corrupt', 'bad local header');
  const dataStart = entry.localHeaderOffset + 30 + le16(head, 26) + le16(head, 28);
  const local = await readRange(blob, entry.localHeaderOffset, dataStart + entry.compressedSize);
  try {
    return await extractZipEntry(local, { ...entry, localHeaderOffset: 0 });
  } catch (error) {
    throw fail(/cannot decompress ZIP/i.test(error.message) ? 'old-browser' : 'corrupt', error.message);
  }
}

// ---- zstd --------------------------------------------------------------------------------

async function nativeZstd(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  let stream;
  try {
    stream = new DecompressionStream('zstd');
  } catch {
    return null;
  }
  try {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  } catch {
    return null;
  }
}

export async function decompressZstd(bytes) {
  const native = await nativeZstd(bytes);
  if (native) return native;
  let decompress;
  try {
    ({ decompress } = await import('./vendor/fzstd.js'));
  } catch (error) {
    throw fail('zstd', error.message);
  }
  try {
    return decompress(bytes);
  } catch (error) {
    throw fail('corrupt', error.message);
  }
}

// ---- SQLite: table columns, WITHOUT ROWID tables ----------------------------------------

/** Column definitions from CREATE TABLE, ignoring comments and table constraints. */
export function tableColumns(createSql) {
  const sql = String(createSql ?? '');
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close <= open) return { columns: [], primaryKey: [] };

  const parts = [];
  let part = '';
  let quote = null;
  let depth = 0;
  const body = sql.slice(open + 1, close);
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      part += char;
      if (char === quote) quote = null;
    } else if (char === '-' && body[index + 1] === '-') {
      while (index < body.length && body[index] !== '\n') index += 1;
      part += ' ';
    } else if (char === '/' && body[index + 1] === '*') {
      const endComment = body.indexOf('*/', index + 2);
      index = endComment < 0 ? body.length : endComment + 1;
      part += ' ';
    } else if (char === '"' || char === "'" || char === '`' || char === '[') {
      quote = char === '[' ? ']' : char;
      part += char;
    } else if (char === ',' && depth === 0) {
      parts.push(part.trim());
      part = '';
    } else {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      part += char;
    }
  }
  if (part.trim()) parts.push(part.trim());

  const unquote = (name) => name.trim().replace(/^["'`[]|["'`\]]$/g, '').toLowerCase();
  const columns = [];
  let primaryKey = [];
  for (const definition of parts) {
    const constraint = definition.match(/^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i);
    if (constraint) {
      primaryKey = constraint[1].split(',').map((name) => unquote(name.replace(/\s+(asc|desc)\s*$/i, '').replace(/\s+collate\s+\S+/i, '')));
      continue;
    }
    if (/^(constraint|unique|check|foreign)\b/i.test(definition)) continue;
    const name = definition.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|'[^']+'|\S+)/)?.[1] ?? '';
    const rest = definition.slice(name.length);
    const isPrimary = /\bprimary\s+key\b/i.test(rest);
    columns.push({
      name: unquote(name),
      integerPrimaryKey: isPrimary && /^\s*integer\b/i.test(rest) && !/\bprimary\s+key\s+desc\b/i.test(rest)
    });
    if (isPrimary) primaryKey = [unquote(name)];
  }
  return { columns, primaryKey };
}

class CollectionReader extends SQLiteReader {
  constructor(bytes) {
    super(bytes);
    const encoding = be32(this.bytes, 56);
    if (encoding > 1) throw fail('corrupt', 'not UTF-8');
    this.tables = new Map();
    for (const entry of this.schema()) {
      if (entry.type === 'table') this.tables.set(String(entry.name).toLowerCase(), entry);
    }
  }

  has(name) {
    return this.tables.has(name);
  }

  /** Every row of a table as an object keyed by lower-case column name. */
  rows(name) {
    const entry = this.tables.get(name);
    if (!entry) return [];
    const { columns, primaryKey } = tableColumns(entry.sql);
    if (/\bwithout\s+rowid\b/i.test(String(entry.sql))) {
      // Stored as an index b-tree: primary-key columns first, then the rest in table order.
      const order = [...primaryKey, ...columns.map((column) => column.name).filter((column) => !primaryKey.includes(column))];
      const records = [];
      this.readIndexPage(Number(entry.rootPage), records, new Set());
      return records.map((values) => Object.fromEntries(order.map((column, index) => [column, values[index] ?? null])));
    }
    const alias = columns.findIndex((column) => column.integerPrimaryKey);
    return this.readTable(entry.rootPage).map(({ rowid, values }) => {
      const row = {};
      columns.forEach((column, index) => { row[column.name] = index === alias ? signedRowid(rowid) : (values[index] ?? null); });
      return row;
    });
  }

  indexLocalSize(payloadSize) {
    const usable = this.usableSize;
    const maxLocal = Math.floor(((usable - 12) * 64) / 255) - 23;
    if (payloadSize <= maxLocal) return payloadSize;
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    const candidate = minLocal + ((payloadSize - minLocal) % (usable - 4));
    return candidate <= maxLocal ? candidate : minLocal;
  }

  readIndexPayload(pageNumber, start, payloadSize) {
    const local = this.indexLocalSize(payloadSize);
    const pageEnd = this.pageOffset(pageNumber) + this.pageSize;
    if (start + local > pageEnd) throw fail('corrupt', 'index payload overruns page');
    if (local === payloadSize) return this.bytes.slice(start, start + local);
    const output = new Uint8Array(payloadSize);
    output.set(this.bytes.subarray(start, start + local), 0);
    let written = local;
    let page = be32(this.bytes, start + local);
    const seen = new Set();
    while (written < payloadSize && page) {
      if (seen.has(page)) throw fail('corrupt', 'overflow loop');
      seen.add(page);
      const base = this.pageOffset(page);
      if (base < 0 || base + 4 > this.bytes.length) throw fail('corrupt', 'overflow page out of range');
      const take = Math.min(this.usableSize - 4, payloadSize - written);
      output.set(this.bytes.subarray(base + 4, base + 4 + take), written);
      written += take;
      page = be32(this.bytes, base);
    }
    if (written < payloadSize) throw fail('corrupt', 'truncated overflow');
    return output;
  }

  /** In an index b-tree every cell is a row, interior cells included (in key order). */
  readIndexPage(pageNumber, output, seen) {
    if (!pageNumber || seen.has(pageNumber)) return;
    seen.add(pageNumber);
    const pageBase = this.pageOffset(pageNumber);
    const header = pageBase + (pageNumber === 1 ? 100 : 0);
    if (header + 8 > this.bytes.length) throw fail('corrupt', 'index page out of range');
    const type = this.bytes[header];
    if (type !== 0x02 && type !== 0x0a) throw fail('corrupt', `unexpected page type ${type}`);
    const interior = type === 0x02;
    const pointers = header + (interior ? 12 : 8);
    const cells = be16(this.bytes, header + 3);
    for (let index = 0; index < cells; index += 1) {
      let cell = pageBase + be16(this.bytes, pointers + index * 2);
      if (interior) {
        this.readIndexPage(be32(this.bytes, cell), output, seen);
        cell += 4;
      }
      const size = sqliteVarint(this.bytes, cell);
      output.push(this.decodeRecord(this.readIndexPayload(pageNumber, cell + size.length, size.value)));
    }
    if (interior) this.readIndexPage(be32(this.bytes, header + 8), output, seen);
  }
}

/** Every row of one table in a SQLite file, keyed by column name (exported for tests). */
export function readSqliteTable(bytes, name) {
  return new CollectionReader(bytes).rows(String(name).toLowerCase());
}

// ---- Anki collection --------------------------------------------------------------------

/** Notetype.Config.kind is protobuf field 1 (0 = normal, 1 = cloze). */
export function notetypeKind(config) {
  if (!(config instanceof Uint8Array)) return 'normal';
  let offset = 0;
  while (offset < config.length) {
    const key = protoVarint(config, offset);
    offset += key.length;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (wire === 0) {
      const value = protoVarint(config, offset);
      offset += value.length;
      if (field === 1) return value.value === 1 ? 'cloze' : 'normal';
    } else if (wire === 2) {
      const length = protoVarint(config, offset);
      offset += length.length + length.value;
    } else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else break;
  }
  return 'normal';
}

function parseJson(text) {
  try {
    const value = JSON.parse(String(text ?? ''));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** Reads a collection (SQLite bytes) into plain data: note types, decks and notes. */
export function readCollection(bytes) {
  let db;
  try {
    db = new CollectionReader(bytes);
  } catch (error) {
    throw error instanceof ApkgError ? error : fail('corrupt', error.message);
  }
  try {
    if (!db.has('notes')) throw fail('no-notes', 'no notes table');
    const types = new Map();
    const decks = new Map();

    if (db.has('notetypes')) {
      for (const row of db.rows('notetypes')) {
        types.set(String(row.id), { id: String(row.id), name: String(row.name ?? ''), kind: notetypeKind(row.config), fields: [] });
      }
      const fields = db.rows('fields').sort((a, b) => Number(a.ord) - Number(b.ord));
      for (const field of fields) types.get(String(field.ntid))?.fields.push(String(field.name ?? ''));
      for (const row of db.rows('decks')) decks.set(String(row.id), String(row.name ?? '').split('\x1f').join('::'));
    } else {
      const col = db.rows('col')[0] ?? {};
      for (const model of Object.values(parseJson(col.models))) {
        const fields = Array.isArray(model?.flds) ? [...model.flds].sort((a, b) => a.ord - b.ord) : [];
        types.set(String(model.id), {
          id: String(model.id),
          name: String(model.name ?? ''),
          kind: Number(model.type) === 1 ? 'cloze' : 'normal',
          fields: fields.map((field) => String(field.name ?? ''))
        });
      }
      for (const deck of Object.values(parseJson(col.decks))) decks.set(String(deck.id), String(deck.name ?? ''));
    }

    // A note's deck is the deck of its first card (cards in filtered decks keep their home in odid).
    const home = new Map();
    for (const card of db.rows('cards')) {
      const note = String(card.nid);
      const ord = Number(card.ord ?? 0);
      const deck = String(Number(card.odid) ? card.odid : card.did);
      const current = home.get(note);
      if (!current || ord < current.ord) home.set(note, { ord, deck });
    }

    const notes = db.rows('notes').map((row) => ({
      id: String(row.id),
      typeId: String(row.mid),
      fields: String(row.flds ?? '').split('\x1f'),
      tags: String(row.tags ?? '').trim().split(/\s+/).filter(Boolean),
      deck: decks.get(home.get(String(row.id))?.deck) ?? ''
    }));

    return { noteTypes: [...types.values()], notes };
  } catch (error) {
    throw error instanceof ApkgError ? error : fail('corrupt', error.message);
  }
}

function isStubCollection(deck) {
  return deck.notes.length === 1 && STUB_NOTE.test(deck.notes[0].fields[0] ?? '');
}

/**
 * Reads an Anki file (File or Blob). Returns
 * { container, format, mediaFiles, noteTypes, notes } or throws an ApkgError with a
 * message that can be shown to the user as-is.
 */
export async function readAnkiFile(file) {
  if (!file || typeof file.slice !== 'function') throw fail('not-anki', 'no file');
  if (!file.size) throw fail('empty');
  const head = await readRange(file, 0, Math.min(file.size, 16));
  const name = String(file.name ?? '').toLowerCase();

  if (isSqlite(head)) {
    const deck = readCollection(await readRange(file, 0, file.size));
    return { container: 'collection', format: 'collection', mediaFiles: 0, ...deck };
  }
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw fail('not-anki', 'not a ZIP or SQLite file');

  const entries = await readZipDirectory(file);
  const entry = COLLECTION_NAMES.map((candidate) => entries.find((item) => item.name === candidate)).find(Boolean);
  if (!entry) throw fail('no-collection');

  let bytes = await readZipEntry(file, entry);
  if (!isSqlite(bytes) && isZstd(bytes)) bytes = await decompressZstd(bytes);
  if (!isSqlite(bytes)) throw fail('corrupt', `${entry.name} is not SQLite`);

  const deck = readCollection(bytes);
  if (isStubCollection(deck)) throw fail('corrupt', 'only the placeholder collection was found');
  return {
    container: name.endsWith('.colpkg') ? 'colpkg' : 'apkg',
    format: /21b$/.test(entry.name) ? 'modern' : 'legacy',
    mediaFiles: entries.filter((item) => /^\d+$/.test(item.name)).length,
    ...deck
  };
}
