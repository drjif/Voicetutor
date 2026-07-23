export function parseGoogleSheetUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const value = input.trim();

  if (/\.csv(?:\?|$)/i.test(value) || /tqx=out:csv/i.test(value) || /format=csv/i.test(value)) {
    return { csvUrl: value, exportCsvUrl: value, spreadsheetId: null, gid: null };
  }

  const idMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;

  const spreadsheetId = idMatch[1];
  const gidMatch = value.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch?.[1] ?? '0';

  return {
    spreadsheetId,
    gid,
    exportCsvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`,
    csvUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`
  };
}

function detectDelimiter(text) {
  const counts = new Map([[',', 0], ['\t', 0], [';', 0]]);
  let inQuotes = false;
  let foundContent = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === '\n') {
      if (foundContent) break;
      counts.forEach((_, key) => counts.set(key, 0));
      continue;
    }

    if (!inQuotes && counts.has(char)) counts.set(char, counts.get(char) + 1);
    if (!/\s/.test(char)) foundContent = true;
  }

  let delimiter = ',';
  let highest = -1;
  for (const [candidate, count] of counts) {
    if (count > highest) {
      highest = count;
      delimiter = candidate;
    }
  }
  return delimiter;
}

function isEmptyRow(row) {
  return !row || row.every((cell) => String(cell ?? '').trim() === '');
}

export function parseDelimited(text) {
  if (typeof text !== 'string') return [];
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) return [];

  const delimiter = detectDelimiter(normalized);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length && isEmptyRow(rows.at(-1))) rows.pop();
  return rows;
}

export function columnName(index) {
  let n = Number(index) + 1;
  let result = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function normalizeHeader(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactHeader(value) {
  return normalizeHeader(value).replace(/\s+/g, '');
}

function questionScore(header) {
  const normalized = normalizeHeader(header);
  const compact = compactHeader(header);
  if (!normalized) return -Infinity;
  if (/^(question|item)?(id|identifier|number|no)$/.test(compact) || compact === 'qid') return -200;

  const exact = new Map([
    ['question stem', 150],
    ['stem', 145],
    ['prompt', 140],
    ['question text', 135],
    ['question', 120],
    ['item', 90]
  ]);
  if (exact.has(normalized)) return exact.get(normalized);

  let score = 0;
  if (normalized.includes('stem')) score = Math.max(score, 125);
  if (normalized.includes('prompt')) score = Math.max(score, 120);
  if (normalized.includes('question')) score = Math.max(score, 85);
  if (/(^|\s)(id|identifier|number|no)(\s|$)/.test(normalized) || /questionid|qid/.test(compact)) score -= 180;
  return score;
}

function answerScore(header) {
  const normalized = normalizeHeader(header);
  const compact = compactHeader(header);
  if (!normalized) return -Infinity;

  let score = 0;
  if (normalized === 'correct answer' || compact === 'correctanswer') score = 150;
  else if (normalized === 'answer') score = 125;
  else if (normalized === 'response') score = 100;
  else if (normalized.includes('correct') && normalized.includes('answer')) score = 140;
  else if (normalized.includes('answer')) score = 85;
  else if (normalized.includes('response')) score = 70;

  if (/accepted|alternative|synonym/.test(normalized)) score -= 120;
  if (/explanation|rationale|reference|citation/.test(normalized)) score -= 70;
  return score;
}

function acceptedScore(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return -Infinity;
  let score = 0;
  if (normalized.includes('accepted')) score += 120;
  if (normalized.includes('alternative')) score += 110;
  if (normalized.includes('synonym')) score += 100;
  if (normalized.includes('answer') || normalized.includes('response')) score += 20;
  return score;
}

function bestIndex(headers, scorer, minimumScore = 1) {
  let index = -1;
  let bestScore = minimumScore - 1;
  headers.forEach((header, candidateIndex) => {
    const score = scorer(header);
    if (score > bestScore) {
      bestScore = score;
      index = candidateIndex;
    }
  });
  return index;
}

function findHeaderRowIndex(rows) {
  const index = rows.findIndex((row) => row.filter((cell) => String(cell ?? '').trim() !== '').length >= 2);
  return index >= 0 ? index : 0;
}

export function detectColumns(rows, hasHeaders = true) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { headers: [], headerRowIndex: hasHeaders ? 0 : -1, questionIndex: 0, answerIndex: 1, acceptedIndex: -1 };
  }

  const width = Math.max(1, ...rows.map((row) => row.length));
  const headerRowIndex = hasHeaders ? findHeaderRowIndex(rows) : -1;
  const headerRow = hasHeaders ? (rows[headerRowIndex] ?? []) : [];
  const headers = Array.from({ length: width }, (_, index) => {
    const value = hasHeaders ? String(headerRow[index] ?? '').trim() : '';
    return value || `Column ${columnName(index)}`;
  });

  let questionIndex = bestIndex(headers, questionScore);
  let answerIndex = bestIndex(headers, answerScore);
  const acceptedIndex = bestIndex(headers, acceptedScore, 80);

  if (questionIndex < 0) questionIndex = 0;
  if (answerIndex < 0 || answerIndex === questionIndex) {
    answerIndex = Array.from({ length: width }, (_, index) => index)
      .find((index) => index !== questionIndex) ?? questionIndex;
  }

  return { headers, headerRowIndex, questionIndex, answerIndex, acceptedIndex };
}

export function buildQuestionBank(rows, options = {}) {
  const {
    hasHeaders = true,
    headerRowIndex = hasHeaders ? 0 : -1,
    questionIndex = 0,
    answerIndex = 1,
    acceptedIndex = -1
  } = options;

  const startIndex = hasHeaders ? headerRowIndex + 1 : 0;
  const records = [];

  for (let i = startIndex; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const question = String(row[questionIndex] ?? '').trim();
    const answer = String(row[answerIndex] ?? '').trim();
    if (!question || !answer) continue;

    const acceptedRaw = acceptedIndex >= 0 ? String(row[acceptedIndex] ?? '') : '';
    const acceptedAnswers = acceptedRaw
      .split(/\||\n|;/)
      .map((value) => value.trim())
      .filter(Boolean);

    records.push({
      sourceRow: i + 1,
      question,
      answer,
      acceptedAnswers
    });
  }

  return records;
}
