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

test('parses markdown-formatted Q and A labels', () => {
  const result = parsePastedQuestions(`
**Q:** What is the largest planet?
**A:** Jupiter
`);

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].question, 'What is the largest planet?');
  assert.equal(result.cards[0].answer, 'Jupiter');
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

test('parses Markdown tables commonly returned by AI tools', () => {
  const result = parsePastedQuestions(`
| Question | Answer |
| --- | --- |
| What is ATP? | Adenosine triphosphate |
| What is DNA? | Deoxyribonucleic acid |
`);

  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].question, 'What is ATP?');
  assert.equal(result.cards[1].answer, 'Deoxyribonucleic acid');
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

test('parses numbered question plus Answer label blocks', () => {
  const result = parsePastedQuestions(`
1. What is the largest planet?
Answer: Jupiter

2. What planet is closest to the Sun?
Answer: Mercury
`);

  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].question, 'What is the largest planet?');
  assert.equal(result.cards[0].answer, 'Jupiter');
});

test('accepts a single intentional two-line question and answer block', () => {
  const result = parsePastedQuestions('What is the capital of France?\nParis');

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].answer, 'Paris');
});

test('rejects ambiguous prose instead of inventing question-answer pairs', () => {
  const result = parsePastedQuestions('This is a paragraph of study notes. It contains facts but no explicit question and answer structure.');

  assert.deepEqual(result.cards, []);
  assert.match(result.message, /could not reliably find/i);
});

test('rejects an ambiguous two-line prose block', () => {
  const result = parsePastedQuestions('Insulin is produced by beta cells.\nIt lowers blood glucose.');

  assert.deepEqual(result.cards, []);
});

test('empty input produces a clear error', () => {
  const result = parsePastedQuestions('   ');
  assert.deepEqual(result.cards, []);
  assert.match(result.message, /paste at least one/i);
});
