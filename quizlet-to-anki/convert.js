// Quizlet export → Anki / CSV / same3le paste conversion.
// Pure functions only: no DOM, no network. Used by /quizlet-to-anki/ and its tests.

const NAMED_TERM_SEPARATORS = {
  tab: '\t',
  comma: ',',
  dash: ' - ',
  semicolon: ';'
};

const NAMED_ROW_SEPARATORS = {
  newline: '\n',
  semicolon: ';'
};

export function unescapeSeparator(value) {
  return String(value ?? '')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n');
}

function normalizeText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

export function detectRowSeparator(text) {
  const normalized = normalizeText(text).trim();
  if (normalized.includes('\n')) return 'newline';
  if (normalized.includes(';')) return 'semicolon';
  return 'newline';
}

export function detectTermSeparator(text, rowSeparator = '\n') {
  const rows = normalizeText(text)
    .split(rowSeparator)
    .map((row) => row.trim())
    .filter(Boolean);
  if (!rows.length) return 'tab';
  const share = (needle) => rows.filter((row) => row.includes(needle)).length / rows.length;
  if (share('\t') >= 0.5) return 'tab';
  if (share(' - ') >= 0.5) return 'dash';
  if (share(',') >= 0.5) return 'comma';
  if (share('\t') > 0) return 'tab';
  return 'tab';
}

function resolveSeparator(choice, custom, named) {
  if (choice === 'custom') return unescapeSeparator(custom);
  return named[choice] ?? null;
}

/**
 * Parse a Quizlet text export.
 * @param {string} text
 * @param {{termSeparator?: string, rowSeparator?: string, customTerm?: string, customRow?: string, swap?: boolean}} options
 *   termSeparator: 'auto' | 'tab' | 'comma' | 'dash' | 'semicolon' | 'custom'
 *   rowSeparator: 'auto' | 'newline' | 'semicolon' | 'custom'
 */
export function parseQuizletExport(text, options = {}) {
  const normalized = normalizeText(text);
  const rowChoice = !options.rowSeparator || options.rowSeparator === 'auto'
    ? detectRowSeparator(normalized)
    : options.rowSeparator;
  const rowSep = resolveSeparator(rowChoice, options.customRow, NAMED_ROW_SEPARATORS) || '\n';

  const termChoice = !options.termSeparator || options.termSeparator === 'auto'
    ? detectTermSeparator(normalized, rowSep)
    : options.termSeparator;
  const termSep = resolveSeparator(termChoice, options.customTerm, NAMED_TERM_SEPARATORS) || '\t';

  const cards = [];
  const skipped = [];
  const rows = normalized.split(rowSep);
  // When rows are not newline-delimited, newlines inside a row belong to the card.
  const newlineRows = rowSep === '\n';

  rows.forEach((rawRow, index) => {
    // Trim spaces but never a leading separator: "\tdefinition" is a card with an empty term.
    const row = newlineRows
      ? rawRow.replace(/^ +/, '').replace(/\s+$/, '')
      : rawRow.replace(/^\n+|\n+$/g, '');
    if (!row.trim()) return;
    const at = row.indexOf(termSep);
    if (at === -1) {
      // A line with no separator directly after a card is a continuation of its definition
      // (Quizlet exports multi-line definitions as raw line breaks).
      const previous = cards[cards.length - 1];
      if (newlineRows && previous && previous._lastRow === index - 1) {
        previous.definition = `${previous.definition}\n${row}`;
        previous._lastRow = index;
      } else {
        skipped.push({ row: index + 1, text: row.trim() });
      }
      return;
    }
    let term = row.slice(0, at).trim();
    let definition = row.slice(at + termSep.length).trim();
    if (options.swap) [term, definition] = [definition, term];
    if (!term || !definition) {
      skipped.push({ row: index + 1, text: row.trim() });
      return;
    }
    cards.push({ term, definition, _lastRow: index });
  });

  return {
    cards: cards.map(({ term, definition }) => ({ term, definition })),
    skipped,
    termSeparator: termChoice,
    rowSeparator: rowChoice
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function ankiField(value) {
  const html = escapeHtml(value).replace(/\t/g, ' ').replace(/\n/g, '<br>');
  return `"${html.replaceAll('"', '""')}"`;
}

function cleanHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

/** Tab-separated text that Anki 2.1.54+ imports with its settings pre-filled by file headers. */
export function toAnkiText(cards, { deck } = {}) {
  const lines = ['#separator:tab', '#html:true'];
  const deckName = cleanHeaderValue(deck);
  if (deckName) lines.push(`#deck:${deckName}`);
  for (const card of cards) lines.push(`${ankiField(card.term)}\t${ankiField(card.definition)}`);
  return `${lines.join('\n')}\n`;
}

function csvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV with a header row, for spreadsheets. */
export function toCsv(cards) {
  const lines = ['Term,Definition'];
  for (const card of cards) lines.push(`${csvField(card.term)},${csvField(card.definition)}`);
  return `${lines.join('\r\n')}\r\n`;
}

/** Q:/A: blocks that the same3le paste box understands. */
export function toSame3lePaste(cards) {
  const flat = (value) => String(value).replace(/\s*\n\s*/g, ' ').trim();
  return cards.map((card) => `Q: ${flat(card.term)}\nA: ${flat(card.definition)}`).join('\n\n');
}

export function fileSlug(deck) {
  const slug = cleanHeaderValue(deck)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'quizlet-to-anki';
}
