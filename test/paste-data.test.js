import test from 'node:test';
import assert from 'node:assert/strict';

import { loadDeck } from '../deck.js';
import { parsePastedQuestions } from '../paste-data.js';

test('parses Q and A labels with optional accepted alternatives', () => {
  const result = parsePastedQuestions(`
Q: What hormone lowers blood sugar?
A: Insulin
ALT: insulin hormone | human insulin

Q: What organ produces insulin?
A: Pancreas
`);

  assert.equal(result.cards.length, 2);
  assert.equal(result.format, 'Q / A labels');
  assert.equal(result.cards[0].question, 'What hormone lowers blood sugar?');
  assert.equal(result.cards[0].answer, 'Insulin');
  assert.deepEqual(result.cards[0].acceptedAnswers, ['insulin hormone', 'human insulin']);

  const deck = loadDeck({ title: 'Paste test', source: { type: 'paste' }, cards: result.cards });
  assert.equal(deck.source.type, 'paste');
  assert.equal(deck.cards.length, 2);
});

test('parses tab-separated rows copied from a spreadsheet and ignores a header', () => {
  const result = parsePastedQuestions([
    'Question\tAnswer\tAccepted alternatives',
    'Capital of France?\tParis\tCity of Paris',
    'Capital of Italy?\tRome\tRoma'
  ].join('\n'));

  assert.equal(result.cards.length, 2);
  assert.equal(result.format, 'tab-separated rows');
  assert.equal(result.cards[0].question, 'Capital of France?');
  assert.equal(result.cards[1].answer, 'Rome');
});

test('parses pipe-separated rows', () => {
  const result = parsePastedQuestions(`
What is ATP? | Adenosine triphosphate
What is DNA? | Deoxyribonucleic acid
`);

  assert.equal(result.cards.length, 2);
  assert.equal(result.format, 'pipe-separated rows');
  assert.equal(result.cards[0].answer, 'Adenosine triphosphate');
});

test('parses blank-separated question and answer blocks', () => {
  const result = parsePastedQuestions(`
What is the largest planet?
Jupiter

What planet is closest to the Sun?
Mercury
`);

  assert.equal(result.cards.length, 2);
  assert.equal(result.format, 'question / answer blocks');
});

test('rejects ambiguous prose instead of inventing question-answer pairs', () => {
  const result = parsePastedQuestions('This is a paragraph of study notes. It contains facts but no explicit question and answer structure.');

  assert.deepEqual(result.cards, []);
  assert.match(result.message, /could not reliably find/i);
});

test('empty input produces a clear error', () => {
  const result = parsePastedQuestions('   ');
  assert.deepEqual(result.cards, []);
  assert.match(result.message, /paste at least one/i);
});
