// AI chat flashcards (ChatGPT, Claude, Gemini, …) → Anki, CSV and same3le.
// Pure functions only: no DOM, no network. Used by /chatgpt-to-anki/ and its tests.
//
// The app's paste parser (paste-data.js) already reads Q:/A: labels, pipe and tab rows and
// Markdown tables. This module first tidies the other shapes AI assistants commonly produce
// (Front/Back labels, "Card 1" headings, semicolon rows for Anki, CSV, "term - definition"
// lines, code fences, header rows) into a form that parser reads, without changing it.

import { parsePastedQuestions } from '../paste-data.js';
import { toAnkiText, fileSlug } from '../quizlet-to-anki/convert.js';

export { fileSlug };

export const AI_PROMPT = [
  'Make 20 flashcards about [TOPIC]. Reply with only the flashcards, no intro or outro,',
  'in exactly this format, with a blank line between cards:',
  '',
  'Q: question',
  'A: short answer'
].join('\n');

const CLOZE_PATTERN = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi; // same as anki-import.js
const HAS_CLOZE = /\{\{c\d+::/i;
const BOLD = '(?:\\*\\*|__)?';
const LIST = '(\\s*(?:[-*+•]\\s+|\\d+[.)]\\s+)?)';
const FRONT_LABEL = new RegExp(`^${LIST}${BOLD}\\s*(?:front|side\\s*(?:1|one|a)|term|question\\s*#?\\s*\\d+|q\\s*#?\\s*\\d+)\\s*${BOLD}\\s*:\\s*${BOLD}\\s*`, 'i');
const BACK_LABEL = new RegExp(`^${LIST}${BOLD}\\s*(?:back|side\\s*(?:2|two|b)|definition|answer\\s*#?\\s*\\d+|a\\s*#?\\s*\\d+)\\s*${BOLD}\\s*:\\s*${BOLD}\\s*`, 'i');
const CARD_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:flash\s*)?card\s*#?\s*\d+(?:\s*(?:of|\/)\s*\d+)?\s*(?:\*\*|__)?\s*(?:[:.)\-–—].*)?$/i;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const FRONT_WORDS = new Set(['front', 'question', 'q', 'term', 'side 1', 'side a', 'prompt', 'word', 'concept', 'cue']);
const BACK_WORDS = new Set(['back', 'answer', 'a', 'definition', 'side 2', 'side b', 'response', 'meaning', 'explanation']);

function tidy(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\r\n?/g, '\n');
}

function nonEmpty(lines) {
  return lines.map((line) => line.trim()).filter(Boolean);
}

