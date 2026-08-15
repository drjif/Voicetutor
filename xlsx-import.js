import { extractZipEntry, listZipEntries } from './zip-reader.js';

const textDecoder = new TextDecoder('utf-8');
const MAX_XLSX_BYTES = 60 * 1024 * 1024;

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function xmlText(xml) {
  return decodeXml(String(xml ?? '').replace(/<[^>]*>/g, ''));
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return decodeXml(match?.[1] ?? match?.[2] ?? '');
}

function columnIndexFromRef(ref) {
  const match = String(ref ?? '').match(/^([A-Z]+)/i);
  if (!match) return 0;
  let result = 0;
  for (const char of match[1].toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function normalizeTarget(target) {
  const value = String(target ?? '').replace(/\\/g, '/');
  if (value.startsWith('/')) return value.replace(/^\/+/, '');
  const segments = `xl/${value}`.split('/');
  const normalized = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') normalized.pop();
    else normalized.push(segment);
  }
  return normalized.join('/');
}

async function entryText(bytes, entries, name) {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) return null;
  return textDecoder.decode(await extractZipEntry(bytes, entry));
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => {
    const texts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((part) => xmlText(part[1]));
    return texts.join('');
  });
}

function parseWorkbookSheets(workbookXml, relsXml) {
  const relationships = new Map();
  for (const match of String(relsXml ?? '').matchAll(/<Relationship\b[^>]*>/gi)) {
    const id = attribute(match[0], 'Id');
    const target = attribute(match[0], 'Target');
    if (id && target) relationships.set(id, normalizeTarget(target));
  }

  const sheets = [];
  for (const match of String(workbookXml ?? '').matchAll(/<sheet\b[^>]*>/gi)) {
    const name = attribute(match[0], 'name') || `Sheet ${sheets.length + 1}`;
    const relationId = attribute(match[0], 'r:id');
    const path = relationships.get(relationId);
    if (path) sheets.push({ name, path });
  }
  return sheets;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  const rowMatches = [...String(xml ?? '').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)];

  for (const rowMatch of rowMatches) {
    const row = [];
    const cells = [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)];
    for (const cell of cells) {
      const opening = `<c${cell[1]}>`;
      const ref = attribute(opening, 'r');
      const type = attribute(opening, 't');
      const column = columnIndexFromRef(ref);
      let value = '';

      if (type === 'inlineStr') {
        const texts = [...cell[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => xmlText(match[1]));
        value = texts.join('');
      } else {
        const raw = cell[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '';
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = String(raw).trim() === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'str') value = xmlText(raw);
        else value = decodeXml(String(raw).trim());
      }
      row[column] = value;
    }
    if (row.some((cell) => String(cell ?? '').trim())) rows.push(row.map((cell) => cell ?? ''));
  }
  return rows;
}

function usefulRowCount(rows) {
  return rows.filter((row) => row.filter((cell) => String(cell ?? '').trim()).length >= 2).length;
}

export async function parseXlsxWorkbook(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose an Excel .xlsx file.');
  if (file.size > MAX_XLSX_BYTES) throw new Error('That Excel file is too large for browser-local import. Keep it under 60 MB.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = listZipEntries(bytes);
  const workbookXml = await entryText(bytes, entries, 'xl/workbook.xml');
  const relsXml = await entryText(bytes, entries, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !relsXml) throw new Error('This does not look like a readable .xlsx workbook.');

  const sharedXml = await entryText(bytes, entries, 'xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheetDefinitions = parseWorkbookSheets(workbookXml, relsXml);
  if (!sheetDefinitions.length) throw new Error('No worksheets were found in that Excel file.');

  const sheets = [];
  for (const definition of sheetDefinitions) {
    const xml = await entryText(bytes, entries, definition.path);
    if (!xml) continue;
    const rows = parseWorksheet(xml, sharedStrings);
    sheets.push({ name: definition.name, rows, rowCount: rows.length, usefulRows: usefulRowCount(rows) });
  }

  const selected = [...sheets].sort((left, right) => right.usefulRows - left.usefulRows)[0];
  if (!selected || selected.usefulRows === 0) throw new Error('No worksheet with at least two populated columns was found.');

  return {
    sheetName: selected.name,
    rows: selected.rows,
    sheets: sheets.map(({ name, rowCount, usefulRows }) => ({ name, rowCount, usefulRows }))
  };
}
