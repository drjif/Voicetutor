const utf8 = new TextDecoder('utf-8');

function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32le(bytes, offset) {
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function findEndOfCentralDirectory(bytes) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (u32le(bytes, offset) === 0x06054b50) return offset;
  }
  throw new Error('This file is not a readable ZIP package.');
}

export function listZipEntries(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const eocd = findEndOfCentralDirectory(bytes);
  const count = u16le(bytes, eocd + 10);
  const centralOffset = u32le(bytes, eocd + 16);
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < count; index += 1) {
    if (u32le(bytes, offset) !== 0x02014b50) throw new Error('The ZIP directory is corrupt.');
    const flags = u16le(bytes, offset + 8);
    const compression = u16le(bytes, offset + 10);
    const compressedSize = u32le(bytes, offset + 20);
    const uncompressedSize = u32le(bytes, offset + 24);
    const nameLength = u16le(bytes, offset + 28);
    const extraLength = u16le(bytes, offset + 30);
    const commentLength = u16le(bytes, offset + 32);
    const localHeaderOffset = u32le(bytes, offset + 42);
    const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.push({
      name,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress ZIP files locally. Use a current Safari, Chrome, Edge, or Firefox browser.');
  }

  let stream;
  try {
    stream = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('This browser cannot decompress ZIP files locally. Use a current Safari, Chrome, Edge, or Firefox browser.');
  }

  const blob = new Blob([data]);
  return new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer());
}

export async function extractZipEntry(input, entry) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const offset = entry.localHeaderOffset;
  if (u32le(bytes, offset) !== 0x04034b50) {
    throw new Error(`ZIP entry ${entry.name} has an invalid local header.`);
  }

  const nameLength = u16le(bytes, offset + 26);
  const extraLength = u16le(bytes, offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + entry.compressedSize);

  if (entry.compression === 0) return compressed.slice();
  if (entry.compression === 8) {
    const out = await inflateRaw(compressed);
    if (entry.uncompressedSize && out.length !== entry.uncompressedSize) {
      throw new Error(`ZIP entry ${entry.name} did not decompress to the expected size.`);
    }
    return out;
  }

  throw new Error(`ZIP compression method ${entry.compression} is not supported.`);
}

export async function extractZipFile(input, name) {
  const entries = listZipEntries(input);
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return null;
  return extractZipEntry(input, entry);
}
