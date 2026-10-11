// Pure logic for the APKG to CSV converter: turns the notes read by ./apkg-read.js into tables,
// CSV/TSV text, Quizlet import text and the same3le handoff. No DOM, no I/O.

import { cleanAnkiText } from '../anki-import.js';
import { toHandoffText } from '../chatgpt-to-anki/convert.js';

export { fileSlug } from '../quizlet-to-anki/convert.js';

// Same pattern as anki-import.js, so cloze cards match what the same3le app makes from a deck.
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::(.*?))?\}\}/gi;
const HAS_CLOZE = /\{\{c\d+::/i;
const IMAGE_OCCLUSION = /\{\{c\d+::image-occlusion:/i;
const IMAGE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SOUND = /\[sound:([^\]]+)\]/gi;
const BLOCK_OPEN = /<(?:div|p|li|tr|h[1-6]|ul|ol|table|blockquote)\b/gi;

/** The most cards the app takes in one go (the same cap as its own Anki import). */
export const MAX_STUDY_CARDS = 25000;

/**
 * cleanAnkiText() from anki-import.js without its entity decoding, for text with no "&".
 * The app decodes entities through the DOM, which is slow on big decks; with no "&" there is
 * nothing to decode, so the result is the same. (Tests compare the two.)
 */
function stripLikeApp(text) {
  return text
    .replace(/\[sound:[^\]]+\]/gi, ' ')
    .replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_, doubleAlt, singleAlt) => ` ${doubleAlt ?? singleAlt ?? ''} `)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Plain text the way the app cleans Anki fields, plus a line break before block elements:
 * Anki's editor writes "Line one<div>Line two</div>", which should stay two lines.
 */
export function plainText(value) {
  const text = String(value ?? '').replace(BLOCK_OPEN, '<br>$&');
  return text.includes('&') ? cleanAnkiText(text) : stripLikeApp(text);
}

// Each note is cleaned once, however many times the options change.
const plainCache = new WeakMap();
const cardCache = new WeakMap();

function plainFields(note) {
  let fields = plainCache.get(note);
  if (!fields) {
    fields = note.fields.map(plainText);
    plainCache.set(note, fields);
  }
  return fields;
}

function clozeNumbers(text) {
  const numbers = [...String(text).matchAll(CLOZE)].map((match) => Number(match[1])).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function clozeCard(text, target, html) {
  const front = String(text).replace(CLOZE, (_, number, answer, hint) => {
    if (Number(number) !== target) return answer;
    return hint ? `[${hint}]` : '[…]';
  });
  const answers = [...String(text).matchAll(CLOZE)]
    .filter((match) => Number(match[1]) === target)
    .map((match) => (html ? match[2].trim() : plainText(match[2])))
    .filter(Boolean);
  return { front: html ? front.trim() : plainText(front), back: [...new Set(answers)].join('; ') };
}

/**
 * The study cards one note makes. Same rules as the same3le app: cloze deletions in the first
 * field become one card each; otherwise the first field is the front and the first later field
 * with text is the back. Image occlusion notes are pictures, so they make no text cards.
 */
export function noteCards(note, { html = false } = {}) {
  if (!html) {
    let cards = cardCache.get(note);
    if (!cards) {
      cards = makeCards(note, false);
      cardCache.set(note, cards);
    }
    return cards;
  }
  return makeCards(note, true);
}

function makeCards(note, html) {
  const first = note.fields[0] ?? '';
  if (HAS_CLOZE.test(first)) {
    if (IMAGE_OCCLUSION.test(first)) return [];
    return clozeNumbers(first).map((number) => clozeCard(first, number, html)).filter((card) => card.front && card.back);
  }
  const plain = plainFields(note);
  const index = note.fields.findIndex((value, i) => i > 0 && (plain[i] || (html && /<img\b|\[sound:/i.test(value))));
  const front = html ? String(first).trim() : plain[0];
  const back = index < 0 ? '' : html ? String(note.fields[index]).trim() : plain[index];
  return front && back ? [{ front, back }] : [];
}

function inDeck(note, deckName) {
  return !deckName || note.deck === deckName || note.deck.startsWith(`${deckName}::`);
}

/** The notes in one deck (subdecks included) and/or of one note type. */
function selectNotes(deck, { deckName = '', typeId = '' } = {}) {
  return deck.notes.filter((note) => inDeck(note, deckName) && (!typeId || note.typeId === typeId));
}

/** Note types, decks (with parents), tags and media references, for the summary and options. */
export function describeDeck(deck) {
  const types = new Map(deck.noteTypes.map((type) => [type.id, { ...type, count: 0 }]));
  const deckCounts = new Map();
  const images = new Set();
  const sounds = new Set();
  let tagged = 0;
  let studyCards = 0;

  for (const note of deck.notes) {
    const type = types.get(note.typeId);
    if (type) type.count += 1;
    if (note.tags.length) tagged += 1;
    const parts = note.deck ? note.deck.split('::') : [];
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const name = parts.slice(0, depth).join('::');
      deckCounts.set(name, (deckCounts.get(name) ?? 0) + 1);
    }
    for (const field of note.fields) {
      for (const match of field.matchAll(IMAGE)) images.add(match[1] ?? match[2] ?? match[3]);
      for (const match of field.matchAll(SOUND)) sounds.add(match[1]);
    }
    studyCards += noteCards(note).length;
  }

  const leafDecks = new Set(deck.notes.map((note) => note.deck));
  return {
    noteCount: deck.notes.length,
    studyCards,
    tagged,
    images: images.size,
    sounds: sounds.size,
    noteTypes: [...types.values()].filter((type) => type.count).sort((a, b) => b.count - a.count),
    decks: [...deckCounts.entries()]
      .map(([name, count]) => ({ name, count, depth: name.split('::').length - 1 }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    deckCount: leafDecks.size
  };
}

function uniqueHeader(names) {
  const seen = new Set();
  return names.map((name, index) => {
    const label = name && !seen.has(name.toLowerCase()) ? name : `Field ${index + 1}`;
    seen.add(label.toLowerCase());
    return label;
  });
}

/**
 * The table to export.
 * mode 'fields': one row per note, every field in its own column (like Anki's own text export).
 * mode 'cards':  one row per study card, Front and Back (cloze deletions become separate cards).
 * Tags, deck and note-type columns go last, so the first two columns stay the card itself.
 */
export function buildTable(deck, { mode = 'fields', html = false, tags = true, deckName = '', typeId = '' } = {}) {
  const notes = selectNotes(deck, { deckName, typeId });
  const types = new Map(deck.noteTypes.map((type) => [type.id, type]));
  const showTags = tags && notes.some((note) => note.tags.length);
  const showDeck = new Set(notes.map((note) => note.deck)).size > 1;
  const extras = (note) => [...(showTags ? [note.tags.join(' ')] : []), ...(showDeck ? [note.deck] : [])];
  const extraHeader = [...(showTags ? ['Tags'] : []), ...(showDeck ? ['Deck'] : [])];

  if (mode === 'cards') {
    const rows = [];
    let skipped = 0;
    for (const note of notes) {
      const cards = noteCards(note, { html });
      if (!cards.length) skipped += 1;
      for (const card of cards) rows.push([card.front, card.back, ...extras(note)]);
    }
    return { mode, header: ['Front', 'Back', ...extraHeader], rows, skipped, noteCount: notes.length };
  }

  // Most-used note type first, so its field names lead the joined column names.
  const counts = new Map();
  for (const note of notes) counts.set(note.typeId, (counts.get(note.typeId) ?? 0) + 1);
  const usedTypes = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).map((id) => types.get(id)).filter(Boolean);
  // A loop, not Math.max(...): Safari limits spread arguments to 65,536 and big decks have more notes.
  let width = 0;
  for (const note of notes) width = Math.max(width, note.fields.length);
  for (const type of usedTypes) width = Math.max(width, type.fields.length);
  const names = Array.from({ length: width }, (_, index) => {
    const candidates = [...new Set(usedTypes.map((type) => type.fields[index]).filter(Boolean))];
    return candidates.length <= 3 ? candidates.join(' / ') : '';
  });
  const showType = usedTypes.length > 1;
  const rows = notes.map((note) => [
    ...Array.from({ length: width }, (_, index) => (html ? String(note.fields[index] ?? '') : plainFields(note)[index] ?? '')),
    ...extras(note),
    ...(showType ? [types.get(note.typeId)?.name ?? ''] : [])
  ]);
  const header = [...uniqueHeader(names), ...extraHeader, ...(showType ? ['Note type'] : [])];
  return { mode, header, rows, skipped: 0, noteCount: notes.length };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function tsvCell(value) {
  const text = String(value ?? '');
  return /[\t"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV: header row, CRLF between rows, quotes only where needed. */
export function toCsv(table) {
  return `${[table.header, ...table.rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Tab-separated, with the same quoting rules Excel, Google Sheets and Anki read. */
export function toTsv(table) {
  return `${[table.header, ...table.rows].map((row) => row.map(tsvCell).join('\t')).join('\r\n')}\r\n`;
}

function flat(value) {
  return String(value ?? '').replace(/\t/g, ' ').replace(/\s*\n\s*/g, ' / ').trim();
}

/**
 * Text for Quizlet's Import box (Create → Flashcard set → Import): a tab between term and
 * definition, a new line between cards. Line breaks inside a card become " / ".
 */
export function toQuizletText(deck, { deckName = '', typeId = '' } = {}) {
  const lines = [];
  for (const note of selectNotes(deck, { deckName, typeId })) {
    for (const card of noteCards(note)) lines.push(`${flat(card.front)}\t${flat(card.back)}`);
  }
  return lines.join('\n');
}

/**
 * Q:/A: text for the same3le app, read back by its own paste parser. Large decks are cut at
 * whole cards to fit maxChars (and the app's card cap); `total` says how many there were.
 */
export function studyHandoff(deck, { deckName = '', typeId = '', maxChars = Infinity, maxCards = MAX_STUDY_CARDS } = {}) {
  const blocks = [];
  let length = 0;
  let total = 0;
  for (const note of selectNotes(deck, { deckName, typeId })) {
    for (const card of noteCards(note)) {
      total += 1;
      if (blocks.length >= maxCards) continue;
      const block = toHandoffText([{ question: card.front, answer: card.back }]);
      const added = block.length + (blocks.length ? 2 : 0);
      if (length + added > maxChars) { maxCards = blocks.length; continue; }
      blocks.push(block);
      length += added;
    }
  }
  return { text: blocks.join('\n\n'), count: blocks.length, total };
}
