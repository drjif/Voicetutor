import { SQLiteReader, sqliteColumnNames } from './sqlite-read.js';
import { extractZipEntry, listZipEntries } from './zip-reader.js';

const FIELD_SEPARATOR = '\x1f';
const MAX_APKG_BYTES = 150 * 1024 * 1024;
const MAX_CARDS = 25000;
const SQLITE_MAGIC = 'SQLite format 3\u0000';
const textDecoder = new TextDecoder('utf-8');

function decodeEntities(value) {
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

export function cleanAnkiText(value) {
  return decodeEntities(String(value ?? '')
    .replace(/\[sound:[^\]]+\]/gi, ' ')
    .replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_, doubleAlt, singleAlt) => ` ${doubleAlt ?? singleAlt ?? ''} `)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function exactKey(question, answer) {
  return `${question.toLocaleLowerCase()}\u0000${answer.toLocaleLowerCase()}`;
}

function clozeIndices(text) {
  return [...String(text).matchAll(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function renderCloze(text, targetIndex, revealTarget) {
  return String(text).replace(/\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi, (_, rawIndex, answer, hint) => {
    const index = Number(rawIndex);
    if (index === targetIndex) {
      if (revealTarget) return answer;
      return hint ? `[${hint}]` : '[…]';
    }
    return answer;
  });
}

function card(question, answer, sourceRow) {
  const cleanedQuestion = cleanAnkiText(question);
  const cleanedAnswer = cleanAnkiText(answer);
  if (!cleanedQuestion || !cleanedAnswer) return null;
  return { sourceRow, question: cleanedQuestion, answer: cleanedAnswer, acceptedAnswers: [] };
}

export function cardsFromAnkiFields(fieldStrings) {
  const cards = [];
  const seen = new Set();

  fieldStrings.forEach((fieldsValue, noteIndex) => {
    const fields = String(fieldsValue ?? '').split(FIELD_SEPARATOR);
    const first = fields[0] ?? '';
    const clozes = [...new Set(clozeIndices(first))].sort((left, right) => left - right);

    if (clozes.length) {
      for (const clozeIndex of clozes) {
        const question = renderCloze(first, clozeIndex, false);
        const answer = renderCloze(first, clozeIndex, true);
        const candidate = card(question, answer, noteIndex + 1);
        if (!candidate) continue;
        const key = exactKey(candidate.question, candidate.answer);
        if (!seen.has(key)) {
          seen.add(key);
          cards.push(candidate);
        }
        if (cards.length >= MAX_CARDS) break;
      }
    } else {
      const answerField = fields.slice(1).find((value) => cleanAnkiText(value)) ?? '';
      const candidate = card(first, answerField, noteIndex + 1);
      if (candidate) {
        const key = exactKey(candidate.question, candidate.answer);
        if (!seen.has(key)) {
          seen.add(key);
          cards.push(candidate);
        }
      }
    }
  });

  return cards.slice(0, MAX_CARDS);
}

function startsWithSqlite(bytes) {
  return textDecoder.decode(bytes.subarray(0, 16)) === SQLITE_MAGIC;
}

async function nativeZstd(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new DecompressionStream('zstd');
    const blob = new Blob([bytes]);
    return new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer());
  } catch {
    return null;
  }
}

async function fallbackZstd(bytes) {
  try {
    const module = await import('https://cdn.skypack.dev/fzstd@0.1.1?min');
    const decompress = module.decompress ?? module.default?.decompress;
    if (typeof decompress !== 'function') return null;
    return decompress(bytes);
  } catch (error) {
    console.warn('The optional Anki zstd decoder could not be loaded.', error);
    return null;
  }
}

async function decompressModernCollection(bytes) {
  const native = await nativeZstd(bytes);
  if (native) return native;
  const fallback = await fallbackZstd(bytes);
  if (fallback) return fallback;
  throw new Error('This is a modern Anki package and its collection could not be decompressed in this browser. Re-export the deck from Anki with “Support older Anki versions” enabled, then import that .apkg.');
}

function findColumnIndex(createSql, name, fallback = -1) {
  const columns = sqliteColumnNames(createSql).map((column) => column.toLowerCase());
  const index = columns.indexOf(name.toLowerCase());
  return index >= 0 ? index : fallback;
}

function collectionCards(collectionBytes) {
  const sqlite = new SQLiteReader(collectionBytes);
  const notesTable = sqlite.table('notes');
  const fldsIndex = findColumnIndex(notesTable.entry.sql, 'flds', 6);
  const values = notesTable.rows.map((row) => String(row.values[fldsIndex] ?? ''));
  const cards = cardsFromAnkiFields(values);
  return { cards, noteCount: values.length };
}

function packageTitle(fileName) {
  return String(fileName ?? 'Anki deck').replace(/\.apkg$/i, '').trim() || 'Anki deck';
}

export async function parseAnkiPackage(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('Choose an Anki .apkg file.');
  if (file.size > MAX_APKG_BYTES) throw new Error('That Anki deck is too large for browser-local import. Keep the .apkg under 150 MB.');

  const packageBytes = new Uint8Array(await file.arrayBuffer());
  const entries = listZipEntries(packageBytes);
  const candidates = ['collection.21b', 'collection.anki21b', 'collection.anki21', 'collection.anki2'];
  let lastError = null;

  for (const name of candidates) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) continue;

    try {
      let collection = await extractZipEntry(packageBytes, entry);
      const modern = name.endsWith('.21b') || name.endsWith('.anki21b');
      if (!startsWithSqlite(collection)) {
        if (!modern) throw new Error('The legacy Anki collection is not a readable SQLite database.');
        collection = await decompressModernCollection(collection);
      }
      if (!startsWithSqlite(collection)) throw new Error('The Anki collection did not decompress into a SQLite database.');

      const result = collectionCards(collection);
      if (!result.cards.length) {
        throw new Error('No basic front/back or cloze study cards could be extracted from this Anki deck.');
      }

      return {
        title: packageTitle(file.name),
        cards: result.cards,
        noteCount: result.noteCount,
        format: modern ? 'modern Anki package' : 'legacy Anki package',
        truncated: result.cards.length >= MAX_CARDS
      };
    } catch (error) {
      lastError = error;
      console.warn(`Could not read ${name}`, error);
    }
  }

  throw lastError ?? new Error('No supported Anki collection was found inside this .apkg file.');
}
