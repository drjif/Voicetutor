export const DECK_CONTRACT_VERSION = 1;

export class DeckValidationError extends Error {
  constructor(validation) {
    const summary = validation.errors.map((item) => item.message).join(' ');
    super(summary || 'The deck is not valid.');
    this.name = 'DeckValidationError';
    this.validation = validation;
  }
}

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function normalizeAcceptedAnswers(value, primaryAnswer) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value ?? '').split(/\||\n|;/);
  const primary = cleanText(primaryAnswer).toLocaleLowerCase();
  const seen = new Set();
  const accepted = [];

  for (const rawValue of rawValues) {
    const text = cleanText(rawValue);
    const key = text.toLocaleLowerCase();
    if (!text || key === primary || seen.has(key)) continue;
    seen.add(key);
    accepted.push(text);
  }

  return accepted;
}

function normalizeSource(source, fallbackType = 'unknown') {
  const sourceObject = source && typeof source === 'object' && !Array.isArray(source)
    ? source
    : {};
  const type = cleanText(sourceObject.type || fallbackType).toLowerCase() || 'unknown';
  return { ...sourceObject, type };
}

function normalizeCard(card, index) {
  const value = card && typeof card === 'object' && !Array.isArray(card) ? card : {};
  const question = cleanText(value.question);
  const answer = cleanText(value.answer);
  const sourceRow = Number.isInteger(value.sourceRow) && value.sourceRow > 0
    ? value.sourceRow
    : null;

  return {
    ...value,
    id: cleanText(value.id) || `card-${index + 1}`,
    sourceRow,
    question,
    answer,
    acceptedAnswers: normalizeAcceptedAnswers(value.acceptedAnswers, answer)
  };
}

/**
 * Convert any supported deck-like input into Deck Contract v1.
 * This function does not remove incomplete cards; validateDeck reports them.
 */
export function normalizeDeck(input, defaults = {}) {
  const raw = Array.isArray(input) ? { cards: input } : (input ?? {});
  const rawCards = Array.isArray(raw.cards)
    ? raw.cards
    : Array.isArray(raw.questions)
      ? raw.questions
      : [];
  const sourceFallback = defaults.sourceType || 'unknown';

  return {
    version: DECK_CONTRACT_VERSION,
    id: cleanText(raw.id ?? defaults.id) || null,
    title: cleanText(raw.title ?? defaults.title) || 'Untitled deck',
    source: normalizeSource(raw.source ?? defaults.source, sourceFallback),
    cards: rawCards.map(normalizeCard)
  };
}

export function validateDeck(deck) {
  const errors = [];
  const warnings = [];

  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) {
    return {
      valid: false,
      errors: [{ code: 'deck.invalid', message: 'Deck must be an object.' }],
      warnings,
      cardCount: 0
    };
  }

  if (deck.version !== DECK_CONTRACT_VERSION) {
    errors.push({
      code: 'deck.version',
      message: `Deck version must be ${DECK_CONTRACT_VERSION}.`
    });
  }

  if (!Array.isArray(deck.cards) || deck.cards.length === 0) {
    errors.push({ code: 'deck.empty', message: 'Deck must contain at least one card.' });
  }

  const seenPairs = new Set();
  (Array.isArray(deck.cards) ? deck.cards : []).forEach((card, index) => {
    const position = index + 1;
    if (!cleanText(card?.question)) {
      errors.push({
        code: 'card.question.empty',
        cardIndex: index,
        message: `Card ${position} is missing a question.`
      });
    }
    if (!cleanText(card?.answer)) {
      errors.push({
        code: 'card.answer.empty',
        cardIndex: index,
        message: `Card ${position} is missing an answer.`
      });
    }

    const pairKey = `${cleanText(card?.question).toLocaleLowerCase()}\u0000${cleanText(card?.answer).toLocaleLowerCase()}`;
    if (pairKey !== '\u0000') {
      if (seenPairs.has(pairKey)) {
        warnings.push({
          code: 'card.duplicate',
          cardIndex: index,
          message: `Card ${position} duplicates an earlier question-answer pair.`
        });
      }
      seenPairs.add(pairKey);
    }

    if (cleanText(card?.question).length > 1000) {
      warnings.push({
        code: 'card.question.long',
        cardIndex: index,
        message: `Card ${position} has a very long question.`
      });
    }
    if (cleanText(card?.answer).length > 2000) {
      warnings.push({
        code: 'card.answer.long',
        cardIndex: index,
        message: `Card ${position} has a very long answer.`
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cardCount: Array.isArray(deck.cards) ? deck.cards.length : 0
  };
}

/**
 * The canonical doorway into the study engine.
 * Importers should call loadDeck() before assigning cards to session state.
 */
export function loadDeck(input, defaults = {}) {
  const deck = normalizeDeck(input, defaults);
  const validation = validateDeck(deck);
  if (!validation.valid) throw new DeckValidationError(validation);
  return deck;
}
