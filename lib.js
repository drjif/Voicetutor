const DEFAULT_STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','because','been','being','by','can','could',
  'do','does','for','from','had','has','have','he','her','hers','him','his','i','if',
  'in','into','is','it','its','may','might','of','on','or','our','she','should','so',
  'that','the','their','them','there','they','this','those','to','was','we','were',
  'what','when','where','which','who','will','with','would','you','your'
]);

const SYNONYM_REPLACEMENTS = [
  [/tumou?r necrosis factor/gi, 'tnf'],
  [/interleukin[-\s]?/gi, 'il'],
  [/monoclonal antibody/gi, 'mab'],
  [/inhibits?|inhibition|blocks?|blocking|antagonists?/gi, 'inhibit'],
  [/activates?|activation|stimulates?|stimulation/gi, 'activate'],
  [/increases?|elevates?|raises?/gi, 'increase'],
  [/decreases?|reduces?|lowers?/gi, 'decrease'],
  [/gastrointestinal/gi, 'gi'],
  [/intravenous/gi, 'iv'],
  [/subcutaneous/gi, 'sc'],
  [/milligrams?/gi, 'mg'],
  [/micrograms?/gi, 'mcg'],
  [/alpha/gi, 'alpha'],
  [/beta/gi, 'beta']
];

export function parseGoogleSheetUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const value = input.trim();

  if (/\.csv(?:\?|$)/i.test(value) || /tqx=out:csv/i.test(value)) {
    return { csvUrl: value, spreadsheetId: null, gid: null };
  }

  const idMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;

  const spreadsheetId = idMatch[1];
  const gidMatch = value.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch?.[1] ?? '0';
  const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

  return { csvUrl, spreadsheetId, gid };
}

export function parseCsv(text) {
  if (typeof text !== 'string') return [];
  text = text.replace(/^\uFEFF/, '');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

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
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((cell) => String(cell).trim() !== ''));
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

export function detectColumns(rows, hasHeaders = true) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { headers: [], questionIndex: 0, answerIndex: 1, acceptedIndex: -1 };
  }

  const width = Math.max(...rows.map((row) => row.length));
  const firstRow = rows[0] ?? [];
  const headers = Array.from({ length: width }, (_, index) => {
    const value = hasHeaders ? String(firstRow[index] ?? '').trim() : '';
    return value || `Column ${columnName(index)}`;
  });

  const normalizedHeaders = headers.map((header) => header.toLowerCase());
  const findIndex = (patterns) => normalizedHeaders.findIndex((header) => patterns.some((pattern) => header.includes(pattern)));

  let questionIndex = findIndex(['question', 'prompt', 'stem']);
  let answerIndex = findIndex(['correct answer', 'answer', 'response']);
  const acceptedIndex = findIndex(['accepted', 'alternative', 'synonym']);

  if (questionIndex < 0) questionIndex = 0;
  if (answerIndex < 0 || answerIndex === questionIndex) answerIndex = width > 1 ? 1 : 0;

  return { headers, questionIndex, answerIndex, acceptedIndex };
}

export function buildQuestionBank(rows, options = {}) {
  const {
    hasHeaders = true,
    questionIndex = 0,
    answerIndex = 1,
    acceptedIndex = -1
  } = options;

  const startIndex = hasHeaders ? 1 : 0;
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

export function normalizeText(value) {
  let text = String(value ?? '').toLowerCase().normalize('NFKD');
  for (const [pattern, replacement] of SYNONYM_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/[^a-z0-9.%-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token) {
  if (token.length <= 4) return token;
  return token
    .replace(/(ization|isation)$/i, 'ize')
    .replace(/(ational|tional)$/i, 'tion')
    .replace(/(ing|ed|es|s)$/i, '');
}

export function contentTokens(value) {
  return normalizeText(value)
    .split(' ')
    .map(stemToken)
    .filter((token) => token.length > 1 && !DEFAULT_STOP_WORDS.has(token));
}

function tokenF1(left, right) {
  const a = new Set(contentTokens(left));
  const b = new Set(contentTokens(right));
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }

  const precision = overlap / a.size;
  const recall = overlap / b.size;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function ngrams(value, size = 3) {
  const normalized = normalizeText(value).replace(/\s+/g, ' ');
  if (normalized.length < size) return new Set(normalized ? [normalized] : []);
  const output = new Set();
  for (let i = 0; i <= normalized.length - size; i += 1) {
    output.add(normalized.slice(i, i + size));
  }
  return output;
}

function diceCoefficient(left, right) {
  const a = ngrams(left);
  const b = ngrams(right);
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const gram of a) {
    if (b.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (a.size + b.size);
}

export function answerSimilarity(userAnswer, expectedAnswer) {
  const normalizedUser = normalizeText(userAnswer);
  const normalizedExpected = normalizeText(expectedAnswer);
  if (!normalizedUser || !normalizedExpected) return 0;
  if (normalizedUser === normalizedExpected) return 1;
  if (normalizedUser.includes(normalizedExpected) || normalizedExpected.includes(normalizedUser)) {
    const shorter = Math.min(normalizedUser.length, normalizedExpected.length);
    const longer = Math.max(normalizedUser.length, normalizedExpected.length);
    if (shorter / longer >= 0.45) return 0.92;
  }

  const tokenScore = tokenF1(normalizedUser, normalizedExpected);
  const phraseScore = diceCoefficient(normalizedUser, normalizedExpected);
  return Math.max(0, Math.min(1, tokenScore * 0.72 + phraseScore * 0.28));
}

export function gradeAnswer(userAnswer, answer, acceptedAnswers = [], strictness = 'standard') {
  const normalized = normalizeText(userAnswer);
  if (!normalized) return { correct: false, score: 0, matchedAnswer: answer };

  const giveUpPhrases = [
    'i do not know', 'i dont know', 'dont know', 'do not know', 'no idea', 'skip'
  ];
  if (giveUpPhrases.some((phrase) => normalized === phrase || normalized.includes(phrase))) {
    return { correct: false, score: 0, matchedAnswer: answer };
  }

  const candidates = [answer, ...acceptedAnswers].filter(Boolean);
  let best = { score: 0, matchedAnswer: answer };
  for (const candidate of candidates) {
    const score = answerSimilarity(userAnswer, candidate);
    if (score > best.score) best = { score, matchedAnswer: candidate };
  }

  const thresholds = {
    lenient: 0.46,
    standard: 0.58,
    strict: 0.72
  };
  const threshold = thresholds[strictness] ?? thresholds.standard;

  return {
    correct: best.score >= threshold,
    score: best.score,
    matchedAnswer: best.matchedAnswer
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