/** AI assistants put import-ready data in code blocks; prefer the largest one. */
export function extractMainBlock(text) {
  const source = tidy(text);
  const blocks = [...source.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  const best = blocks
    .filter((block) => nonEmpty(block.split('\n')).length >= 2)
    .sort((left, right) => right.length - left.length)[0];
  if (best) return best;
  return source.replace(/^\s*```[^\n]*$/gm, '');
}

function cleanCell(value) {
  return String(value ?? '')
    .replace(/^\s*(?:\*\*|__)(.*?)(?:\*\*|__)\s*$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function headerKey(value) {
  return cleanCell(value).toLowerCase().replace(/[:*_]/g, '').trim();
}

function isHeaderRow(first, second) {
  return FRONT_WORDS.has(headerKey(first)) && BACK_WORDS.has(headerKey(second));
}

/** RFC 4180-style split of one line, honouring double quotes. */
export function splitDelimited(line, delimiter) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (char === delimiter) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields.map((value) => value.trim());
}

const DASH_SPLIT = /\s+[-–—]\s+/;
const COLON_SPLIT = /:\s+/;

function share(rows, test) {
  return rows.length ? rows.filter(test).length / rows.length : 0;
}

function toTabRows(rows, splitRow) {
  const pairs = rows
    .map(splitRow)
    .filter((fields) => fields && cleanCell(fields[0]) && cleanCell(fields[1]))
    .map((fields) => [cleanCell(fields[0]), cleanCell(fields[1])]);
  if (pairs.length && isHeaderRow(pairs[0][0], pairs[0][1])) pairs.shift();
  return pairs.map(([front, back]) => `${front.replace(/\t/g, ' ')}\t${back.replace(/\t/g, ' ')}`).join('\n');
}

function splitAt(pattern) {
  return (row) => {
    const match = row.match(pattern);
    if (!match || match.index === 0) return null;
    return [row.slice(0, match.index), row.slice(match.index + match[0].length)];
  };
}

/** Reshape common AI flashcard formats into ones paste-data.js reads reliably. */
export function normalizeAiText(text) {
  const block = extractMainBlock(text);
  let lines = block.split('\n').map((line) => line
    .replace(FRONT_LABEL, (_, list) => `${list}Q: `)
    .replace(BACK_LABEL, (_, list) => `${list}A: `));

  const labelled = (pattern) => lines.filter((line) => pattern.test(line.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+)?(?:\*\*|__)?\s*/, ''))).length;
  const questions = labelled(/^(?:q|question)\s*(?:\*\*|__)?\s*[:.]/i);
  const answers = labelled(/^(?:a|answer)\s*(?:\*\*|__)?\s*[:.]/i);
  if (questions >= 1 && answers >= 1) {
    lines = lines.filter((line) => !CARD_HEADING.test(line));
    // Drop sign-off chatter ("Let me know if you want more!") after the last card: anything
    // past the first blank line that follows the final labelled line. Answers that continue
    // directly under "A:" are kept.
    const isLabel = (line) => /^(?:q|question|a|answer|alt|alts|alternatives?|accepted(?: answers?)?|synonyms?)\s*(?:\*\*|__)?\s*[:.]/i
      .test(line.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+)?(?:\*\*|__)?\s*/, ''));
    let lastLabel = -1;
    lines.forEach((line, index) => { if (isLabel(line)) lastLabel = index; });
    const blankAfter = lines.findIndex((line, index) => index > lastLabel && !line.trim());
    if (lastLabel >= 0 && blankAfter > lastLabel) lines = lines.slice(0, blankAfter);
    return { text: lines.join('\n'), shape: 'labels' };
  }

  const rows = nonEmpty(lines).filter((row) => !TABLE_DIVIDER.test(row));
  if (rows.length < 1) return { text: block, shape: 'unknown' };

  if (share(rows, (row) => row.startsWith('|')) >= 0.6) {
    const cells = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|');
    return { text: toTabRows(rows, cells), shape: 'table' };
  }
  if (share(rows, (row) => row.includes('\t')) >= 0.6) {
    return { text: toTabRows(rows, (row) => row.split('\t')), shape: 'tabs' };
  }
  if (share(rows, (row) => row.includes(';')) >= 0.6) {
    return { text: toTabRows(rows, (row) => splitDelimited(row, ';')), shape: 'semicolons' };
  }
  const csvLike = (rows[0] && isHeaderRow(...splitDelimited(rows[0], ',')))
    || share(rows, (row) => /^"[^"]*(?:""[^"]*)*"\s*,/.test(row)) >= 0.6;
  if (csvLike) {
    return { text: toTabRows(rows, (row) => splitDelimited(row, ',')), shape: 'csv' };
  }
  if (share(rows, (row) => row.includes(' | ')) >= 0.6) {
    return { text: toTabRows(rows, (row) => row.split(' | ')), shape: 'pipes' };
  }
  if (share(rows, (row) => DASH_SPLIT.test(row)) >= 0.6) {
    return { text: toTabRows(rows, splitAt(DASH_SPLIT)), shape: 'dashes' };
  }
  if (share(rows, (row) => COLON_SPLIT.test(row)) >= 0.6) {
    return { text: toTabRows(rows, splitAt(COLON_SPLIT)), shape: 'colons' };
  }
  return { text: block, shape: 'unknown' };
}

// ---- Cloze -------------------------------------------------------------------------------

function clozeIndices(text) {
  return [...new Set([...String(text).matchAll(CLOZE_PATTERN)].map((m) => Number(m[1])).filter((n) => n > 0))]
    .sort((a, b) => a - b);
}

function renderClozeQuestion(text, target) {
  return String(text).replace(CLOZE_PATTERN, (_, index, answer, hint) => {
    if (Number(index) === target) return hint ? `[${hint}]` : '[…]';
    return answer;
  });
}

function clozeAnswer(text, target) {
  const answers = [...String(text).matchAll(CLOZE_PATTERN)]
    .filter((m) => Number(m[1]) === target)
    .map((m) => m[2].trim())
    .filter(Boolean);
  return [...new Set(answers)].join('; ');
}

/** One question per cloze number, like Anki and the same3le importer. */
export function clozeToCards(text) {
  return clozeIndices(text)
    .map((index) => ({ question: renderClozeQuestion(text, index).trim(), answer: clozeAnswer(text, index), acceptedAnswers: [] }))
    .filter((card) => card.question && card.answer);
}

function parseCloze(block) {
  const rows = nonEmpty(block.split('\n'));
  const notes = [];
  let skipped = 0;
  for (const row of rows) {
    if (!HAS_CLOZE.test(row)) { skipped += 1; continue; }
    const stripped = row.replace(/^\s*(?:[-*+•]\s+|\d+[.)]\s+)/, '');
    const delimiter = ['\t', ';', '|'].find((d) => stripped.includes(d) && !HAS_CLOZE.test(stripped.split(d).slice(1).join(d)));
    const [text, extra = ''] = delimiter ? splitDelimited(stripped, delimiter) : [stripped];
    if (clozeToCards(text).length) notes.push({ text: cleanCell(text), extra: cleanCell(extra) });
    else skipped += 1;
  }
  return { notes, skipped };
}

// ---- Main entry --------------------------------------------------------------------------

const SHAPE_LABELS = {
  labels: 'Q: / A: style labels',
  table: 'a table',
  tabs: 'tab-separated rows',
  semicolons: 'semicolon-separated rows',
  csv: 'CSV rows',
  pipes: 'Question | Answer rows',
  dashes: 'term – definition lines',
  colons: 'term: definition lines'
};

/**
 * @returns {{ mode: 'basic' | 'cloze', cards: Array<{question: string, answer: string, acceptedAnswers: string[]}>,
 *             clozeNotes: Array<{text: string, extra: string}>, format: string | null, skipped: number, message: string }}
 */
export function parseAiFlashcards(text, { swap = false } = {}) {
  const block = extractMainBlock(text);
  const rows = nonEmpty(block.split('\n'));
  if (!rows.length) return { mode: 'basic', cards: [], clozeNotes: [], format: null, skipped: 0, message: '' };

  if (share(rows, (row) => HAS_CLOZE.test(row)) >= 0.5) {
    const { notes, skipped } = parseCloze(block);
    const cards = notes.flatMap((note) => clozeToCards(note.text));
    return { mode: 'cloze', cards, clozeNotes: notes, format: 'cloze deletions', skipped, message: '' };
  }

  const normalized = normalizeAiText(text);
  let parsed = parsePastedQuestions(normalized.text);
  let format = SHAPE_LABELS[normalized.shape] ?? parsed.format;
  if (!parsed.cards.length && normalized.text !== tidy(text)) {
    parsed = parsePastedQuestions(tidy(text));
    format = parsed.format;
  }
  let cards = parsed.cards.map((card) => ({
    question: card.question,
    answer: card.answer,
    acceptedAnswers: card.acceptedAnswers ?? []
  }));
  if (swap) cards = cards.map((card) => ({ question: card.answer, answer: card.question, acceptedAnswers: [] }));
  return { mode: 'basic', cards, clozeNotes: [], format: cards.length ? format : null, skipped: 0, message: parsed.message };
}

// ---- Writers -----------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function ankiField(value) {
  const html = escapeHtml(value).replace(/\t/g, ' ').replace(/\n/g, '<br>');
  return `"${html.replaceAll('"', '""')}"`;
}

/** Basic front/back notes for Anki (2.1.54+ reads the header lines). */
export function toAnkiBasic(cards, { deck } = {}) {
  return toAnkiText(cards.map((card) => ({ term: card.question, definition: card.answer })), { deck });
}

/** Cloze notes for Anki's built-in Cloze note type: Text, then Back Extra. */
export function toAnkiCloze(notes, { deck } = {}) {
  const lines = ['#separator:tab', '#html:true', '#notetype:Cloze'];
  const deckName = String(deck ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (deckName) lines.push(`#deck:${deckName}`);
  for (const note of notes) lines.push(`${ankiField(note.text)}\t${ankiField(note.extra ?? '')}`);
  return `${lines.join('\n')}\n`;
}

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsvCards(cards) {
  const lines = ['Front,Back'];
  for (const card of cards) lines.push(`${csvField(card.question)},${csvField(card.answer)}`);
  return `${lines.join('\r\n')}\r\n`;
}

/** Q:/A: blocks (plus accepted alternatives) for the same3le paste box. */
export function toHandoffText(cards) {
  const flat = (value) => String(value).replace(/\s*\n\s*/g, ' ').trim();
  return cards.map((card) => {
    const lines = [`Q: ${flat(card.question)}`, `A: ${flat(card.answer)}`];
    const alternatives = (card.acceptedAnswers ?? []).map(flat).filter(Boolean);
    if (alternatives.length) lines.push(`ALT: ${alternatives.join(' | ')}`);
    return lines.join('\n');
  }).join('\n\n');
}
