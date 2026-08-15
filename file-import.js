import { parseAnkiPackage } from './anki-import.js';
import { parsePastedQuestions } from './paste-data.js';
import { parseDelimited } from './sheet-data.js';
import { parseXlsxWorkbook } from './xlsx-import.js';

const MAX_TEXT_FILE_BYTES = 25 * 1024 * 1024;
const SUPPORTED = new Set(['xlsx', 'apkg', 'csv', 'tsv', 'txt']);

export function fileExtension(name) {
  return String(name ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function hasQuestionAnswerHeader(rows) {
  const first = rows?.find((row) => row?.some((cell) => String(cell ?? '').trim())) ?? [];
  const q = normalizeHeader(first[0]);
  const a = normalizeHeader(first[1]);
  const questionHeaders = ['question', 'q', 'prompt', 'stem', 'question text', 'front'];
  const answerHeaders = ['answer', 'a', 'correct answer', 'response', 'back'];
  return questionHeaders.includes(q) && answerHeaders.includes(a);
}

export function stripAnkiTextMetadata(text) {
  const normalized = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const metadata = {};
  let index = 0;

  while (index < lines.length && /^#[a-z][a-z0-9_-]*:/i.test(lines[index].trim())) {
    const line = lines[index].trim();
    const colon = line.indexOf(':');
    const key = line.slice(1, colon).toLowerCase();
    metadata[key] = line.slice(colon + 1);
    index += 1;
  }

  const bodyLines = lines.slice(index);
  let body = bodyLines.join('\n');
  let hasHeaders = false;
  if (metadata.columns) {
    const columns = metadata.columns.includes('\t')
      ? metadata.columns
      : metadata.columns.split(',').map((value) => value.trim()).join('\t');
    body = `${columns}\n${body}`;
    hasHeaders = true;
  }

  return { body, metadata, hasHeaders, isAnkiText: index > 0 };
}

async function parseTextFile(file, extension) {
  if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('That text file is too large for browser-local import. Keep it under 25 MB.');
  const text = await file.text();
  const ankiText = stripAnkiTextMetadata(text);

  if (extension === 'txt' && !ankiText.isAnkiText) {
    const pasted = parsePastedQuestions(text);
    if (pasted.cards.length) {
      return {
        mode: 'cards',
        sourceKind: 'text',
        title: file.name,
        cards: pasted.cards,
        detail: `Parsed ${pasted.cards.length} Q&A pair${pasted.cards.length === 1 ? '' : 's'} from text.`
      };
    }
  }

  const rows = parseDelimited(ankiText.body);
  if (!rows.length) throw new Error('No readable rows were found in that file.');
  const hasHeaders = ankiText.hasHeaders || hasQuestionAnswerHeader(rows);
  return {
    mode: 'rows',
    sourceKind: ankiText.isAnkiText ? 'anki-text' : extension,
    title: file.name,
    rows,
    hasHeaders,
    detail: ankiText.isAnkiText ? 'Anki plain-text export loaded locally.' : `${extension.toUpperCase()} file loaded locally.`
  };
}

export async function parseStudyFile(file) {
  if (!file) throw new Error('Choose a study file first.');
  const extension = fileExtension(file.name);
  if (!SUPPORTED.has(extension)) {
    throw new Error('Unsupported file type. Choose .xlsx, .apkg, .csv, .tsv, or .txt.');
  }

  if (extension === 'apkg') {
    const result = await parseAnkiPackage(file);
    return {
      mode: 'cards',
      sourceKind: 'anki',
      title: result.title,
      cards: result.cards,
      detail: `${result.cards.length} oral-study card${result.cards.length === 1 ? '' : 's'} extracted from ${result.noteCount} Anki note${result.noteCount === 1 ? '' : 's'} (${result.format})${result.truncated ? '; capped at 25,000 cards' : ''}.`
    };
  }

  if (extension === 'xlsx') {
    const workbook = await parseXlsxWorkbook(file);
    return {
      mode: 'rows',
      sourceKind: 'xlsx',
      title: file.name,
      rows: workbook.rows,
      hasHeaders: hasQuestionAnswerHeader(workbook.rows),
      detail: `Excel worksheet “${workbook.sheetName}” loaded locally.`
    };
  }

  return parseTextFile(file, extension);
}
