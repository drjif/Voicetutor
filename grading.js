import { answerSimilarity, contentTokens, normalizeText } from './lib.js';

function levenshtein(left, right) {
  const a = String(left);
  const b = String(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function soundex(value) {
  const text = normalizeText(value).replace(/[^a-z]/g, '');
  if (!text) return '';

  const map = {
    b: 1, f: 1, p: 1, v: 1,
    c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2,
    d: 3, t: 3,
    l: 4,
    m: 5, n: 5,
    r: 6
  };

  let code = text[0].toUpperCase();
  let previous = map[text[0]] || 0;

  for (let i = 1; i < text.length && code.length < 4; i += 1) {
    const digit = map[text[i]] || 0;
    if (digit && digit !== previous) code += digit;
    previous = digit;
  }

  return (code + '000').slice(0, 4);
}

function tokenCloseness(left, right) {
  if (left === right) return 1;
  if (left.length < 3 || right.length < 3) return 0;

  const editScore = 1 - (levenshtein(left, right) / Math.max(left.length, right.length));
  const leftCode = soundex(left);
  const rightCode = soundex(right);
  const phoneticMatch = leftCode && rightCode
    && (leftCode === rightCode || leftCode.slice(1) === rightCode.slice(1));

  if (phoneticMatch && editScore >= 0.35) return Math.max(0.84, editScore);
  if (editScore >= 0.78) return editScore;
  return 0;
}

function fuzzyCoverage(userAnswer, expectedAnswer) {
  const userTokens = contentTokens(userAnswer);
  const expectedTokens = contentTokens(expectedAnswer);
  if (!userTokens.length || !expectedTokens.length) {
    return { precision: 0, recall: 0, f1: 0, matches: 0 };
  }

  const usedExpected = new Set();
  let matches = 0;

  for (const userToken of userTokens) {
    let bestIndex = -1;
    let bestScore = 0;

    expectedTokens.forEach((expectedToken, index) => {
      if (usedExpected.has(index)) return;
      const score = tokenCloseness(userToken, expectedToken);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.8) {
      usedExpected.add(bestIndex);
      matches += 1;
    }
  }

  const precision = matches / userTokens.length;
  const recall = matches / expectedTokens.length;
  const f1 = precision + recall
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  return { precision, recall, f1, matches };
}

function deriveCandidates(answer, acceptedAnswers = []) {
  const candidates = [];
  const seen = new Set();

  const add = (text, kind = 'complete', source = 'derived') => {
    const value = String(text ?? '').trim().replace(/[\s;,:-]+$/, '');
    const normalized = normalizeText(value);
    const key = `${kind}:${normalized}`;
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    candidates.push({ text: value, kind, source });
  };

  add(answer, 'complete', 'full');
  acceptedAnswers.forEach((value) => add(value, 'complete', 'accepted'));

  const raw = String(answer ?? '').trim();

  // A trailing parenthetical is usually a qualifier rather than a required part
  // of the core answer: "Tunneled catheter (fewer lumens preferred)".
  const parentheticalOnly = raw.match(/^(.+?)\s*\([^()]+\)\s*$/);
  if (parentheticalOnly) add(parentheticalOnly[1], 'complete', 'core');

  // Acronyms and individual clauses are useful partial-answer candidates, but
  // should not automatically count as a complete response to a multi-part item.
  const acronym = raw.match(/^([A-Z][A-Z0-9-]{1,12})\b/);
  if (acronym) add(acronym[1], 'partial', 'acronym');

  for (const match of raw.matchAll(/\(([^()]{2,80})\)/g)) {
    add(match[1], 'partial', 'parenthetical');
  }

  raw.split(/[;\n]+/).forEach((part) => add(part, 'partial', 'clause'));
  return candidates;
}

function scoreCandidate(transcript, candidate) {
  const baseScore = answerSimilarity(transcript, candidate.text);
  const fuzzy = fuzzyCoverage(transcript, candidate.text);
  let score = Math.max(baseScore, fuzzy.f1);

  // Reward concise answers whose spoken words all map to the expected concept.
  if (fuzzy.precision >= 0.95 && fuzzy.matches >= 2) {
    score = Math.max(score, Math.min(0.9, 0.58 + (0.12 * fuzzy.matches)));
  }

  if (fuzzy.precision === 1 && fuzzy.matches === 1 && contentTokens(candidate.text).length === 1) {
    score = 1;
  }

  return { score, fuzzy };
}

function isGiveUp(value) {
  const normalized = normalizeText(value);
  const phrases = [
    'i do not know', 'i dont know', 'dont know', 'do not know', 'no idea', 'skip'
  ];
  return phrases.some((phrase) => normalized === phrase || normalized.includes(phrase));
}

function gradeOne(transcript, answer, acceptedAnswers, strictness) {
  if (!normalizeText(transcript) || isGiveUp(transcript)) {
    return {
      outcome: 'incorrect',
      score: 0,
      matchedAnswer: answer,
      reason: 'empty-or-give-up'
    };
  }

  const candidates = deriveCandidates(answer, acceptedAnswers);
  let best = { score: 0, candidate: candidates[0], fuzzy: null };

  for (const candidate of candidates) {
    const result = scoreCandidate(transcript, candidate);
    if (result.score > best.score) best = { ...result, candidate };
  }

  const thresholds = {
    lenient: { correct: 0.5, partial: 0.32 },
    standard: { correct: 0.58, partial: 0.38 },
    strict: { correct: 0.7, partial: 0.48 }
  };
  const threshold = thresholds[strictness] ?? thresholds.standard;

  let outcome = 'incorrect';
  if (best.candidate?.kind === 'complete' && best.score >= threshold.correct) {
    outcome = 'correct';
  } else if (best.score >= threshold.partial) {
    outcome = 'partial';
  }

  return {
    outcome,
    score: best.score,
    matchedAnswer: best.candidate?.text ?? answer,
    reason: best.candidate?.source ?? 'full',
    fuzzy: best.fuzzy
  };
}

export function gradeTranscriptAlternatives(
  alternatives,
  answer,
  acceptedAnswers = [],
  strictness = 'standard'
) {
  const normalizedAlternatives = (Array.isArray(alternatives) ? alternatives : [alternatives])
    .map((item) => typeof item === 'string'
      ? { transcript: item, confidence: null }
      : {
          transcript: String(item?.transcript ?? ''),
          confidence: Number.isFinite(item?.confidence) && item.confidence > 0
            ? item.confidence
            : null
        })
    .filter((item) => item.transcript.trim());

  if (!normalizedAlternatives.length) {
    normalizedAlternatives.push({ transcript: '', confidence: null });
  }

  const rank = { incorrect: 0, partial: 1, correct: 2 };
  let best = null;

  for (const alternative of normalizedAlternatives) {
    const grading = gradeOne(
      alternative.transcript,
      answer,
      acceptedAnswers,
      strictness
    );
    const candidate = { ...grading, ...alternative };

    if (
      !best
      || rank[candidate.outcome] > rank[best.outcome]
      || (rank[candidate.outcome] === rank[best.outcome] && candidate.score > best.score)
    ) {
      best = candidate;
    }
  }

  return { ...best, alternatives: normalizedAlternatives };
}
