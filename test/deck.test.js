import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECK_CONTRACT_VERSION,
  DeckValidationError,
  loadDeck,
  normalizeDeck,
  validateDeck
} from '../deck.js';
import { buildQuestionBank } from '../sheet-data.js';

test('normalizeDeck preserves card order, source rows, and accepted answers', () => {
  const deck = normalizeDeck({
    title: '  Cardiology  ',
    source: { type: 'CSV' },
    cards: [
      {
        sourceRow: 7,
        question: '  What chamber pumps blood to the lungs?  ',
        answer: ' Right ventricle ',
        acceptedAnswers: ['RV', 'right ventricle', 'RV', ' right ventricular chamber ']
      },
      {
        sourceRow: 8,
        question: 'What valve lies between the left atrium and ventricle?',
        answer: 'Mitral valve',
        acceptedAnswers: 'bicuspid valve|mitral;Bicuspid valve'
      }
    ]
  });

  assert.equal(deck.version, DECK_CONTRACT_VERSION);
  assert.equal(deck.title, 'Cardiology');
  assert.equal(deck.source.type, 'csv');
  assert.deepEqual(deck.cards.map((card) => card.sourceRow), [7, 8]);
  assert.deepEqual(deck.cards.map((card) => card.question), [
    'What chamber pumps blood to the lungs?',
    'What valve lies between the left atrium and ventricle?'
  ]);
  assert.deepEqual(deck.cards[0].acceptedAnswers, ['RV', 'right ventricular chamber']);
  assert.deepEqual(deck.cards[1].acceptedAnswers, ['bicuspid valve', 'mitral']);
});

test('validateDeck reports incomplete cards without silently dropping them', () => {
  const deck = normalizeDeck({
    cards: [
      { question: 'Complete card', answer: 'Answer' },
      { question: 'Missing answer', answer: '' },
      { question: '', answer: 'Missing question' }
    ]
  });

  const validation = validateDeck(deck);
  assert.equal(deck.cards.length, 3);
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.errors.map((error) => error.code),
    ['card.answer.empty', 'card.question.empty']
  );
});

test('loadDeck is the strict canonical doorway and rejects invalid decks', () => {
  const valid = loadDeck([
    { question: 'What is ATP?', answer: 'Adenosine triphosphate' }
  ], { title: 'Biology', sourceType: 'paste' });

  assert.equal(valid.title, 'Biology');
  assert.equal(valid.source.type, 'paste');
  assert.equal(valid.cards.length, 1);
  assert.equal(valid.cards[0].id, 'card-1');

  assert.throws(
    () => loadDeck([{ question: 'No answer', answer: '' }]),
    (error) => error instanceof DeckValidationError
      && error.validation.errors.some((item) => item.code === 'card.answer.empty')
  );
});

test('existing Google Sheet/CSV row conversion survives Deck Contract v1 unchanged', () => {
  const rows = [
    ['Question', 'Answer', 'Accepted alternatives'],
    ['What is the mechanism of infliximab?', 'It inhibits TNF-alpha.', 'TNF inhibitor|anti-TNF monoclonal antibody'],
    ['What is the capital of France?', 'Paris', '']
  ];

  const records = buildQuestionBank(rows, {
    hasHeaders: true,
    headerRowIndex: 0,
    questionIndex: 0,
    answerIndex: 1,
    acceptedIndex: 2
  });
  const deck = loadDeck({
    title: 'Existing import',
    source: { type: 'google-sheet' },
    cards: records
  });

  assert.equal(deck.cards.length, 2);
  assert.deepEqual(deck.cards.map((card) => card.sourceRow), [2, 3]);
  assert.equal(deck.cards[0].question, 'What is the mechanism of infliximab?');
  assert.equal(deck.cards[0].answer, 'It inhibits TNF-alpha.');
  assert.deepEqual(deck.cards[0].acceptedAnswers, [
    'TNF inhibitor',
    'anti-TNF monoclonal antibody'
  ]);
  assert.equal(deck.cards[1].question, 'What is the capital of France?');
  assert.equal(deck.cards[1].answer, 'Paris');
});

test('duplicate cards remain studyable but produce a warning', () => {
  const deck = loadDeck({
    cards: [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q1', answer: 'A1' }
    ]
  });
  const validation = validateDeck(deck);

  assert.equal(validation.valid, true);
  assert.equal(validation.warnings.length, 1);
  assert.equal(validation.warnings[0].code, 'card.duplicate');
});
