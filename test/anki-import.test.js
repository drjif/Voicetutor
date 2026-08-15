import test from 'node:test';
import assert from 'node:assert/strict';

import { cardsFromAnkiFields, cleanAnkiText } from '../anki-import.js';

test('converts basic Anki front/back notes into Deck Contract records', () => {
  const cards = cardsFromAnkiFields([
    'What hormone lowers blood glucose?\x1fInsulin',
    'What organ produces insulin?\x1fPancreas'
  ]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].question, 'What hormone lowers blood glucose?');
  assert.equal(cards[0].answer, 'Insulin');
  assert.equal(cards[0].sourceRow, 1);
});

test('strips common Anki HTML and non-spoken media markup', () => {
  const text = cleanAnkiText('<div>Alpha<br>Beta</div>[sound:test.mp3]<img src="x.png" alt="diagram">');
  assert.match(text, /Alpha/);
  assert.match(text, /Beta/);
  assert.match(text, /diagram/);
  assert.doesNotMatch(text, /sound:/i);
  assert.doesNotMatch(text, /<div>/i);
});

test('turns Anki cloze notes into questions graded against the hidden term', () => {
  const cards = cardsFromAnkiFields([
    'The capital of France is {{c1::Paris}}.\x1fExtra notes'
  ]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].question, 'The capital of France is […].');
  assert.equal(cards[0].answer, 'Paris');
});

test('creates one card per cloze number and reveals non-target clozes', () => {
  const cards = cardsFromAnkiFields([
    '{{c1::Insulin}} is produced by {{c2::beta cells}}.'
  ]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].question, '[…] is produced by beta cells.');
  assert.equal(cards[0].answer, 'Insulin');
  assert.equal(cards[1].question, 'Insulin is produced by […].');
  assert.equal(cards[1].answer, 'beta cells');
});

test('deduplicates identical question and answer pairs', () => {
  const cards = cardsFromAnkiFields([
    'What is ATP?\x1fAdenosine triphosphate',
    'What is ATP?\x1fAdenosine triphosphate'
  ]);

  assert.equal(cards.length, 1);
});
